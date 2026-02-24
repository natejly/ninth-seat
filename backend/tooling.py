from __future__ import annotations

import math
import os
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field


class ToolRunRequest(BaseModel):
    tool: str = Field(min_length=1, max_length=64)
    args: dict[str, Any] = Field(default_factory=dict)


class WebSearchArgs(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    max_results: int = Field(default=5, ge=1, le=10)
    site: str | None = Field(default=None, max_length=255)
    timeout_seconds: float = Field(default=10.0, gt=0.25, le=30.0)


class SandboxExecArgs(BaseModel):
    language: Literal["python", "bash"] = "python"
    code: str = Field(min_length=1, max_length=100_000)
    stdin: str = Field(default="", max_length=100_000)
    timeout_seconds: float = Field(default=5.0, gt=0.25, le=30.0)
    memory_limit_mb: int = Field(default=256, ge=32, le=1024)
    max_output_chars: int = Field(default=20_000, ge=200, le=200_000)
    files: dict[str, str] = Field(default_factory=dict)


def _strip_html(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _decode_duckduckgo_url(raw_href: str) -> str:
    href = unescape(raw_href).strip()
    if href.startswith("//"):
        href = f"https:{href}"

    parsed = urllib.parse.urlparse(href)
    query = urllib.parse.parse_qs(parsed.query)
    encoded_target = query.get("uddg", [None])[0]
    if encoded_target:
        return urllib.parse.unquote(encoded_target)
    return href


def _search_duckduckgo_lite(args: WebSearchArgs) -> dict[str, Any]:
    query = args.query.strip()
    if args.site:
        query = f"site:{args.site.strip()} {query}".strip()

    url = "https://lite.duckduckgo.com/lite/?" + urllib.parse.urlencode({"q": query})
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; NinthSeat/0.1; +https://example.invalid)",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )

    with urllib.request.urlopen(request, timeout=args.timeout_seconds) as response:
        html = response.read().decode("utf-8", errors="ignore")

    anchor_re = re.compile(
        r"<a\b([^>]*)>(.*?)</a>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    snippet_re = re.compile(
        r"<td\b[^>]*class=['\"]result-snippet['\"][^>]*>(.*?)</td>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    link_text_re = re.compile(
        r"<span\b[^>]*class=['\"]link-text['\"][^>]*>(.*?)</span>",
        flags=re.IGNORECASE | re.DOTALL,
    )

    anchor_matches = list(anchor_re.finditer(html))
    results: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    for index, match in enumerate(anchor_matches):
        next_start = (
            anchor_matches[index + 1].start()
            if index + 1 < len(anchor_matches)
            else min(len(html), match.end() + 3000)
        )
        chunk = html[match.end() : next_start]

        attrs, title_html = match.groups()
        if "result-link" not in attrs:
            continue

        href_match = re.search(
            r"href=['\"]([^'\"]+)['\"]",
            attrs,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if not href_match:
            continue

        href = href_match.group(1)
        url_value = _decode_duckduckgo_url(href)
        if not url_value or url_value in seen_urls:
            continue

        title = _strip_html(title_html)
        if not title:
            continue

        snippet_match = snippet_re.search(chunk)
        link_text_match = link_text_re.search(chunk)

        result: dict[str, str] = {
            "title": title,
            "url": url_value,
        }
        if snippet_match:
            snippet = _strip_html(snippet_match.group(1))
            if snippet:
                result["snippet"] = snippet
        if link_text_match:
            display_url = _strip_html(link_text_match.group(1))
            if display_url:
                result["display_url"] = display_url

        seen_urls.add(url_value)
        results.append(result)
        if len(results) >= args.max_results:
            break

    return {
        "provider": "duckduckgo_lite",
        "query": args.query,
        "applied_query": query,
        "results": results,
        "result_count": len(results),
        "warnings": (
            []
            if results
            else [
                "No results parsed from DuckDuckGo Lite response. The page markup may have changed.",
            ]
        ),
    }


def _safe_relative_path(raw_path: str) -> Path:
    normalized = raw_path.strip().replace("\\", "/")
    if not normalized:
        raise ValueError("File path cannot be empty")

    path = Path(normalized)
    if path.is_absolute():
        raise ValueError(f"Absolute paths are not allowed: {raw_path}")

    parts = path.parts
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"Unsafe relative path: {raw_path}")

    return path


def _truncate_text(value: str, max_chars: int) -> tuple[str, bool]:
    if len(value) <= max_chars:
        return value, False
    return value[:max_chars], True


def _sandbox_preexec(memory_limit_mb: int, timeout_seconds: float):
    def _inner() -> None:
        try:
            import resource
        except Exception:
            return

        cpu_limit = max(1, int(math.ceil(timeout_seconds)))
        memory_limit_bytes = memory_limit_mb * 1024 * 1024
        file_limit_bytes = 5 * 1024 * 1024

        limits = [
            ("RLIMIT_CPU", (cpu_limit, cpu_limit + 1)),
            ("RLIMIT_AS", (memory_limit_bytes, memory_limit_bytes)),
            ("RLIMIT_FSIZE", (file_limit_bytes, file_limit_bytes)),
            ("RLIMIT_NOFILE", (64, 64)),
            ("RLIMIT_NPROC", (64, 64)),
            ("RLIMIT_CORE", (0, 0)),
        ]

        for name, limit in limits:
            resource_id = getattr(resource, name, None)
            if resource_id is None:
                continue
            try:
                resource.setrlimit(resource_id, limit)
            except Exception:
                continue

    return _inner


def _collect_artifacts(base_dir: Path, max_files: int = 20) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for path in sorted(base_dir.rglob("*")):
        if not path.is_file():
            continue

        rel_path = path.relative_to(base_dir).as_posix()
        artifact: dict[str, Any] = {
            "path": rel_path,
            "size_bytes": path.stat().st_size,
        }

        if path.stat().st_size <= 8_192:
            try:
                preview = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                preview = None
            if preview is not None:
                artifact["text_preview"] = preview[:2_000]

        artifacts.append(artifact)
        if len(artifacts) >= max_files:
            break

    return artifacts


def _run_sandbox_exec(args: SandboxExecArgs) -> dict[str, Any]:
    if len(args.files) > 20:
        raise ValueError("Too many files. Maximum is 20.")

    for file_path, content in args.files.items():
        if len(file_path) > 200:
            raise ValueError(f"File path is too long: {file_path}")
        if len(content) > 200_000:
            raise ValueError(f"File content too large for: {file_path}")

    with tempfile.TemporaryDirectory(prefix="ninth-seat-sandbox-") as tmpdir:
        sandbox_dir = Path(tmpdir)

        for file_path, content in args.files.items():
            rel_path = _safe_relative_path(file_path)
            destination = sandbox_dir / rel_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(content, encoding="utf-8")

        if args.language == "python":
            script_name = "main.py"
            command = ["python3", "-I", script_name]
        else:
            script_name = "main.sh"
            command = ["bash", script_name]

        (sandbox_dir / script_name).write_text(args.code, encoding="utf-8")

        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": tmpdir,
            "TMPDIR": tmpdir,
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
        }

        started = time.perf_counter()
        timed_out = False
        stdout = ""
        stderr = ""
        return_code: int | None = None

        try:
            preexec_fn = (
                _sandbox_preexec(args.memory_limit_mb, args.timeout_seconds)
                if os.name == "posix"
                else None
            )
            completed = subprocess.run(
                command,
                cwd=tmpdir,
                input=args.stdin,
                text=True,
                capture_output=True,
                timeout=args.timeout_seconds,
                env=env,
                preexec_fn=preexec_fn,
            )
            stdout = completed.stdout or ""
            stderr = completed.stderr or ""
            return_code = completed.returncode
        except subprocess.TimeoutExpired as exc:
            timed_out = True
            stdout = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout or b"").decode("utf-8", "ignore")
            stderr = exc.stderr if isinstance(exc.stderr, str) else (exc.stderr or b"").decode("utf-8", "ignore")
        duration_ms = round((time.perf_counter() - started) * 1000, 2)

        stdout, stdout_truncated = _truncate_text(stdout, args.max_output_chars)
        stderr, stderr_truncated = _truncate_text(stderr, args.max_output_chars)
        artifacts = _collect_artifacts(sandbox_dir)

    return {
        "language": args.language,
        "command": command,
        "timeout_seconds": args.timeout_seconds,
        "memory_limit_mb": args.memory_limit_mb,
        "timed_out": timed_out,
        "return_code": return_code,
        "stdout": stdout,
        "stderr": stderr,
        "stdout_truncated": stdout_truncated,
        "stderr_truncated": stderr_truncated,
        "duration_ms": duration_ms,
        "artifacts": artifacts,
        "limitations": [
            "MVP isolation uses a temporary working directory plus subprocess resource limits.",
            "This is not a hardened sandbox and does not provide OS-level filesystem or network isolation.",
        ],
    }


