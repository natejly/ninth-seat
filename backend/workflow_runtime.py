from __future__ import annotations

import base64
import binascii
import copy
import json
import os
import re
import threading
import time
import urllib.parse
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

LANGCHAIN_OPENAI_IMPORT_ERROR: str | None = None
OPENAI_SDK_IMPORT_ERROR: str | None = None

try:
    from langchain_openai import ChatOpenAI
except Exception as exc:  # pragma: no cover - import fallback for local/dev envs
    ChatOpenAI = None  # type: ignore[assignment]
    LANGCHAIN_OPENAI_IMPORT_ERROR = str(exc)

try:
    from openai import OpenAI
except Exception as exc:  # pragma: no cover - import fallback for local/dev envs
    OpenAI = None  # type: ignore[assignment]
    OPENAI_SDK_IMPORT_ERROR = str(exc)

try:
    from backend.tooling import list_tools as _list_runtime_tools, run_tool as _run_runtime_tool
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from tooling import list_tools as _list_runtime_tools, run_tool as _run_runtime_tool


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RuntimeNode(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="", max_length=200)
    objective: str = Field(default="", max_length=500)


class RuntimeHandoffField(BaseModel):
    targetKey: str = Field(min_length=1, max_length=80)
    sourcePath: str = Field(min_length=1, max_length=160)
    type: str = Field(default="any", max_length=24)
    required: bool = True
    description: str = Field(default="", max_length=240)


class RuntimeHandoffContract(BaseModel):
    packetType: str = Field(default="handoff_packet", min_length=1, max_length=80)
    fields: list[RuntimeHandoffField] = Field(default_factory=list, max_length=20)


class RuntimeEdge(BaseModel):
    source: str = Field(min_length=1, max_length=80)
    target: str = Field(min_length=1, max_length=80)
    handoff: str = Field(default="", max_length=240)
    handoffContract: RuntimeHandoffContract | None = None


class RuntimeWorkflowTemplate(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=200)
    prompt: str = Field(default="", max_length=10_000)
    summary: str = Field(default="", max_length=10_000)
    nodes: list[RuntimeNode] = Field(min_length=1, max_length=30)
    edges: list[RuntimeEdge] = Field(default_factory=list)


class WorkflowRunCreateRequest(BaseModel):
    template: RuntimeWorkflowTemplate
    inputs: dict[str, Any] = Field(default_factory=dict)
    requested_deliverables: list[str] = Field(default_factory=list, max_length=20)


class WorkflowRunResumeRequest(BaseModel):
    input_request_id: str
    response: Any


class RuntimeAgentToolRequest(BaseModel):
    tool: str = Field(min_length=1, max_length=64)
    args: dict[str, Any] = Field(default_factory=dict)
    reason: str = Field(default="", max_length=400)


class RuntimeAgentDecision(BaseModel):
    action: Literal["tool", "final"] = "final"
    status_note: str = Field(default="", max_length=500)
    summary: str = Field(default="", max_length=6000)
    details: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    tool_request: RuntimeAgentToolRequest | None = None


def _runtime_model_name() -> str:
    return os.getenv("WORKFLOW_RUN_MODEL", os.getenv("WORKFLOW_MODEL", "gpt-5.2"))


def _runtime_llm() -> Any:
    if ChatOpenAI is None:
        raise RuntimeError(
            "Workflow runtime requires langchain-openai"
            + (f": {LANGCHAIN_OPENAI_IMPORT_ERROR}" if LANGCHAIN_OPENAI_IMPORT_ERROR else "")
        )

    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not configured for workflow execution")

    return ChatOpenAI(model=_runtime_model_name(), temperature=0)


_OPENAI_CLIENT: Any | None = None


def _runtime_openai_client() -> Any:
    global _OPENAI_CLIENT

    if OpenAI is None:
        raise RuntimeError(
            "Workflow runtime requires openai SDK or langchain-openai"
            + (f": {OPENAI_SDK_IMPORT_ERROR}" if OPENAI_SDK_IMPORT_ERROR else "")
        )
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not configured for workflow execution")
    if _OPENAI_CLIENT is None:
        _OPENAI_CLIENT = OpenAI()
    return _OPENAI_CLIENT


def _extract_openai_text_content(message: Any) -> str:
    content = getattr(message, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text_value = item.get("text")
                if isinstance(text_value, str):
                    parts.append(text_value)
                continue
            text_attr = getattr(item, "text", None)
            if isinstance(text_attr, str):
                parts.append(text_attr)
        return "\n".join(part for part in parts if part).strip()
    return ""


def _parse_runtime_json_object(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if not text:
        raise RuntimeError("Model returned empty content for runtime agent decision")

    # Handle fenced markdown JSON responses from models that ignore strict instructions.
    if text.startswith("```"):
        fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.DOTALL)
        if fenced:
            text = fenced.group(1).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Some models emit multiple JSON objects back-to-back (often a corrected retry).
        # Parse sequential objects and prefer the last valid dict.
        decoder = json.JSONDecoder()
        parsed_candidates: list[dict[str, Any]] = []
        index = 0
        while index < len(text):
            while index < len(text) and text[index].isspace():
                index += 1
            if index >= len(text):
                break
            if text[index] != "{":
                next_start = text.find("{", index + 1)
                if next_start < 0:
                    break
                index = next_start
                continue
            try:
                value, end_index = decoder.raw_decode(text, index)
            except json.JSONDecodeError:
                next_start = text.find("{", index + 1)
                if next_start < 0:
                    break
                index = next_start
                continue
            if isinstance(value, dict):
                parsed_candidates.append(value)
            index = max(end_index, index + 1)
        if parsed_candidates:
            parsed = parsed_candidates[-1]
        else:
            start = text.find("{")
            end = text.rfind("}")
            if start >= 0 and end > start:
                try:
                    parsed = json.loads(text[start : end + 1])
                except json.JSONDecodeError as exc:
                    raise RuntimeError(f"Model returned invalid JSON for runtime agent decision: {exc}") from exc
            else:
                raise RuntimeError("Model did not return a JSON object for runtime agent decision")

    if not isinstance(parsed, dict):
        raise RuntimeError("Model returned non-object JSON for runtime agent decision")
    return parsed


def _parse_runtime_json_object_with_context(raw_text: str) -> dict[str, Any]:
    try:
        return _parse_runtime_json_object(raw_text)
    except RuntimeError as exc:
        preview = truncate_for_runtime((raw_text or "").strip(), 800)
        if preview:
            raise RuntimeError(f"{exc} | Raw preview: {preview}") from exc
        raise


def _invoke_runtime_agent_decision(system_prompt: str, prompt_payload: dict[str, Any]) -> RuntimeAgentDecision:
    user_text = "Choose the next action for this node and return structured JSON only.\n\n" + _safe_json_preview(
        prompt_payload,
        max_chars=18_000,
    )
    schema_text = _safe_json_preview(RuntimeAgentDecision.model_json_schema(), max_chars=12_000)

    # Prefer the OpenAI SDK path first because json_object response_format is much more reliable than prompt-only JSON.
    if OpenAI is not None:
        client = _runtime_openai_client()
        response = client.chat.completions.create(
            model=_runtime_model_name(),
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        system_prompt
                        + "\n\nReturn a JSON object matching this schema (fields may be empty when unused):\n"
                        + schema_text
                    ),
                },
                {"role": "user", "content": user_text},
            ],
        )
        if not getattr(response, "choices", None):
            raise RuntimeError("OpenAI returned no choices for runtime agent decision")
        message = response.choices[0].message
        raw_text = _extract_openai_text_content(message)
        parsed = _parse_runtime_json_object_with_context(raw_text)
        return RuntimeAgentDecision.model_validate(parsed)

    if ChatOpenAI is not None:
        llm = _runtime_llm()
        try:
            llm = llm.bind(response_format={"type": "json_object"})
        except Exception:
            # Older langchain_openai versions may not support bind(response_format=...); continue with prompt-only JSON.
            pass

        base_messages = [
            ("system", system_prompt),
            (
                "human",
                user_text
                + "\n\nReturn a JSON object matching this schema (fields may be empty when unused):\n"
                + schema_text,
            ),
        ]
        last_raw_text = ""
        last_error: Exception | None = None
        for attempt in range(2):
            messages = list(base_messages)
            if attempt > 0:
                messages.append(
                    (
                        "human",
                        "Your previous response was invalid JSON. Return ONLY corrected JSON. "
                        "Do not add commentary or markdown fences.\n\nPrevious response:\n"
                        + truncate_for_runtime(last_raw_text, 4_000),
                    )
                )
            message = llm.invoke(messages)
            raw_text = _extract_openai_text_content(message)
            last_raw_text = raw_text
            try:
                parsed = _parse_runtime_json_object_with_context(raw_text)
                return RuntimeAgentDecision.model_validate(parsed)
            except Exception as exc:
                last_error = exc
                continue
        if last_error is not None:
            raise last_error

    # Preserve the original error shape if neither client path is available.
    _runtime_openai_client()
    raise RuntimeError("No runtime LLM client is available")


def _safe_json_preview(value: Any, *, max_chars: int = 12_000) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, default=str)
    except Exception:
        text = str(value)
    return truncate_for_runtime(text, max_chars)


def _truncate_deep(value: Any, *, max_depth: int = 5, max_items: int = 12, max_text: int = 4_000, _depth: int = 0) -> Any:
    if _depth >= max_depth:
        if isinstance(value, (dict, list, tuple)):
            return {"_truncated": True, "_type": type(value).__name__}
        if isinstance(value, str):
            return truncate_for_runtime(value, max_text)
        return value

    if isinstance(value, str):
        return truncate_for_runtime(value, max_text)

    if isinstance(value, (int, float, bool)) or value is None:
        return value

    if isinstance(value, list):
        items = [
            _truncate_deep(item, max_depth=max_depth, max_items=max_items, max_text=max_text, _depth=_depth + 1)
            for item in value[:max_items]
        ]
        if len(value) > max_items:
            items.append({"_truncated_items": len(value) - max_items})
        return items

    if isinstance(value, tuple):
        return _truncate_deep(list(value), max_depth=max_depth, max_items=max_items, max_text=max_text, _depth=_depth)

    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= max_items:
                result["_truncated_keys"] = len(value) - max_items
                break
            result[str(key)] = _truncate_deep(
                item,
                max_depth=max_depth,
                max_items=max_items,
                max_text=max_text,
                _depth=_depth + 1,
            )
        return result

    return truncate_for_runtime(str(value), max_text)


