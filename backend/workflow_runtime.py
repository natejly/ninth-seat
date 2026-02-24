from __future__ import annotations

import copy
import json
import os
import re
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
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
    return os.getenv("WORKFLOW_RUN_MODEL", os.getenv("WORKFLOW_MODEL", "gpt-4.1-mini"))


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


def _invoke_runtime_agent_decision(system_prompt: str, prompt_payload: dict[str, Any]) -> RuntimeAgentDecision:
    user_text = "Choose the next action for this node and return structured JSON only.\n\n" + _safe_json_preview(
        prompt_payload,
        max_chars=18_000,
    )
    schema_text = _safe_json_preview(RuntimeAgentDecision.model_json_schema(), max_chars=12_000)

    if ChatOpenAI is not None:
        llm = _runtime_llm()
        message = llm.invoke(
            [
                ("system", system_prompt),
                (
                    "human",
                    user_text
                    + "\n\nReturn a JSON object matching this schema (fields may be empty when unused):\n"
                    + schema_text,
                ),
            ]
        )
        raw_text = _extract_openai_text_content(message)
        parsed = _parse_runtime_json_object(raw_text)
        return RuntimeAgentDecision.model_validate(parsed)

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
    parsed = _parse_runtime_json_object(raw_text)
    return RuntimeAgentDecision.model_validate(parsed)


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
        summarized.append(
            {
                "fromNodeId": item.get("fromNodeId"),
                "fromNodeName": item.get("fromNodeName"),
                "handoff": item.get("handoff"),
                "packetSummary": item.get("packetSummary"),
                "packet": _truncate_deep(item.get("packet")),
                "outputSummary": item.get("outputSummary"),
                "output": _truncate_deep(item.get("output")),
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


def _build_real_node_output(
    *,
    run: dict[str, Any],
    node: dict[str, Any],
    upstream_inputs: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    run_inputs = run.get("inputs") if isinstance(run.get("inputs"), dict) else {}
    summarized_inputs = _summarize_run_inputs_for_model(run_inputs or {})
    summarized_upstream = _summarize_upstream_inputs_for_model(upstream_inputs)
    tool_catalog = _tool_catalog_for_model()
    is_sink_node = not bool(run["_meta"]["outgoingEdges"].get(node["id"]))
    max_turns = max(1, min(int(os.getenv("WORKFLOW_NODE_MAX_STEPS", "6")), 12))

    step_history: list[dict[str, Any]] = []
    tool_call_summaries: list[dict[str, Any]] = []
    trace_events: list[dict[str, Any]] = [
        {
            "category": "thinking",
            "title": "Agent runtime initialized",
            "message": f"Executing {node.get('name') or node['id']} with model {_runtime_model_name()} and real tool access.",
            "payload": {"model": _runtime_model_name(), "sinkNode": is_sink_node},
        }
    ]

    system_prompt = (
        "You are an execution agent in a DAG-based workflow runtime. "
        "You must complete the current node's objective using the provided workflow inputs and upstream handoffs. "
        "You may request exactly one tool call at a time using action='tool', or finish with action='final'. "
        "Do not fabricate tool results. Only use tools listed in the tool catalog. "
        "When you finish, produce a concise but concrete summary and structured details/data. "
        "Include useful artifacts in data when available (e.g., code snippets, plans, findings, URLs, commands, file names). "
        "If this is a sink/final node, include user-facing output in data.final_markdown when possible."
    )

    for turn_index in range(max_turns):
        prompt_payload = {
            "workflow": {
                "id": run.get("workflowId"),
                "name": run.get("workflowName"),
                "prompt": truncate_for_runtime(str(run.get("workflowPrompt") or ""), 4_000),
                "summary": truncate_for_runtime(str(run.get("workflowSummary") or ""), 2_000),
                "requestedDeliverables": list(run.get("requestedDeliverables") or [])[:20],
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
        trace_events.append(
            {
                "category": "thinking",
                "title": f"Agent step {turn_index + 1}",
                "message": truncate_for_runtime(status_note, 240),
                "payload": {
                    "turn": turn_index + 1,
                    "action": decision.action,
                    "statusNote": status_note,
                },
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
            trace_events.append(
                {
                    "category": "control",
                    "title": "Tool call requested",
                    "message": f"{tool_name} ({truncate_for_runtime(tool_request.reason or 'no reason provided', 180)})",
                    "payload": {"tool": tool_name, "args": _truncate_deep(tool_args)},
                }
            )

            started = time.perf_counter()
            try:
                tool_result = _run_runtime_tool(tool_name, tool_args)
                sanitized_result = _sanitize_tool_result_for_runtime(tool_result)
                duration_ms = round((time.perf_counter() - started) * 1000, 2)
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
                trace_events.append(
                    {
                        "category": "output",
                        "title": "Tool call completed",
                        "message": f"{tool_name} completed in {duration_ms}ms.",
                        "payload": {
                            "tool": tool_name,
                            "args": _truncate_deep(tool_args),
                            "result": sanitized_result,
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
                trace_events.append(
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
        details = {
            "nodeId": node["id"],
            "nodeName": node.get("name") or node["id"],
            "role": node.get("role") or "",
            "objective": node.get("objective") or "",
            "toolCalls": _truncate_deep(tool_call_summaries, max_items=20, max_text=4_000),
            "agentDetails": _truncate_deep(details, max_depth=6, max_items=20, max_text=6_000),
            "stepCount": turn_index + 1,
        }
        output_data = _truncate_deep(data, max_depth=6, max_items=30, max_text=10_000)
        if isinstance(output_data, dict):
            output_data.setdefault("summary", summary)
            output_data.setdefault("nodeId", node["id"])
            output_data.setdefault("nodeName", node.get("name") or node["id"])
            output_data.setdefault("toolCallCount", len(tool_call_summaries))

        trace_events.append(
            {
                "category": "output",
                "title": "Agent output produced",
                "message": truncate_for_runtime(summary, 240),
                "payload": {"summary": summary, "stepCount": turn_index + 1, "toolCallCount": len(tool_call_summaries)},
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
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return _build_real_node_output(run=run, node=node, upstream_inputs=upstream_inputs)


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
        if isinstance(requested_content, (dict, list)):
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
                "type": "text",
                "mimeType": mime_type,
                "producerNodeId": sink_nodes[0] if sink_nodes else None,
                "status": "final",
                "preview": truncate_for_runtime(f"{sanitized}: {final_summary}", 500),
                "content": content,
                "metadata": {"requested": True},
            }
        )

    run["deliverables"] = deliverables
    run["outputs"] = {
        "summary": final_summary,
        "finalMarkdown": final_markdown,
        "sinkNodeIds": sink_nodes,
        "nodeOutputCount": len(node_outputs),
    }
    _append_log(
        run,
        category="output",
        title="Workflow outputs finalized",
        message=f"Prepared {len(deliverables)} deliverable(s) and finalized workflow outputs.",
        payload={"deliverableCount": len(deliverables), "summary": final_summary},
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
                    "workflowId": run.get("workflowId"),
                    "workflowName": run.get("workflowName"),
                    "workflowPrompt": run.get("workflowPrompt"),
                    "workflowSummary": run.get("workflowSummary"),
                    "requestedDeliverables": _deepcopy_jsonish(run.get("requestedDeliverables") or []),
                    "inputs": _deepcopy_jsonish(run.get("inputs") or {}),
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

            output, trace_events = _build_node_output(run=run_snapshot_for_node, node=node, upstream_inputs=upstream_inputs)

            with _LOCK:
                run = _RUNS.get(run_id)
                if not run:
                    return
                if run.get("cancelRequested"):
                    _mark_cancelled(run)
                    return

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