def list_tools() -> list[dict[str, Any]]:
    return [
        {
            "name": "web_search",
            "description": "Search the public web and return top links/snippets (DuckDuckGo Lite parser).",
            "input_schema": WebSearchArgs.model_json_schema(),
            "limitations": [
                "No API key required, but relies on DuckDuckGo Lite HTML markup remaining stable.",
                "Results are best-effort and may omit snippets when the provider response changes.",
            ],
        },
        {
            "name": "sandbox_exec",
            "description": "Run Python or Bash in a temporary directory with timeout and basic resource limits.",
            "input_schema": SandboxExecArgs.model_json_schema(),
            "limitations": [
                "Not a hardened security sandbox; intended for trusted/internal MVP usage.",
                "Execution captures stdout/stderr and a small artifact listing only.",
            ],
        },
    ]


def run_tool(tool_name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    payload = args or {}

    if tool_name == "web_search":
        validated = WebSearchArgs.model_validate(payload)
        result = _search_duckduckgo_lite(validated)
    elif tool_name == "sandbox_exec":
        validated = SandboxExecArgs.model_validate(payload)
        result = _run_sandbox_exec(validated)
    else:
        raise KeyError(f"Unknown tool: {tool_name}")

    return {
        "tool": tool_name,
        "ok": True,
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        "result": result,
    }