def _looks_like_uploaded_file(value: Any) -> bool:
    return isinstance(value, dict) and isinstance(value.get("name"), str) and (
        "mimeType" in value or "kind" in value or "content" in value
    )


def _summarize_uploaded_file(value: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "id": value.get("id"),
        "name": value.get("name"),
        "mimeType": value.get("mimeType"),
        "sizeBytes": value.get("sizeBytes"),
        "kind": value.get("kind"),
        "truncated": bool(value.get("truncated")),
    }
    content = value.get("content")
    if isinstance(content, str):
        if value.get("kind") == "text":
            summary["textExcerpt"] = truncate_for_runtime(content, 5_000)
        else:
            summary["contentPreview"] = truncate_for_runtime(content, 240)
    return _truncate_deep(summary, max_text=5_000)


def _summarize_run_inputs_for_model(run_inputs: dict[str, Any]) -> dict[str, Any]:
    summarized: dict[str, Any] = {}
    for key, value in (run_inputs or {}).items():
        if isinstance(value, list) and value and all(_looks_like_uploaded_file(item) for item in value):
            summarized[key] = [_summarize_uploaded_file(item) for item in value[:8]]
            if len(value) > 8:
                summarized[key].append({"_truncated_items": len(value) - 8})
            continue
        if _looks_like_uploaded_file(value):
            summarized[key] = _summarize_uploaded_file(value)
            continue
        summarized[key] = _truncate_deep(value)
    return summarized


