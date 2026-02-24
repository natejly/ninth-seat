from __future__ import annotations

import os
import re
from collections import defaultdict, deque
from typing import Any, TypedDict

from pydantic import BaseModel, Field

LANGCHAIN_OPENAI_IMPORT_ERROR: str | None = None
LANGGRAPH_IMPORT_ERROR: str | None = None

try:
    from langchain_openai import ChatOpenAI
except Exception as exc:  # pragma: no cover - import fallback for local/dev envs
    ChatOpenAI = None  # type: ignore[assignment]
    LANGCHAIN_OPENAI_IMPORT_ERROR = str(exc)

try:
    from langgraph.graph import END, START, StateGraph
except Exception as exc:  # pragma: no cover - import fallback for local/dev envs
    END = "__end__"  # type: ignore[assignment]
    START = "__start__"  # type: ignore[assignment]
    StateGraph = None  # type: ignore[assignment]
    LANGGRAPH_IMPORT_ERROR = str(exc)


class WorkflowNode(BaseModel):
    id: str = Field(description="Unique snake_case identifier for the agent node")
    name: str = Field(description="Short agent display name")
    role: str = Field(description="What this agent is responsible for")
    objective: str = Field(description="One-line goal or output for the agent")


class WorkflowEdge(BaseModel):
    source: str = Field(description="Source node id")
    target: str = Field(description="Target node id")
    handoff: str = Field(default="", description="Short description of what is passed")


class WorkflowPlan(BaseModel):
    summary: str = Field(description="Short summary of the proposed workflow")
    nodes: list[WorkflowNode] = Field(min_length=2, max_length=8)
    edges: list[WorkflowEdge] = Field(default_factory=list)


class GraphState(TypedDict, total=False):
    task: str
    trace: list[str]