def _summarize_upstream_inputs_for_model(upstream_inputs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summarized: list[dict[str, Any]] = []
    for item in upstream_inputs[:12]:
        packet = item.get("packet") if isinstance(item.get("packet"), dict) else {}
        packet_payload = packet.get("payload") if isinstance(packet, dict) and isinstance(packet.get("payload"), dict) else {}
        packet_workspace_refs = packet_payload.get("workspaceRefs") if isinstance(packet_payload, dict) else None
        output = item.get("output") if isinstance(item.get("output"), dict) else {}
        output_data = output.get("data") if isinstance(output, dict) and isinstance(output.get("data"), dict) else {}
        output_workspace_refs = output_data.get("workspaceRefs") if isinstance(output_data, dict) else None
        summarized.append(
            {
                "fromNodeId": item.get("fromNodeId"),
                "fromNodeName": item.get("fromNodeName"),
                "handoff": item.get("handoff"),
                "packetSummary": item.get("packetSummary"),
                "packet": _truncate_deep(packet),
                "workspaceRefs": _truncate_deep(packet_workspace_refs if packet_workspace_refs is not None else output_workspace_refs),
                "outputSummary": item.get("outputSummary"),
                "output": _truncate_deep(output),
            }
        )
    if len(upstream_inputs) > 12:
        summarized.append({"_truncated_items": len(upstream_inputs) - 12})
    return summarized


def _tool_catalog_for_model() -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for tool in _list_runtime_tools():
        schema = tool.get("input_schema") if isinstance(tool, dict) else None
        properties = {}
        required = []
        if isinstance(schema, dict):
            raw_props = schema.get("properties")
            if isinstance(raw_props, dict):
                for key, prop in list(raw_props.items())[:20]:
                    if isinstance(prop, dict):
                        properties[str(key)] = {
                            "type": prop.get("type"),
                            "description": truncate_for_runtime(str(prop.get("description") or ""), 240),
                            "enum": _truncate_deep(prop.get("enum"), max_items=12, max_text=120),
                        }
            raw_required = schema.get("required")
            if isinstance(raw_required, list):
                required = [str(item) for item in raw_required[:20]]
        catalog.append(
            {
                "name": tool.get("name"),
                "description": tool.get("description"),
                "required_args": required,
                "args": properties,
                "limitations": _truncate_deep(tool.get("limitations") or [], max_items=8, max_text=200),
            }
        )
    return catalog


def _sanitize_tool_result_for_runtime(result: Any) -> Any:
    return _truncate_deep(result, max_depth=6, max_items=15, max_text=6_000)


def _normalize_workspace_ref(value: Any) -> dict[str, Any] | None:
    if isinstance(value, str):
        path = value.strip()
        if not path:
            return None
        return {"path": path, "kind": "file"}

    if not isinstance(value, dict):
        return None

    path = str(value.get("path") or value.get("file") or value.get("relativePath") or "").strip()
    if not path:
        return None

    ref: dict[str, Any] = {"path": path}
    for key in ("kind", "role", "operation", "sourceTool", "status", "note", "purpose", "cwd"):
        raw = value.get(key)
        if isinstance(raw, str) and raw.strip():
            ref[key] = raw.strip()[:240]
    for key in ("sizeBytes", "fileCount"):
        raw = value.get(key)
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            ref[key] = raw
    return ref


def _workspace_refs_from_tool_result(tool_name: str, tool_result: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(tool_result, dict):
        return []
    result = tool_result.get("result")
    if not isinstance(result, dict):
        return []

    refs: list[dict[str, Any]] = []

    def add_ref(ref: Any) -> None:
        normalized = _normalize_workspace_ref(ref)
        if normalized:
            refs.append(normalized)

    if tool_name == "workspace_write_file":
        mode = str(result.get("mode") or "").strip().lower()
        if mode == "batch":
            for item in (result.get("written_files") or [])[:80]:
                if isinstance(item, dict):
                    add_ref(
                        {
                            "path": item.get("path"),
                            "kind": "file",
                            "operation": "write",
                            "sourceTool": tool_name,
                            "sizeBytes": item.get("size_bytes"),
                        }
                    )
        else:
            add_ref(
                {
                    "path": result.get("path"),
                    "kind": "file",
                    "operation": "write",
                    "sourceTool": tool_name,
                    "sizeBytes": result.get("size_bytes"),
                }
            )
    elif tool_name == "workspace_read_file":
        add_ref(
            {
                "path": result.get("path"),
                "kind": "file",
                "operation": "read",
                "sourceTool": tool_name,
                "sizeBytes": result.get("size_bytes"),
            }
        )
    elif tool_name == "workspace_exec":
        add_ref(
            {
                "path": result.get("script_path"),
                "kind": "script",
                "operation": "exec",
                "sourceTool": tool_name,
                "cwd": str(result.get("cwd") or "."),
            }
        )
        for artifact in (result.get("artifacts") or [])[:80]:
            if isinstance(artifact, dict):
                add_ref(
                    {
                        "path": artifact.get("path"),
                        "kind": "file",
                        "operation": "exec_artifact",
                        "sourceTool": tool_name,
                        "sizeBytes": artifact.get("size_bytes"),
                    }
                )
    elif tool_name == "workspace_list_files":
        add_ref(
            {
                "path": result.get("path"),
                "kind": "directory",
                "operation": "list",
                "sourceTool": tool_name,
                "fileCount": result.get("count"),
            }
        )
    return refs


def _merge_workspace_refs(*groups: Any, max_items: int = 120) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in groups:
        items = group if isinstance(group, list) else [group]
        for item in items:
            normalized = _normalize_workspace_ref(item)
            if not normalized:
                continue
            key = "|".join(
                [
                    str(normalized.get("path") or ""),
                    str(normalized.get("operation") or ""),
                    str(normalized.get("kind") or ""),
                    str(normalized.get("sourceTool") or ""),
                ]
            )
            if key in seen:
                continue
            seen.add(key)
            merged.append(normalized)
            if len(merged) >= max_items:
                return merged
    return merged


def _extract_text_candidate(node_output: dict[str, Any], *paths: tuple[str, ...]) -> str:
    for path in paths:
        current: Any = node_output
        ok = True
        for part in path:
            if not isinstance(current, dict) or part not in current:
                ok = False
                break
            current = current[part]
        if ok and isinstance(current, str) and current.strip():
            return current.strip()
    return ""


def _is_code_deliverable_name(name: str) -> bool:
    lowered = (name or "").strip().lower()
    return any(token in lowered for token in ("code", "app", "bundle", "source", "repo"))


def _safe_fs_name(value: str, fallback: str = "item") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (value or "").strip()).strip("._")
    return cleaned[:120] or fallback


def _safe_bundle_rel_path(raw_path: str) -> str | None:
    path = (raw_path or "").strip().replace("\\", "/")
    if not path:
        return None
    path = re.sub(r"/+", "/", path).lstrip("/")
    if not path:
        return None
    parts = [part for part in path.split("/") if part and part not in {".", ".."}]
    if not parts:
        return None
    safe_parts = [_safe_fs_name(part, fallback="file") for part in parts]
    return "/".join(safe_parts)


def _extract_code_bundle_files(payload: Any) -> dict[str, str] | None:
    if not isinstance(payload, dict):
        return None
    raw_files = payload.get("files")
    if not isinstance(raw_files, dict):
        return None

    files: dict[str, str] = {}
    for raw_path, raw_content in raw_files.items():
        if not isinstance(raw_path, str):
            continue
        safe_rel = _safe_bundle_rel_path(raw_path)
        if not safe_rel:
            continue
        if isinstance(raw_content, str):
            files[safe_rel] = raw_content
        elif raw_content is None:
            files[safe_rel] = ""
        else:
            files[safe_rel] = _safe_json_preview(raw_content, max_chars=50_000)

    return files or None


def _runtime_artifacts_root() -> Path:
    configured = (os.getenv("WORKFLOW_RUN_ARTIFACTS_DIR") or "").strip()
    if configured:
        base = Path(configured).expanduser()
        if not base.is_absolute():
            base = Path(__file__).resolve().parents[1] / base
    else:
        base = Path(__file__).resolve().parents[1] / ".ninth-seat-artifacts" / "workflow-runs"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _run_artifact_dir(run: dict[str, Any]) -> Path:
    root = _runtime_artifacts_root()
    return root / _safe_fs_name(str(run.get("id") or "run"), "run")


def _decode_uploaded_data_url(data_url: str) -> tuple[bytes, str]:
    if not data_url.startswith("data:"):
        raise ValueError("Not a data URL")
    header, sep, payload = data_url.partition(",")
    if not sep:
        raise ValueError("Malformed data URL")
    if ";base64" in header.lower():
        try:
            return base64.b64decode(payload, validate=False), "base64"
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Invalid base64 data URL payload") from exc
    return urllib.parse.unquote_to_bytes(payload), "urlencoded"


def _collect_uploaded_files_from_inputs(run_inputs: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    collected: list[tuple[str, dict[str, Any]]] = []
    for key, value in (run_inputs or {}).items():
        if _looks_like_uploaded_file(value):
            collected.append((str(key), value))
            continue
        if isinstance(value, list):
            for item in value:
                if _looks_like_uploaded_file(item):
                    collected.append((str(key), item))
    return collected


def _write_json_file(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _prepare_run_workspace(run: dict[str, Any]) -> dict[str, Any]:
    run_dir = _run_artifact_dir(run)
    workspace_root = run_dir / "workspace"
    agent_scripts_dir = workspace_root / "agent_scripts"
    user_uploads_dir = workspace_root / "user_uploads"
    inputs_dir = workspace_root / "inputs"
    deliverables_dir = workspace_root / "deliverables"

    for directory in (workspace_root, agent_scripts_dir, user_uploads_dir, inputs_dir, deliverables_dir):
        directory.mkdir(parents=True, exist_ok=True)

    run_inputs = run.get("inputs") if isinstance(run.get("inputs"), dict) else {}
    _write_json_file(inputs_dir / "run_inputs.json", run_inputs or {})
    _write_json_file(
        inputs_dir / "run_context.json",
        {
            "runId": run.get("id"),
            "workflowId": run.get("workflowId"),
            "workflowName": run.get("workflowName"),
            "requestedDeliverables": run.get("requestedDeliverables") or [],
            "createdAt": run.get("createdAt"),
        },
    )

    uploaded_files_manifest: list[dict[str, Any]] = []
    name_counters: dict[str, int] = {}

    for input_key, file_payload in _collect_uploaded_files_from_inputs(run_inputs or {}):
        safe_group = _safe_fs_name(input_key, "uploads")
        target_group_dir = user_uploads_dir / safe_group
        target_group_dir.mkdir(parents=True, exist_ok=True)

        original_name = str(file_payload.get("name") or "upload").strip() or "upload"
        safe_name = _safe_fs_name(original_name, "upload")
        if "." not in safe_name and "." in original_name:
            suffix = "".join(ch for ch in Path(original_name).suffix if ch.isalnum() or ch == ".")
            if suffix:
                safe_name = f"{safe_name}{suffix[:12]}"

        counter_key = f"{safe_group}/{safe_name}"
        occurrence = name_counters.get(counter_key, 0) + 1
        name_counters[counter_key] = occurrence
        if occurrence > 1:
            stem, dot, ext = safe_name.partition(".")
            safe_name = f"{stem}_{occurrence}" + (f".{ext}" if dot else "")

        destination = target_group_dir / safe_name
        kind = str(file_payload.get("kind") or "").strip().lower()
        content = file_payload.get("content")
        truncated = bool(file_payload.get("truncated"))
        write_mode = "text"
        decode_status = "not_attempted"

        if kind == "text" and isinstance(content, str):
            destination.write_text(content, encoding="utf-8")
            decode_status = "ok"
        elif kind == "data_url" and isinstance(content, str):
            try:
                decoded_bytes, decode_status = _decode_uploaded_data_url(content)
                destination.write_bytes(decoded_bytes)
                write_mode = "binary"
            except Exception:
                fallback_path = destination.with_suffix(destination.suffix + ".data-url.txt")
                fallback_path.write_text(content, encoding="utf-8")
                destination = fallback_path
                decode_status = "failed_saved_raw_data_url"
        elif isinstance(content, str):
            destination.write_text(content, encoding="utf-8")
            decode_status = "ok"
        else:
            placeholder = {
                "warning": "Upload payload did not include decodable content.",
                "originalName": original_name,
                "mimeType": file_payload.get("mimeType"),
                "sizeBytes": file_payload.get("sizeBytes"),
                "kind": file_payload.get("kind"),
            }
            destination = destination.with_suffix(destination.suffix + ".json")
            _write_json_file(destination, placeholder)
            decode_status = "placeholder_written"

        sidecar_needed = truncated or decode_status not in {"ok", "base64", "urlencoded"}
        sidecar_path = None
        if sidecar_needed:
            sidecar_path = destination.with_suffix(destination.suffix + ".upload_meta.json")
            _write_json_file(
                sidecar_path,
                {
                    "inputKey": input_key,
                    "originalName": original_name,
                    "savedPath": str(destination),
                    "mimeType": file_payload.get("mimeType"),
                    "sizeBytes": file_payload.get("sizeBytes"),
                    "kind": file_payload.get("kind"),
                    "truncated": truncated,
                    "decodeStatus": decode_status,
                },
            )

        uploaded_files_manifest.append(
            {
                "inputKey": input_key,
                "name": original_name,
                "savedPath": str(destination),
                "relativePath": destination.relative_to(workspace_root).as_posix(),
                "mimeType": file_payload.get("mimeType"),
                "sizeBytes": file_payload.get("sizeBytes"),
                "kind": file_payload.get("kind"),
                "truncated": truncated,
                "writeMode": write_mode,
                "decodeStatus": decode_status,
                "metadataPath": sidecar_path.relative_to(workspace_root).as_posix() if sidecar_path else None,
            }
        )

    if uploaded_files_manifest:
        _write_json_file(inputs_dir / "uploaded_files_manifest.json", uploaded_files_manifest)

    workspace_info = {
        "root": str(workspace_root),
        "directories": {
            "agentScripts": str(agent_scripts_dir),
            "userUploads": str(user_uploads_dir),
            "inputs": str(inputs_dir),
            "deliverables": str(deliverables_dir),
        },
        "userUploads": _truncate_deep(uploaded_files_manifest, max_items=100, max_text=2_000),
        "createdAt": _now_iso(),
    }

    run["workspace"] = workspace_info
    run["workspaceDirectory"] = str(workspace_root)
    run["workspaceDirectories"] = workspace_info["directories"]
    return workspace_info


def _persist_run_deliverables(
    run: dict[str, Any],
    deliverables: list[dict[str, Any]],
    sink_deliverable_map: dict[str, Any],
) -> dict[str, Any]:
    run_dir = _run_artifact_dir(run)
    deliverables_dir = None
    workspace = run.get("workspace")
    if isinstance(workspace, dict):
        directories = workspace.get("directories")
        if isinstance(directories, dict):
            workspace_deliverables = directories.get("deliverables")
            if isinstance(workspace_deliverables, str) and workspace_deliverables.strip():
                try:
                    deliverables_dir = Path(workspace_deliverables).expanduser().resolve()
                except Exception:
                    deliverables_dir = None
    if deliverables_dir is None:
        deliverables_dir = run_dir / "deliverables"
    deliverables_dir.mkdir(parents=True, exist_ok=True)

    written_items: list[dict[str, Any]] = []
    used_names: set[str] = set()

    for index, deliverable in enumerate(deliverables):
        name = str(deliverable.get("name") or f"deliverable_{index + 1}").strip() or f"deliverable_{index + 1}"
        candidate = _safe_fs_name(name, fallback=f"deliverable_{index + 1}")
        unique_name = candidate
        suffix = 2
        while unique_name in used_names:
            stem, dot, ext = candidate.partition(".")
            unique_name = f"{stem}_{suffix}" + (f".{ext}" if dot else "")
            suffix += 1
        used_names.add(unique_name)

        requested_payload = sink_deliverable_map.get(name)
        bundle_files = _extract_code_bundle_files(requested_payload)

        if bundle_files:
            bundle_dir = deliverables_dir / unique_name
            bundle_dir.mkdir(parents=True, exist_ok=True)
            written_count = 0
            for rel_path, file_content in bundle_files.items():
                destination = bundle_dir / rel_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(file_content, encoding="utf-8")
                written_count += 1

            manifest = {
                "name": name,
                "kind": "code_bundle",
                "file_count": written_count,
                "files": sorted(bundle_files.keys()),
            }
            (bundle_dir / "_manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            metadata = deliverable.setdefault("metadata", {})
            if isinstance(metadata, dict):
                metadata["artifactKind"] = "directory"
                metadata["artifactPath"] = str(bundle_dir)
                metadata["artifactFileCount"] = written_count

            deliverable["type"] = "code_bundle"
            deliverable["mimeType"] = "application/x-directory"
            deliverable["preview"] = truncate_for_runtime(
                f"{name}: code bundle with {written_count} file(s): " + ", ".join(sorted(bundle_files.keys())[:6]),
                500,
            )
            deliverable["content"] = _safe_json_preview({"kind": "code_bundle", "files": sorted(bundle_files.keys())}, max_chars=20_000)

            written_items.append(
                {
                    "name": name,
                    "artifactKind": "directory",
                    "path": str(bundle_dir),
                    "fileCount": written_count,
                }
            )
            continue

        target_path = deliverables_dir / unique_name
        content = deliverable.get("content")
        if isinstance(content, str):
            text_content = content
        elif content is None:
            text_content = ""
        else:
            text_content = _safe_json_preview(content, max_chars=100_000)
        target_path.write_text(text_content, encoding="utf-8")

        metadata = deliverable.setdefault("metadata", {})
        if isinstance(metadata, dict):
            metadata["artifactKind"] = "file"
            metadata["artifactPath"] = str(target_path)
            metadata["artifactSizeBytes"] = target_path.stat().st_size

        written_items.append(
            {
                "name": name,
                "artifactKind": "file",
                "path": str(target_path),
                "sizeBytes": target_path.stat().st_size,
            }
        )

    manifest_path = run_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "runId": run.get("id"),
                "workflowId": run.get("workflowId"),
                "workflowName": run.get("workflowName"),
                "createdAt": run.get("createdAt"),
                "deliverables": written_items,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return {
        "runDirectory": str(run_dir),
        "deliverablesDirectory": str(deliverables_dir),
        "manifestPath": str(manifest_path),
        "items": written_items,
    }


def _build_real_node_output(
    *,
    run: dict[str, Any],
    node: dict[str, Any],
    upstream_inputs: list[dict[str, Any]],
    live_log_callback: Any | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    run_inputs = run.get("inputs") if isinstance(run.get("inputs"), dict) else {}
    summarized_inputs = _summarize_run_inputs_for_model(run_inputs or {})
    summarized_upstream = _summarize_upstream_inputs_for_model(upstream_inputs)
    tool_catalog = _tool_catalog_for_model()
    workspace_info = run.get("workspace") if isinstance(run.get("workspace"), dict) else None
    is_sink_node = not bool(run["_meta"]["outgoingEdges"].get(node["id"]))
    requested_deliverables = [str(item).strip() for item in (run.get("requestedDeliverables") or []) if str(item).strip()]
    required_code_deliverables = [name for name in requested_deliverables if _is_code_deliverable_name(name)]
    # TODO: Tune this limit after improving agent convergence and validation retries.
    max_turns = max(1, min(int(os.getenv("WORKFLOW_NODE_MAX_STEPS", "100")), 100))

    step_history: list[dict[str, Any]] = []
    tool_call_summaries: list[dict[str, Any]] = []
    auto_workspace_refs: list[dict[str, Any]] = []
    trace_events: list[dict[str, Any]] = [
        {
            "category": "thinking",
            "title": "Agent runtime initialized",
            "message": f"Executing {node.get('name') or node['id']} with model {_runtime_model_name()} and real tool access.",
            "payload": {
                "model": _runtime_model_name(),
                "sinkNode": is_sink_node,
                "workspaceRoot": workspace_info.get("root") if isinstance(workspace_info, dict) else None,
            },
        }
    ]

    def _flush_trace_event(event: dict[str, Any]) -> None:
        """Append a trace event and optionally flush it to the live run via callback."""
        trace_events.append(event)
        if live_log_callback:
            try:
                live_log_callback(event)
            except Exception:
                pass  # Best-effort live flush; events are still in trace_events for batch fallback

    system_prompt = (
        "You are an execution agent in a DAG-based workflow runtime. "
        "You must complete the current node's objective using the provided workflow inputs and upstream handoffs. "
        "You may request exactly one tool call at a time using action='tool', or finish with action='final'. "
        "Do not fabricate tool results. Only use tools listed in the tool catalog. "
        "When you finish, produce a concise but concrete summary and structured details/data. "
        "Include useful artifacts in data when available (e.g., code snippets, plans, findings, URLs, commands, file names). "
        "If this is a sink/final node, include user-facing output in data.final_markdown when possible. "
        "If the workflow has requested deliverables, include a data.deliverables object keyed by deliverable name. "
        "For code deliverables, use {kind:'code_bundle', files:{'relative/path.ext':'file content', ...}} with real file contents.\n"
        "IMPORTANT: If a tool call returns no useful new information, do NOT keep retrying the same tool. "
        "Use the information already available from upstream handoffs, run inputs, and previous tool results. "
        "If you cannot find expected files in the workspace, they may not have been written by upstream agents "
        "— proceed with the information in the upstream handoff summaries and data instead of searching repeatedly. "
        "After 2-3 unsuccessful tool calls, finalize with action='final' using your best output from available context."
    )
    if workspace_info:
        system_prompt += (
            " A shared run workspace is available for all agents. "
            "Use workspace_list_files/workspace_read_file/workspace_write_file/workspace_exec to inspect and create real files. "
            "Prefer writing implementation files and generated scripts into the workspace instead of only describing them. "
            "Track important workspace files you created/read/updated in data.workspaceRefs as path-based references (not full file contents). "
            "Downstream agents will use these references to continue work in the shared workspace."
        )

    _consecutive_tool_counts: dict[str, int] = {}  # tool_name -> consecutive count
    _last_tool_name: str | None = None

    for turn_index in range(max_turns):
        prompt_payload = {
            "workflow": {
                "id": run.get("workflowId"),
                "name": run.get("workflowName"),
                "prompt": truncate_for_runtime(str(run.get("workflowPrompt") or ""), 4_000),
                "summary": truncate_for_runtime(str(run.get("workflowSummary") or ""), 2_000),
                "requestedDeliverables": requested_deliverables[:20],
            },
            "node": {
                "id": node.get("id"),
                "name": node.get("name"),
                "role": node.get("role"),
                "objective": node.get("objective"),
                "isSinkNode": is_sink_node,
            },
            "runInputs": summarized_inputs,
            "upstreamHandoffs": summarized_upstream,
            "workspace": _truncate_deep(workspace_info, max_depth=5, max_items=20, max_text=4000) if workspace_info else None,
            "toolCatalog": tool_catalog,
            "history": step_history,
            "constraints": {
                "maxTurns": max_turns,
                "currentTurn": turn_index + 1,
                "preferFinalWhenEnoughContext": True,
            },
        }

        decision = _invoke_runtime_agent_decision(system_prompt, prompt_payload)

        status_note = decision.status_note.strip() or (
            "Requested a tool call." if decision.action == "tool" else "Prepared final node output."
        )
        thinking_payload: dict[str, Any] = {
            "turn": turn_index + 1,
            "action": decision.action,
            "statusNote": status_note,
        }
        # Enrich thinking events with decision context
        if decision.action == "tool" and decision.tool_request:
            thinking_payload["toolRequested"] = decision.tool_request.tool.strip()
            thinking_payload["toolReason"] = truncate_for_runtime(decision.tool_request.reason or "", 300)
        elif decision.action == "final":
            thinking_payload["summaryPreview"] = truncate_for_runtime(decision.summary or "", 200)
            if decision.data and isinstance(decision.data, dict):
                thinking_payload["dataKeys"] = sorted(list(decision.data.keys()))[:12]
        _flush_trace_event(
            {
                "category": "thinking",
                "title": f"Agent step {turn_index + 1}",
                "message": truncate_for_runtime(status_note, 240),
                "payload": thinking_payload,
            }
        )

        if decision.action == "tool":
            tool_request = decision.tool_request
            if tool_request is None:
                step_history.append(
                    {
                        "turn": turn_index + 1,
                        "action": "tool_error",
                        "error": "Model selected action='tool' without tool_request payload.",
                    }
                )
                trace_events.append(
                    {
                        "category": "error",
                        "title": "Invalid tool request",
                        "message": "Model selected action='tool' without tool_request payload.",
                        "payload": None,
                    }
                )
                continue

            tool_name = tool_request.tool.strip()
            tool_args = tool_request.args if isinstance(tool_request.args, dict) else {}

            # --- Repetition detection / circuit breaker ---
            if tool_name == _last_tool_name:
                _consecutive_tool_counts[tool_name] = _consecutive_tool_counts.get(tool_name, 1) + 1
            else:
                _consecutive_tool_counts = {tool_name: 1}
            _last_tool_name = tool_name
            repeat_count = _consecutive_tool_counts.get(tool_name, 1)

            if repeat_count >= 5:
                # Hard circuit breaker — force the agent to finalize
                _flush_trace_event(
                    {
                        "category": "error",
                        "title": "Circuit breaker triggered",
                        "message": f"Forced finalization after {repeat_count} consecutive {tool_name} calls.",
                        "payload": {"tool": tool_name, "consecutiveCount": repeat_count},
                    }
                )
                step_history.append(
                    {
                        "turn": turn_index + 1,
                        "action": "circuit_breaker",
                        "reason": (
                            f"CIRCUIT BREAKER: You called {tool_name} {repeat_count} times in a row with no new results. "
                            "You MUST finalize NOW with action='final'. Use information from upstream handoffs and run inputs. "
                            "Do NOT call any more tools. Produce your best output from available context."
                        ),
                    }
                )
                continue

            if repeat_count >= 3:
                # Soft warning — inject into history to steer the model
                step_history.append(
                    {
                        "turn": turn_index + 1,
                        "action": "repetition_warning",
                        "reason": (
                            f"WARNING: You have called {tool_name} {repeat_count} consecutive times. "
                            "The data you are looking for may not exist in the workspace. "
                            "Upstream agents may have described outputs conceptually without writing files. "
                            "Use the information from 'upstreamHandoffs' and 'runInputs' directly. "
                            "Finalize with action='final' on your next turn using the best available context."
                        ),
                    }
                )
                _flush_trace_event(
                    {
                        "category": "thinking",
                        "title": "Repetition warning",
                        "message": f"{tool_name} called {repeat_count} consecutive times — warning injected.",
                        "payload": {"tool": tool_name, "consecutiveCount": repeat_count},
                    }
                )

            _flush_trace_event(
                {
                    "category": "control",
                    "title": "Tool call requested",
                    "message": f"{tool_name} ({truncate_for_runtime(tool_request.reason or 'no reason provided', 180)})",
                    "payload": {"tool": tool_name, "args": _truncate_deep(tool_args, max_depth=5, max_items=16, max_text=2000), "reason": tool_request.reason or ""},
                }
            )

            started = time.perf_counter()
            try:
                tool_result = _run_runtime_tool(
                    tool_name,
                    tool_args,
                    {
                        "workspace": _deepcopy_jsonish(workspace_info) if workspace_info else None,
                        "run_id": run.get("id"),
                        "node_id": node.get("id"),
                        "node_name": node.get("name"),
                    },
                )
                sanitized_result = _sanitize_tool_result_for_runtime(tool_result)
                duration_ms = round((time.perf_counter() - started) * 1000, 2)
                auto_workspace_refs = _merge_workspace_refs(
                    auto_workspace_refs,
                    _workspace_refs_from_tool_result(tool_name, tool_result),
                )
                tool_call_summaries.append(
                    {
                        "tool": tool_name,
                        "reason": tool_request.reason,
                        "args": _truncate_deep(tool_args),
                        "durationMs": duration_ms,
                        "ok": True,
                        "result": sanitized_result,
                    }
                )
                step_history.append(
                    {
                        "turn": turn_index + 1,
                        "action": "tool_result",
                        "tool": tool_name,
                        "reason": tool_request.reason,
                        "args": _truncate_deep(tool_args),
                        "result": sanitized_result,
                    }
                )
                tool_ws_refs = _workspace_refs_from_tool_result(tool_name, tool_result)
                _flush_trace_event(
                    {
                        "category": "output",
                        "title": "Tool call completed",
                        "message": f"{tool_name} completed in {duration_ms}ms.",
                        "payload": {
                            "tool": tool_name,
                            "args": _truncate_deep(tool_args, max_depth=4, max_items=12, max_text=1500),
                            "result": _truncate_deep(sanitized_result, max_depth=5, max_items=16, max_text=4000),
                            "durationMs": duration_ms,
                            "workspaceRefs": _truncate_deep(tool_ws_refs, max_items=20),
                        },
                    }
                )
            except Exception as exc:
                error_payload = {"tool": tool_name, "args": _truncate_deep(tool_args), "error": str(exc)}
                tool_call_summaries.append(
                    {
                        "tool": tool_name,
                        "reason": tool_request.reason,
                        "args": _truncate_deep(tool_args),
                        "ok": False,
                        "error": str(exc),
                    }
                )
                step_history.append(
                    {
                        "turn": turn_index + 1,
                        "action": "tool_error",
                        "tool": tool_name,
                        "reason": tool_request.reason,
                        "args": _truncate_deep(tool_args),
                        "error": str(exc),
                    }
                )
                _flush_trace_event(
                    {
                        "category": "error",
                        "title": "Tool call failed",
                        "message": f"{tool_name} failed: {truncate_for_runtime(str(exc), 220)}",
                        "payload": error_payload,
                    }
                )
            continue

        summary = decision.summary.strip()
        if not summary:
            summary = f"{node.get('name') or node['id']} completed its step."

        details = decision.details if isinstance(decision.details, dict) else {}
        data = decision.data if isinstance(decision.data, dict) else {}
        model_workspace_refs = data.get("workspaceRefs") if isinstance(data, dict) else None
        merged_workspace_refs = _merge_workspace_refs(auto_workspace_refs, model_workspace_refs)
        if isinstance(data, dict) and merged_workspace_refs:
            data["workspaceRefs"] = merged_workspace_refs

        if is_sink_node and required_code_deliverables:
            raw_deliverables = data.get("deliverables") if isinstance(data, dict) else None
            missing_code_bundles: list[str] = []
            if not isinstance(raw_deliverables, dict):
                missing_code_bundles = required_code_deliverables[:]
            else:
                for deliverable_name in required_code_deliverables:
                    payload = raw_deliverables.get(deliverable_name)
                    if _extract_code_bundle_files(payload) is None:
                        missing_code_bundles.append(deliverable_name)

            if missing_code_bundles:
                guidance = (
                    "Sink node output missing required code bundle deliverables: "
                    + ", ".join(missing_code_bundles)
                    + ". Return data.deliverables.<name> = {kind:'code_bundle', files:{...}}."
                )
                step_history.append(
                    {
                        "turn": turn_index + 1,
                        "action": "validation_retry",
                        "reason": guidance,
                    }
                )
                trace_events.append(
                    {
                        "category": "thinking",
                        "title": "Deliverable contract incomplete",
                        "message": truncate_for_runtime(guidance, 240),
                        "payload": {"missingCodeBundles": missing_code_bundles},
                    }
                )
                if turn_index + 1 < max_turns:
                    continue
                raise RuntimeError(guidance)

        details = {
            "nodeId": node["id"],
            "nodeName": node.get("name") or node["id"],
            "role": node.get("role") or "",
            "objective": node.get("objective") or "",
            "toolCalls": _truncate_deep(tool_call_summaries, max_items=20, max_text=4_000),
            "workspaceRefs": _truncate_deep(merged_workspace_refs, max_items=40, max_text=2_000),
            "agentDetails": _truncate_deep(details, max_depth=6, max_items=20, max_text=6_000),
            "stepCount": turn_index + 1,
        }
        output_data = _truncate_deep(data, max_depth=6, max_items=30, max_text=10_000)
        if isinstance(output_data, dict):
            output_data.setdefault("summary", summary)
            output_data.setdefault("nodeId", node["id"])
            output_data.setdefault("nodeName", node.get("name") or node["id"])
            output_data.setdefault("toolCallCount", len(tool_call_summaries))
            if merged_workspace_refs:
                output_data["workspaceRefs"] = _truncate_deep(merged_workspace_refs, max_items=40, max_text=2_000)

        trace_events.append(
            {
                "category": "output",
                "title": "Agent output produced",
                "message": truncate_for_runtime(summary, 240),
                "payload": {
                    "summary": summary,
                    "stepCount": turn_index + 1,
                    "toolCallCount": len(tool_call_summaries),
                    "workspaceRefCount": len(merged_workspace_refs),
                    "workspaceRefs": _truncate_deep(merged_workspace_refs, max_items=12, max_text=400),
                },
            },
        )
        if merged_workspace_refs:
            trace_events.append(
                {
                    "category": "output",
                    "title": "Workspace references recorded",
                    "message": f"Recorded {len(merged_workspace_refs)} workspace reference(s) for downstream agents.",
                    "payload": {"workspaceRefs": _truncate_deep(merged_workspace_refs, max_items=24, max_text=600)},
                }
            )

        return {
            "summary": summary,
            "details": details,
            "data": output_data,
        }, trace_events

    raise RuntimeError(
        f"Node {node.get('name') or node.get('id') or 'agent'} exceeded max decision turns ({max_turns}) without final output"
    )


_RUNS: dict[str, dict[str, Any]] = {}
_RUN_THREADS: dict[str, threading.Thread] = {}
_LOCK = threading.RLock()


def _deepcopy_jsonish(value: Any) -> Any:
    return copy.deepcopy(value)


def _topological_order(node_ids: list[str], edges: list[dict[str, Any]]) -> list[str] | None:
    indegree = {node_id: 0 for node_id in node_ids}
    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for edge in edges:
        source = edge["source"]
        target = edge["target"]
        if source not in adjacency or target not in indegree:
            return None
        adjacency[source].append(target)
        indegree[target] += 1

    queue = deque([node_id for node_id in node_ids if indegree[node_id] == 0])
    ordered: list[str] = []
    while queue:
        node_id = queue.popleft()
        ordered.append(node_id)
        for target in adjacency[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if len(ordered) != len(node_ids):
        return None
    return ordered


def _build_run_from_request(request: WorkflowRunCreateRequest) -> dict[str, Any]:
    template = request.template
    node_ids = [node.id for node in template.nodes]
    if len(set(node_ids)) != len(node_ids):
        raise ValueError("Workflow template has duplicate node ids")

    edges = [edge.model_dump() for edge in template.edges]
    order = _topological_order(node_ids, edges)
    if order is None:
        raise ValueError("Workflow template must be a valid DAG")

    node_map = {node.id: node for node in template.nodes}
    incoming_edges: dict[str, list[dict[str, Any]]] = defaultdict(list)
    outgoing_edges: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        if edge["source"] not in node_map or edge["target"] not in node_map:
            raise ValueError("Workflow edges must reference existing nodes")
        if edge["source"] == edge["target"]:
            raise ValueError("Workflow edges cannot self-reference")
        incoming_edges[edge["target"]].append(edge)
        outgoing_edges[edge["source"]].append(edge)

    run_id = f"wfr_{uuid.uuid4().hex[:12]}"
    now = _now_iso()
    requested_deliverables = [
        item.strip()
        for item in request.requested_deliverables
        if isinstance(item, str) and item.strip()
    ]

    node_runs = []
    for node in template.nodes:
        node_runs.append(
            {
                "nodeId": node.id,
                "name": node.name,
                "role": node.role,
                "objective": node.objective,
                "status": "queued",
                "startedAt": None,
                "finishedAt": None,
                "durationMs": None,
                "logs": [],
                "output": None,
                "upstreamInputs": [],
            }
        )

    return {
        "id": run_id,
        "workflowId": template.id,
        "workflowName": template.name,
        "workflowPrompt": template.prompt,
        "workflowSummary": template.summary,
        "workflowSnapshot": template.model_dump(),
        "status": "queued",
        "createdAt": now,
        "startedAt": None,
        "finishedAt": None,
        "durationMs": None,
        "inputs": _deepcopy_jsonish(request.inputs),
        "requestedDeliverables": requested_deliverables,
        "outputs": {},
        "deliverables": [],
        "inputRequests": [],
        "pendingInputRequest": None,
        "cancelRequested": False,
        "error": None,
        "activeNodeId": None,
        "progress": {
            "totalNodes": len(template.nodes),
            "completedNodes": 0,
            "failedNodes": 0,
        },
        "logs": [],
        "nodeRuns": node_runs,
        "_meta": {
            "order": order,
            "nodeMap": {node.id: node.model_dump() for node in template.nodes},
            "incomingEdges": dict(incoming_edges),
            "outgoingEdges": dict(outgoing_edges),
            "nodeOutputs": {},
            "handoffPackets": {},
            "seq": 0,
        },
    }


def _find_node_run(run: dict[str, Any], node_id: str) -> dict[str, Any]:
    for node_run in run["nodeRuns"]:
        if node_run["nodeId"] == node_id:
            return node_run
    raise KeyError(f"Unknown node run: {node_id}")


def _next_log_seq(run: dict[str, Any]) -> int:
    run["_meta"]["seq"] += 1
    return run["_meta"]["seq"]


def _append_log(
    run: dict[str, Any],
    *,
    category: Literal["lifecycle", "input", "handoff", "thinking", "output", "error", "control"],
    title: str,
    message: str,
    node_id: str | None = None,
    payload: Any | None = None,
) -> dict[str, Any]:
    log = {
        "id": f"log_{uuid.uuid4().hex[:10]}",
        "seq": _next_log_seq(run),
        "timestamp": _now_iso(),
        "category": category,
        "title": title,
        "message": message,
        "nodeId": node_id,
        "payload": _deepcopy_jsonish(payload) if payload is not None else None,
    }
    run["logs"].append(log)
    if node_id:
        try:
            node_run = _find_node_run(run, node_id)
        except KeyError:
            pass
        else:
            node_run["logs"].append(copy.deepcopy(log))
    return log


def _compute_duration_ms(started_at_iso: str | None, finished_at_iso: str | None) -> float | None:
    if not started_at_iso or not finished_at_iso:
        return None
    try:
        started = datetime.fromisoformat(started_at_iso)
        finished = datetime.fromisoformat(finished_at_iso)
    except Exception:
        return None
    return round((finished - started).total_seconds() * 1000, 2)


def _sleep_with_cancel(run_id: str, seconds: float) -> bool:
    deadline = time.perf_counter() + max(0.0, seconds)
    while time.perf_counter() < deadline:
        with _LOCK:
            run = _RUNS.get(run_id)
            if not run or run.get("cancelRequested"):
                return False
        time.sleep(min(0.08, deadline - time.perf_counter()))
    return True


def _visible_thinking_notes(node: dict[str, Any], upstream_inputs: list[dict[str, Any]], run_inputs: dict[str, Any]) -> list[str]:
    notes: list[str] = []
    if upstream_inputs:
        notes.append(
            f"Reviewing {len(upstream_inputs)} upstream handoff{'s' if len(upstream_inputs) != 1 else ''} and extracting relevant facts."
        )
    else:
        notes.append("Starting from workflow prompt and user inputs because no upstream handoffs are available.")

    if node.get("objective"):
        notes.append(f"Planning work to satisfy objective: {node['objective'][:180]}")
    elif node.get("role"):
        notes.append(f"Applying role guidance: {node['role'][:180]}")

    if run_inputs:
        provided_keys = ", ".join(sorted(str(key) for key in run_inputs.keys())[:8])
        notes.append(f"Considering user-provided inputs: {provided_keys}.")
    else:
        notes.append("No explicit run inputs were provided; using template prompt only.")

    notes.append("Preparing a structured output summary plus downstream handoff notes.")
    return notes


def _slugify_runtime(value: str, fallback: str = "handoff_packet") -> str:
    safe = "".join(ch.lower() if ch.isalnum() else "_" for ch in (value or ""))
    while "__" in safe:
        safe = safe.replace("__", "_")
    safe = safe.strip("_")
    return safe or fallback


def _default_handoff_contract(edge: dict[str, Any]) -> dict[str, Any]:
    return {
        "packetType": _slugify_runtime(str(edge.get("handoff") or "handoff_packet"), "handoff_packet"),
        "fields": [
            {
                "targetKey": "summary",
                "sourcePath": "summary",
                "type": "string",
                "required": True,
                "description": "Primary summary from the source agent output.",
            },
            {
                "targetKey": "details",
                "sourcePath": "details",
                "type": "object",
                "required": False,
                "description": "Structured source agent details for downstream use.",
            },
            {
                "targetKey": "workspaceRefs",
                "sourcePath": "data.workspaceRefs",
                "type": "array",
                "required": False,
                "description": "Shared workspace file references created/used by the source agent.",
            },
        ],
    }


def _normalize_handoff_contract(edge: dict[str, Any]) -> dict[str, Any]:
    default_contract = _default_handoff_contract(edge)
    raw = edge.get("handoffContract")
    if not isinstance(raw, dict):
        return default_contract

    raw_packet_type = str(raw.get("packetType") or "").strip()
    packet_type = _slugify_runtime(raw_packet_type, default_contract["packetType"])

    normalized_fields: list[dict[str, Any]] = []
    raw_fields = raw.get("fields")
    if isinstance(raw_fields, list):
        for item in raw_fields[:20]:
            if not isinstance(item, dict):
                continue
            target_key = str(item.get("targetKey") or "").strip()
            source_path = str(item.get("sourcePath") or "").strip()
            if not target_key or not source_path:
                continue
            field_type = str(item.get("type") or "any").strip().lower() or "any"
            if field_type not in {"string", "number", "boolean", "array", "object", "json", "any"}:
                field_type = "any"
            normalized_fields.append(
                {
                    "targetKey": target_key[:80],
                    "sourcePath": source_path[:160],
                    "type": field_type,
                    "required": bool(item.get("required", True)),
                    "description": str(item.get("description") or "").strip()[:240],
                }
            )

    return {
        "packetType": packet_type[:80],
        "fields": normalized_fields or default_contract["fields"],
    }


def _json_path_get(data: Any, source_path: str) -> tuple[bool, Any]:
    path = (source_path or "").strip()
    if not path:
        return False, None
    if path in {".", "$", "output"}:
        return True, data
    if path.startswith("output."):
        path = path[7:]
    current = data
    for part in [segment for segment in path.split(".") if segment]:
        if isinstance(current, dict):
            if part not in current:
                return False, None
            current = current[part]
            continue
        if isinstance(current, list):
            try:
                index = int(part)
            except ValueError:
                return False, None
            if index < 0 or index >= len(current):
                return False, None
            current = current[index]
            continue
        return False, None
    return True, current


def _coerce_handoff_value(value: Any, field_type: str) -> Any:
    if value is None:
        return None
    if field_type in {"any", "json"}:
        return _deepcopy_jsonish(value)
    if field_type == "string":
        if isinstance(value, str):
            return value
        return str(value)
    if field_type == "number":
        if isinstance(value, bool):
            return 1 if value else 0
        if isinstance(value, (int, float)):
            return value
        if isinstance(value, str):
            try:
                return float(value) if "." in value else int(value)
            except ValueError:
                return None
        return None
    if field_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "y"}:
                return True
            if normalized in {"false", "0", "no", "n"}:
                return False
        return None
    if field_type == "array":
        if isinstance(value, list):
            return _deepcopy_jsonish(value)
        return [value]
    if field_type == "object":
        if isinstance(value, dict):
            return _deepcopy_jsonish(value)
        return {"value": _deepcopy_jsonish(value)}
    return _deepcopy_jsonish(value)


def _build_handoff_packet(
    *,
    edge: dict[str, Any],
    source_output: Any,
    source_node: dict[str, Any],
    target_node: dict[str, Any],
) -> dict[str, Any]:
    contract = _normalize_handoff_contract(edge)
    payload: dict[str, Any] = {}
    missing_required_fields: list[str] = []
    field_results: list[dict[str, Any]] = []

    for field in contract["fields"]:
        found, raw_value = _json_path_get(source_output, str(field.get("sourcePath") or ""))
        if not found and field.get("required"):
            missing_required_fields.append(str(field.get("targetKey") or ""))
        coerced = _coerce_handoff_value(raw_value if found else None, str(field.get("type") or "any"))
        target_key = str(field.get("targetKey") or "")
        if target_key:
            payload[target_key] = coerced
        field_results.append(
            {
                "targetKey": target_key,
                "sourcePath": field.get("sourcePath"),
                "type": field.get("type") or "any",
                "required": bool(field.get("required", True)),
                "resolved": bool(found),
                "description": field.get("description") or "",
            }
        )

    packet_summary = ""
    maybe_summary = payload.get("summary")
    if isinstance(maybe_summary, str) and maybe_summary.strip():
        packet_summary = maybe_summary.strip()
    elif isinstance(source_output, dict) and isinstance(source_output.get("summary"), str):
        packet_summary = source_output.get("summary", "").strip()
    if not packet_summary:
        packet_summary = f"Handoff from {source_node.get('name') or edge['source']} to {target_node.get('name') or edge['target']}."

    return {
        "id": f"hnd_{uuid.uuid4().hex[:10]}",
        "label": str(edge.get("handoff") or "").strip(),
        "packetType": contract["packetType"],
        "fromNodeId": edge["source"],
        "fromNodeName": source_node.get("name") or edge["source"],
        "toNodeId": edge["target"],
        "toNodeName": target_node.get("name") or edge["target"],
        "summary": truncate_for_runtime(packet_summary, 240),
        "payload": payload,
        "schema": {"fields": field_results},
        "missingRequiredFields": missing_required_fields,
        "generatedAt": _now_iso(),
    }


def _build_node_output(
    *,
    run: dict[str, Any],
    node: dict[str, Any],
    upstream_inputs: list[dict[str, Any]],
    live_log_callback: Any | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return _build_real_node_output(run=run, node=node, upstream_inputs=upstream_inputs, live_log_callback=live_log_callback)


def truncate_for_runtime(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return f"{text[: max(0, max_chars - 1)].rstrip()}…"


def _mark_cancelled(run: dict[str, Any]) -> None:
    now = _now_iso()
    if run["status"] not in {"success", "failed", "cancelled"}:
        run["status"] = "cancelled"
    if not run.get("finishedAt"):
        run["finishedAt"] = now
    run["activeNodeId"] = None
    for node_run in run["nodeRuns"]:
        if node_run["status"] in {"queued", "running"}:
            node_run["status"] = "cancelled"
            if not node_run.get("finishedAt"):
                node_run["finishedAt"] = now
            node_run["durationMs"] = _compute_duration_ms(node_run.get("startedAt"), node_run.get("finishedAt"))
    run["durationMs"] = _compute_duration_ms(run.get("startedAt"), run.get("finishedAt"))
    _append_log(
        run,
        category="control",
        title="Run cancelled",
        message="Execution stopped after a cancellation request.",
    )


def _finalize_run_success(run: dict[str, Any]) -> None:
    now = _now_iso()
    run["status"] = "success"
    run["finishedAt"] = now
    run["activeNodeId"] = None
    run["durationMs"] = _compute_duration_ms(run.get("startedAt"), run.get("finishedAt"))

    node_outputs: dict[str, Any] = run["_meta"]["nodeOutputs"]
    sink_nodes = [
        node_id
        for node_id in run["_meta"]["order"]
        if not run["_meta"]["outgoingEdges"].get(node_id)
    ]
    final_summaries = [node_outputs[node_id]["summary"] for node_id in sink_nodes if node_id in node_outputs]
    final_summary = " ".join(final_summaries).strip() or "Workflow completed successfully."
    sink_outputs = [node_outputs[node_id] for node_id in sink_nodes if node_id in node_outputs]

    final_markdown = ""
    for output in sink_outputs:
        final_markdown = _extract_text_candidate(
            output,
            ("data", "final_markdown"),
            ("data", "finalMarkdown"),
            ("details", "agentDetails", "final_markdown"),
        )
        if final_markdown:
            break
    if not final_markdown:
        final_markdown = f"# {run['workflowName']}\n\n{final_summary}\n"

    deliverables = []
    deliverables.append(
        {
            "id": f"dlv_{uuid.uuid4().hex[:10]}",
            "name": "final-output.md",
            "type": "file",
            "mimeType": "text/markdown",
            "producerNodeId": sink_nodes[0] if sink_nodes else None,
            "status": "final",
            "preview": truncate_for_runtime(final_summary, 500),
            "content": final_markdown,
            "metadata": {"kind": "final_summary"},
        }
    )

    sink_deliverable_map: dict[str, Any] = {}
    for output in sink_outputs:
        data = output.get("data")
        if isinstance(data, dict):
            raw_map = data.get("deliverables")
            if isinstance(raw_map, dict):
                for key, value in raw_map.items():
                    if key and key not in sink_deliverable_map:
                        sink_deliverable_map[str(key)] = value

    requested = run.get("requestedDeliverables") or []
    for name in requested:
        sanitized = name.strip()
        if not sanitized:
            continue
        requested_content = sink_deliverable_map.get(sanitized)
        bundle_files = _extract_code_bundle_files(requested_content)
        deliverable_type = "text"
        metadata: dict[str, Any] = {"requested": True}
        if bundle_files:
            content = _safe_json_preview(
                {"kind": "code_bundle", "fileCount": len(bundle_files), "files": sorted(bundle_files.keys())},
                max_chars=20_000,
            )
            mime_type = "application/x-directory"
            deliverable_type = "code_bundle"
            metadata.update(
                {
                    "kind": "code_bundle",
                    "fileCount": len(bundle_files),
                    "filePaths": sorted(bundle_files.keys())[:40],
                }
            )
        elif isinstance(requested_content, (dict, list)):
            content = _safe_json_preview(requested_content, max_chars=20_000)
            mime_type = "application/json"
        elif isinstance(requested_content, str) and requested_content.strip():
            content = requested_content
            mime_type = "text/plain"
        else:
            content = f"{sanitized}\n\n{final_summary}\n"
            mime_type = "text/plain"
        deliverables.append(
            {
                "id": f"dlv_{uuid.uuid4().hex[:10]}",
                "name": sanitized,
                "type": deliverable_type,
                "mimeType": mime_type,
                "producerNodeId": sink_nodes[0] if sink_nodes else None,
                "status": "final",
                "preview": truncate_for_runtime(f"{sanitized}: {final_summary}", 500),
                "content": content,
                "metadata": metadata,
            }
        )

    artifact_manifest = _persist_run_deliverables(run, deliverables, sink_deliverable_map)
    run["deliverables"] = deliverables
    run["artifactDirectory"] = artifact_manifest.get("deliverablesDirectory")
    run["outputs"] = {
        "summary": final_summary,
        "finalMarkdown": final_markdown,
        "sinkNodeIds": sink_nodes,
        "nodeOutputCount": len(node_outputs),
        "artifactDirectory": artifact_manifest.get("deliverablesDirectory"),
        "artifactManifestPath": artifact_manifest.get("manifestPath"),
        "workspaceDirectory": run.get("workspaceDirectory"),
        "workspaceDirectories": _deepcopy_jsonish(run.get("workspaceDirectories")),
    }
    _append_log(
        run,
        category="output",
        title="Workflow outputs finalized",
        message=f"Prepared {len(deliverables)} deliverable(s) and finalized workflow outputs.",
        payload={
            "deliverableCount": len(deliverables),
            "summary": final_summary,
            "artifactDirectory": artifact_manifest.get("deliverablesDirectory"),
            "manifestPath": artifact_manifest.get("manifestPath"),
            "workspaceDirectory": run.get("workspaceDirectory"),
        },
    )


def _execute_run(run_id: str) -> None:
    with _LOCK:
        run = _RUNS.get(run_id)
        if not run:
            return
        if run["status"] not in {"queued"}:
            return
        run["status"] = "running"
        run["startedAt"] = _now_iso()
        _append_log(
            run,
            category="lifecycle",
            title="Run started",
            message=f"Workflow {run['workflowName']} started execution.",
            payload={
                "workflowId": run["workflowId"],
                "requestedDeliverables": run.get("requestedDeliverables", []),
                "inputKeys": sorted(run.get("inputs", {}).keys()) if isinstance(run.get("inputs"), dict) else [],
                "workspaceDirectory": run.get("workspaceDirectory"),
                "workspaceDirectories": run.get("workspaceDirectories"),
            },
        )
        if isinstance(run.get("workspace"), dict):
            workspace = run["workspace"]
            _append_log(
                run,
                category="input",
                title="Run workspace ready",
                message="Created a shared workspace for all agents and materialized run inputs/uploads.",
                payload={
                    "root": workspace.get("root"),
                    "directories": workspace.get("directories"),
                    "userUploadCount": len(workspace.get("userUploads") or [])
                    if isinstance(workspace.get("userUploads"), list)
                    else 0,
                    "inputsFile": str(Path(str((workspace.get("directories") or {}).get("inputs") or "")) / "run_inputs.json")
                    if isinstance(workspace.get("directories"), dict)
                    else None,
                },
            )

    try:
        with _LOCK:
            run = _RUNS[run_id]
            order = list(run["_meta"]["order"])
            node_map = dict(run["_meta"]["nodeMap"])
            incoming_edges = dict(run["_meta"]["incomingEdges"])
            outgoing_edges = dict(run["_meta"]["outgoingEdges"])

        for node_id in order:
            with _LOCK:
                run = _RUNS[run_id]
                if run.get("cancelRequested"):
                    _mark_cancelled(run)
                    return

                node = node_map[node_id]
                node_run = _find_node_run(run, node_id)
                node_run["status"] = "running"
                node_run["startedAt"] = _now_iso()
                run["activeNodeId"] = node_id
                _append_log(
                    run,
                    category="lifecycle",
                    title="Agent running",
                    message=f"{node_run['name']} is now running.",
                    node_id=node_id,
                )

                upstream_inputs: list[dict[str, Any]] = []
                for edge in incoming_edges.get(node_id, []):
                    source_id = edge["source"]
                    source_node = node_map.get(source_id) or {"id": source_id, "name": source_id}
                    source_output = run["_meta"]["nodeOutputs"].get(source_id)
                    handoff_key = f"{source_id}->{node_id}"
                    handoff_packets = run["_meta"].get("handoffPackets") or {}
                    packet = handoff_packets.get(handoff_key)
                    if packet is None and source_output is not None:
                        packet = _build_handoff_packet(
                            edge=edge,
                            source_output=source_output,
                            source_node=source_node,
                            target_node=node,
                        )
                    upstream_inputs.append(
                        {
                            "fromNodeId": source_id,
                            "fromNodeName": source_node.get("name") or source_id,
                            "handoff": edge.get("handoff") or "",
                            "handoffContract": _normalize_handoff_contract(edge),
                            "packetSummary": packet.get("summary") if isinstance(packet, dict) else None,
                            "packet": _deepcopy_jsonish(packet) if packet is not None else None,
                            "outputSummary": source_output.get("summary") if isinstance(source_output, dict) else None,
                            "output": _deepcopy_jsonish(source_output),
                        }
                    )
                node_run["upstreamInputs"] = _deepcopy_jsonish(upstream_inputs)
                node_input_payload = {
                    "runInputs": _deepcopy_jsonish(run.get("inputs", {})),
                    "workspace": {
                        "root": (run.get("workspace") or {}).get("root") if isinstance(run.get("workspace"), dict) else None,
                        "directories": (run.get("workspace") or {}).get("directories")
                        if isinstance(run.get("workspace"), dict)
                        else None,
                    },
                    "upstreamHandoffs": [
                        {
                            "fromNodeId": item["fromNodeId"],
                            "fromNodeName": item["fromNodeName"],
                            "handoff": item["handoff"],
                            "packetType": item.get("packet", {}).get("packetType")
                            if isinstance(item.get("packet"), dict)
                            else None,
                            "packetSummary": item.get("packetSummary"),
                            "payloadKeys": sorted(list((item.get("packet", {}).get("payload") or {}).keys()))
                            if isinstance(item.get("packet"), dict) and isinstance(item.get("packet", {}).get("payload"), dict)
                            else [],
                            "workspaceRefCount": len(
                                (
                                    (item.get("packet", {}).get("payload") or {}).get("workspaceRefs") or []
                                )
                            )
                            if isinstance(item.get("packet"), dict)
                            and isinstance(item.get("packet", {}).get("payload"), dict)
                            and isinstance((item.get("packet", {}).get("payload") or {}).get("workspaceRefs"), list)
                            else 0,
                            "workspaceRefs": [
                                ref.get("path")
                                for ref in (((item.get("packet", {}).get("payload") or {}).get("workspaceRefs") or [])[:8])
                                if isinstance(ref, dict) and isinstance(ref.get("path"), str)
                            ]
                            if isinstance(item.get("packet"), dict)
                            and isinstance(item.get("packet", {}).get("payload"), dict)
                            and isinstance((item.get("packet", {}).get("payload") or {}).get("workspaceRefs"), list)
                            else [],
                            "missingRequiredFields": item.get("packet", {}).get("missingRequiredFields")
                            if isinstance(item.get("packet"), dict)
                            else [],
                        }
                        for item in upstream_inputs
                    ],
                }
                _append_log(
                    run,
                    category="input",
                    title="Agent inputs prepared",
                    message=f"Prepared inputs for {node_run['name']} including {len(upstream_inputs)} upstream handoff(s).",
                    node_id=node_id,
                    payload=node_input_payload,
                )
                run_snapshot_for_node = {
                    "id": run.get("id"),
                    "workflowId": run.get("workflowId"),
                    "workflowName": run.get("workflowName"),
                    "workflowPrompt": run.get("workflowPrompt"),
                    "workflowSummary": run.get("workflowSummary"),
                    "requestedDeliverables": _deepcopy_jsonish(run.get("requestedDeliverables") or []),
                    "inputs": _deepcopy_jsonish(run.get("inputs") or {}),
                    "workspace": _deepcopy_jsonish(run.get("workspace") or None),
                    "_meta": {
                        "outgoingEdges": _deepcopy_jsonish((run.get("_meta") or {}).get("outgoingEdges") or {}),
                    },
                }

            with _LOCK:
                run = _RUNS.get(run_id)
                if not run:
                    return
                if run.get("cancelRequested"):
                    _mark_cancelled(run)
                    return

            # Create a live log callback that flushes trace events to the run in real-time
            def _make_live_log_callback(target_run_id: str, target_node_id: str):
                flushed_ids: set[str] = set()

                def _callback(event: dict[str, Any]) -> None:
                    category = str(event.get("category") or "thinking")
                    if category not in {"lifecycle", "input", "handoff", "thinking", "output", "error", "control"}:
                        category = "thinking"
                    with _LOCK:
                        live_run = _RUNS.get(target_run_id)
                        if not live_run:
                            return
                        log_entry = _append_log(
                            live_run,
                            category=category,
                            title=truncate_for_runtime(str(event.get("title") or "Agent event"), 120),
                            message=truncate_for_runtime(str(event.get("message") or ""), 500),
                            node_id=target_node_id,
                            payload=_truncate_deep(event.get("payload"), max_depth=5, max_items=16, max_text=5_000),
                        )
                        flushed_ids.add(log_entry["id"])

                return _callback, flushed_ids

            live_callback, flushed_event_ids = _make_live_log_callback(run_id, node_id)

            output, trace_events = _build_node_output(run=run_snapshot_for_node, node=node, upstream_inputs=upstream_inputs, live_log_callback=live_callback)

            with _LOCK:
                run = _RUNS.get(run_id)
                if not run:
                    return
                if run.get("cancelRequested"):
                    _mark_cancelled(run)
                    return

                # Only flush trace events that were NOT already flushed live by the callback
                # (The init event at index 0 is not flushed live, so it goes here; all others were flushed live)
                if not flushed_event_ids:
                    # No live callback was used — flush all events (backward compat)
                    for event in trace_events:
                        category = str(event.get("category") or "thinking")
                        if category not in {"lifecycle", "input", "handoff", "thinking", "output", "error", "control"}:
                            category = "thinking"
                        _append_log(
                            run,
                            category=category,  # type: ignore[arg-type]
                            title=truncate_for_runtime(str(event.get("title") or "Agent event"), 120),
                            message=truncate_for_runtime(str(event.get("message") or ""), 500),
                            node_id=node_id,
                            payload=_truncate_deep(event.get("payload"), max_depth=5, max_items=12, max_text=5_000),
                        )
                else:
                    # Live callback was used — only flush the initialization event (first in trace_events)
                    if trace_events:
                        init_event = trace_events[0]
                        category = str(init_event.get("category") or "thinking")
                        if category not in {"lifecycle", "input", "handoff", "thinking", "output", "error", "control"}:
                            category = "thinking"
                        _append_log(
                            run,
                            category=category,  # type: ignore[arg-type]
                            title=truncate_for_runtime(str(init_event.get("title") or "Agent event"), 120),
                            message=truncate_for_runtime(str(init_event.get("message") or ""), 500),
                            node_id=node_id,
                            payload=_truncate_deep(init_event.get("payload"), max_depth=5, max_items=12, max_text=5_000),
                        )

                run["_meta"]["nodeOutputs"][node_id] = _deepcopy_jsonish(output)
                node_run = _find_node_run(run, node_id)
                node_run["output"] = _deepcopy_jsonish(output)
                node_run["outputSummary"] = output["summary"]

                outgoing = outgoing_edges.get(node_id, [])
                for edge in outgoing:
                    target_node = node_map.get(edge["target"]) or {"name": edge["target"], "id": edge["target"]}
                    packet = _build_handoff_packet(
                        edge=edge,
                        source_output=output,
                        source_node=node,
                        target_node=target_node,
                    )
                    run["_meta"].setdefault("handoffPackets", {})[f"{node_id}->{edge['target']}"] = _deepcopy_jsonish(packet)
                    _append_log(
                        run,
                        category="handoff",
                        title="Handoff emitted",
                        message=(
                            f"{node_run['name']} → {target_node.get('name') or edge['target']}"
                            + (f" ({edge.get('handoff')})" if edge.get("handoff") else "")
                            + f" [{packet.get('packetType')}]"
                        ),
                        node_id=node_id,
                        payload={
                            "source": node_id,
                            "target": edge["target"],
                            "handoff": edge.get("handoff") or "",
                            "summary": output["summary"],
                            "handoffContract": _normalize_handoff_contract(edge),
                            "packet": packet,
                        },
                    )

                node_run["status"] = "success"
                node_run["finishedAt"] = _now_iso()
                node_run["durationMs"] = _compute_duration_ms(node_run.get("startedAt"), node_run.get("finishedAt"))
                run["progress"]["completedNodes"] = sum(1 for item in run["nodeRuns"] if item["status"] == "success")
                run["activeNodeId"] = None

        with _LOCK:
            run = _RUNS.get(run_id)
            if not run:
                return
            if run.get("cancelRequested"):
                _mark_cancelled(run)
                return
            _finalize_run_success(run)

    except Exception as exc:  # pragma: no cover - defensive background worker handling
        with _LOCK:
            run = _RUNS.get(run_id)
            if not run:
                return
            run["status"] = "failed"
            run["activeNodeId"] = None
            run["error"] = str(exc)
            run["finishedAt"] = _now_iso()
            run["durationMs"] = _compute_duration_ms(run.get("startedAt"), run.get("finishedAt"))
            current_node_id = None
            for node_run in run["nodeRuns"]:
                if node_run["status"] == "running":
                    current_node_id = node_run["nodeId"]
                    node_run["status"] = "failed"
                    node_run["finishedAt"] = run["finishedAt"]
                    node_run["durationMs"] = _compute_duration_ms(node_run.get("startedAt"), node_run.get("finishedAt"))
                    break
            run["progress"]["failedNodes"] = sum(1 for item in run["nodeRuns"] if item["status"] == "failed")
            _append_log(
                run,
                category="error",
                title="Run failed",
                message=str(exc),
                node_id=current_node_id,
            )


def _strip_internal_fields(run: dict[str, Any], *, include_logs: bool = True) -> dict[str, Any]:
    data = _deepcopy_jsonish(run)
    data.pop("_meta", None)
    data.pop("cancelRequested", None)
    if not include_logs:
        data.pop("logs", None)
        for node_run in data.get("nodeRuns", []):
            node_run.pop("logs", None)
            node_run.pop("output", None)
            node_run.pop("upstreamInputs", None)
    return data


def create_workflow_run(payload: WorkflowRunCreateRequest) -> dict[str, Any]:
    run = _build_run_from_request(payload)
    _prepare_run_workspace(run)
    run_id = run["id"]
    with _LOCK:
        _RUNS[run_id] = run
        worker = threading.Thread(target=_execute_run, args=(run_id,), daemon=True, name=f"workflow-run-{run_id}")
        _RUN_THREADS[run_id] = worker
        worker.start()
        return _strip_internal_fields(run, include_logs=True)


def list_workflow_runs(*, limit: int = 100) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 500))
    with _LOCK:
        runs = sorted(
            _RUNS.values(),
            key=lambda item: (
                item.get("startedAt") or "",
                item.get("createdAt") or "",
            ),
            reverse=True,
        )[:safe_limit]
        return [_strip_internal_fields(run, include_logs=False) for run in runs]


def get_workflow_run(run_id: str) -> dict[str, Any] | None:
    with _LOCK:
        run = _RUNS.get(run_id)
        if not run:
            return None
        return _strip_internal_fields(run, include_logs=True)


def cancel_workflow_run(run_id: str) -> dict[str, Any] | None:
    with _LOCK:
        run = _RUNS.get(run_id)
        if not run:
            return None
        if run["status"] in {"success", "failed", "cancelled"}:
            return _strip_internal_fields(run, include_logs=True)
        run["cancelRequested"] = True
        _append_log(
            run,
            category="control",
            title="Cancellation requested",
            message="A user requested cancellation for this run.",
        )
        return _strip_internal_fields(run, include_logs=True)


def delete_workflow_run(run_id: str) -> dict[str, Any] | None:
    with _LOCK:
        run = _RUNS.get(run_id)
        if not run:
            return None
        if run.get("status") in {"queued", "running", "awaiting_input"}:
            raise ValueError("Cannot delete an active workflow run. Cancel it first.")

        removed = _RUNS.pop(run_id)
        _RUN_THREADS.pop(run_id, None)
        return _strip_internal_fields(removed, include_logs=False)


def resume_workflow_run(_run_id: str, _payload: WorkflowRunResumeRequest) -> dict[str, Any] | None:
    # Placeholder for future human-in-the-loop resume support.
    return None


def stream_workflow_run_events(run_id: str, last_seq: int = -1, poll_interval: float = 0.3):
    """Generator that yields new log events and state changes for a workflow run as SSE-compatible dicts.

    Each yielded item is a dict with keys: event (str), data (dict).
    Terminates when the run reaches a terminal state and all logs have been flushed.
    """
    import time as _time

    TERMINAL_STATES = {"success", "failed", "cancelled"}
    cursor = last_seq
    settled_iterations = 0  # Count iterations with no new events after terminal state

    while True:
        new_events: list[dict[str, Any]] = []
        run_status = ""
        run_active_node_id = ""
        run_finished = False
        node_runs_summary: list[dict[str, Any]] = []
        workspace_change_events: list[dict[str, Any]] = []

        with _LOCK:
            run = _RUNS.get(run_id)
            if not run:
                yield {"event": "error", "data": {"error": "run_not_found", "message": f"Run {run_id} not found."}}
                return

            run_status = str(run.get("status") or "")
            run_active_node_id = str(run.get("activeNodeId") or "")
            run_finished = run_status in TERMINAL_STATES

            # Collect new log entries since cursor
            for log in run.get("logs", []):
                seq = log.get("seq")
                if not isinstance(seq, (int, float)):
                    continue
                if seq > cursor:
                    new_events.append(_deepcopy_jsonish(log))
                    cursor = max(cursor, seq)

                    # Detect workspace change events
                    payload = log.get("payload") if isinstance(log.get("payload"), dict) else {}
                    ws_refs = payload.get("workspaceRefs")
                    if isinstance(ws_refs, list) and ws_refs:
                        for ref in ws_refs[:10]:
                            if isinstance(ref, dict) and ref.get("path"):
                                workspace_change_events.append({
                                    "path": ref.get("path"),
                                    "operation": ref.get("operation", ""),
                                    "kind": ref.get("kind", ""),
                                    "sourceTool": ref.get("sourceTool", ""),
                                    "nodeId": log.get("nodeId", ""),
                                    "seq": seq,
                                })

            # Snapshot node run statuses
            for nr in run.get("nodeRuns", []):
                node_runs_summary.append({
                    "nodeId": nr.get("nodeId"),
                    "name": nr.get("name"),
                    "status": nr.get("status"),
                    "startedAt": nr.get("startedAt"),
                    "finishedAt": nr.get("finishedAt"),
                    "durationMs": nr.get("durationMs"),
                })

        # Yield new log events
        for event in new_events:
            yield {"event": "log", "data": event}

        # Yield workspace change events
        for ws_event in workspace_change_events:
            yield {"event": "workspace:change", "data": ws_event}

        # Yield periodic state snapshot (every batch, so frontend can update status pills)
        yield {
            "event": "state",
            "data": {
                "runId": run_id,
                "status": run_status,
                "activeNodeId": run_active_node_id,
                "nodeRuns": node_runs_summary,
            },
        }

        if run_finished:
            if not new_events:
                settled_iterations += 1
            else:
                settled_iterations = 0
            if settled_iterations >= 2:
                yield {"event": "run:complete", "data": {"runId": run_id, "status": run_status}}
                return
        else:
            settled_iterations = 0

        _time.sleep(poll_interval)