def _slugify(text: str, *, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug or fallback


def _fallback_plan(task: str) -> WorkflowPlan:
    topic = task.strip() or "requested task"
    return WorkflowPlan(
        summary=f"Plan the work, branch into research/implementation, then review before delivery for: {topic}.",
        nodes=[
            WorkflowNode(
                id="intake_agent",
                name="Intake Agent",
                role="Clarify scope",
                objective="Extract the goal, constraints, and success criteria from the task.",
            ),
            WorkflowNode(
                id="planner_agent",
                name="Planner Agent",
                role="Design execution steps",
                objective="Create a concrete execution plan and identify parallelizable work.",
            ),
            WorkflowNode(
                id="research_agent",
                name="Research Agent",
                role="Gather supporting context",
                objective="Collect facts, references, and dependencies needed to execute safely.",
            ),
            WorkflowNode(
                id="builder_agent",
                name="Builder Agent",
                role="Produce the deliverable",
                objective="Execute the plan using the research output and task constraints.",
            ),
            WorkflowNode(
                id="review_agent",
                name="Review Agent",
                role="Quality and risk check",
                objective="Verify completeness, flag risks, and prepare the final response.",
            ),
        ],
        edges=[
            WorkflowEdge(source="intake_agent", target="planner_agent", handoff="task brief"),
            WorkflowEdge(source="planner_agent", target="research_agent", handoff="research questions"),
            WorkflowEdge(source="planner_agent", target="builder_agent", handoff="execution plan"),
            WorkflowEdge(source="research_agent", target="builder_agent", handoff="findings"),
            WorkflowEdge(source="builder_agent", target="review_agent", handoff="draft output"),
        ],
    )


def _normalize_plan(plan: WorkflowPlan, task: str) -> WorkflowPlan:
    normalized_nodes: list[WorkflowNode] = []
    seen_ids: set[str] = set()

    for index, node in enumerate(plan.nodes[:8]):
        node_id = _slugify(node.id or node.name, fallback=f"agent_{index + 1}")
        if node_id in seen_ids:
            suffix = 2
            while f"{node_id}_{suffix}" in seen_ids:
                suffix += 1
            node_id = f"{node_id}_{suffix}"

        seen_ids.add(node_id)
        normalized_nodes.append(
            WorkflowNode(
                id=node_id,
                name=(node.name or node_id.replace("_", " ").title()).strip()[:48],
                role=(node.role or "General task execution").strip()[:120],
                objective=(node.objective or "Complete assigned step").strip()[:180],
            )
        )

    if len(normalized_nodes) < 2:
        return _fallback_plan(task)

    valid_ids = {node.id for node in normalized_nodes}
    dedup_edges: list[WorkflowEdge] = []
    seen_edges: set[tuple[str, str]] = set()
    for edge in plan.edges:
        source = _slugify(edge.source, fallback="")
        target = _slugify(edge.target, fallback="")
        if not source or not target or source == target:
            continue
        if source not in valid_ids or target not in valid_ids:
            continue
        key = (source, target)
        if key in seen_edges:
            continue
        seen_edges.add(key)
        dedup_edges.append(
            WorkflowEdge(
                source=source,
                target=target,
                handoff=edge.handoff.strip()[:80],
            )
        )

    if not dedup_edges:
        dedup_edges = [
            WorkflowEdge(source=a.id, target=b.id, handoff="")
            for a, b in zip(normalized_nodes, normalized_nodes[1:])
        ]

    if _topological_order([node.id for node in normalized_nodes], dedup_edges) is None:
        dedup_edges = [
            WorkflowEdge(source=a.id, target=b.id, handoff="")
            for a, b in zip(normalized_nodes, normalized_nodes[1:])
        ]

    return WorkflowPlan(summary=plan.summary.strip()[:320], nodes=normalized_nodes, edges=dedup_edges)


def _topological_order(node_ids: list[str], edges: list[WorkflowEdge]) -> list[str] | None:
    indegree = {node_id: 0 for node_id in node_ids}
    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for edge in edges:
        adjacency[edge.source].append(edge.target)
        indegree[edge.target] += 1

    queue = deque([node_id for node_id in node_ids if indegree[node_id] == 0])
    order: list[str] = []

    while queue:
        node_id = queue.popleft()
        order.append(node_id)
        for target in adjacency[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)

    if len(order) != len(node_ids):
        return None
    return order


def _llm_plan(task: str) -> tuple[WorkflowPlan, str]:
    if ChatOpenAI is None:
        raise RuntimeError(
            "LangChain/LangGraph packages are not installed"
            + (
                f": {LANGCHAIN_OPENAI_IMPORT_ERROR}"
                if LANGCHAIN_OPENAI_IMPORT_ERROR
                else ""
            )
        )

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    model_name = os.getenv("WORKFLOW_MODEL", "gpt-4.1-mini")
    llm = ChatOpenAI(model=model_name, temperature=0)
    planner = llm.with_structured_output(WorkflowPlan)

    result = planner.invoke(
        [
            (
                "system",
                (
                    "You design compact agentic workflows for software/product tasks. "
                    "Return a DAG (not a loop) with 3-8 agent nodes. "
                    "Prefer clear handoffs and parallel branches only when useful. "
                    "Use short snake_case ids."
                ),
            ),
            (
                "human",
                (
                    "Create a workflow for this task:\n"
                    f"{task}\n\n"
                    "The workflow should be practical for an AI agent system and include a final review node."
                ),
            ),
        ]
    )

    if isinstance(result, WorkflowPlan):
        return result, model_name

    return WorkflowPlan.model_validate(result), model_name


def _build_langgraph(plan: WorkflowPlan, _task: str) -> dict[str, Any]:
    if StateGraph is None:
        return {
            "compiled": False,
            "error": LANGGRAPH_IMPORT_ERROR or "langgraph not available",
            "roots": [],
            "sinks": [],
        }

    def make_node(node_id: str):
        def _node(state: GraphState) -> dict[str, Any]:
            trace = list(state.get("trace", []))
            trace.append(node_id)
            return {"trace": trace}

        return _node

    incoming: dict[str, int] = defaultdict(int)
    outgoing: dict[str, int] = defaultdict(int)
    node_ids = [node.id for node in plan.nodes]
    graph = StateGraph(GraphState)

    for node in plan.nodes:
        graph.add_node(node.id, make_node(node.id))

    for edge in plan.edges:
        graph.add_edge(edge.source, edge.target)
        incoming[edge.target] += 1
        outgoing[edge.source] += 1

    roots = [node_id for node_id in node_ids if incoming[node_id] == 0]
    sinks = [node_id for node_id in node_ids if outgoing[node_id] == 0]

    for root in roots:
        graph.add_edge(START, root)

    for sink in sinks:
        graph.add_edge(sink, END)

    graph.compile()

    return {
        "compiled": True,
        "roots": roots,
        "sinks": sinks,
        "preview_trace": [],
    }


def generate_workflow_plan(task: str) -> dict[str, Any]:
    cleaned_task = task.strip()
    if not cleaned_task:
        raise ValueError("Task description is required")

    warnings: list[str] = []
    generation_mode = "fallback_rule_based"
    model_name: str | None = None

    try:
        raw_plan, model_name = _llm_plan(cleaned_task)
        generation_mode = "langchain_openai"
    except Exception as exc:
        warnings.append(f"Using fallback planner: {exc}")
        raw_plan = _fallback_plan(cleaned_task)

    plan = _normalize_plan(raw_plan, cleaned_task)
    graph_meta = _build_langgraph(plan, cleaned_task)

    return {
        "task": cleaned_task,
        "summary": plan.summary,
        "nodes": [node.model_dump() for node in plan.nodes],
        "edges": [edge.model_dump() for edge in plan.edges],
        "generated_by": generation_mode,
        "model": model_name,
        "warnings": warnings,
        "langgraph": graph_meta,
    }
