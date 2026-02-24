import { useEffect, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const WORKFLOWS_STORAGE_KEY = 'ninth-seat.workflows.v1';
const RUNS_STORAGE_KEY = 'ninth-seat.runs.v1';

const SIDEBAR_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'runs', label: 'Runs' },
  { id: 'settings', label: 'Settings' },
];

const WORKFLOW_DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'dag', label: 'DAG' },
  { id: 'agents', label: 'Agents' },
  { id: 'runs', label: 'Runs' },
];

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const hasBody = options.body !== undefined;

  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    ...options,
    headers,
  });

  return response;
}

async function readErrorMessage(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => null);
    if (data && typeof data.detail === 'string') {
      return data.detail;
    }
  } else {
    const text = await response.text().catch(() => '');
    if (text && text.trim().startsWith('<')) {
      return 'API route returned HTML (check Vercel /api rewrite and Python function deploy)';
    }
  }

  return fallbackMessage;
}

function truncate(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function generateId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatLongDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0s';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function plannerSourceLabel(generatedBy) {
  if (generatedBy === 'langchain_openai') return 'langchain + langgraph';
  if (generatedBy === 'fallback_planner') return 'fallback planner';
  if (generatedBy) return generatedBy;
  return 'planner';
}

function inferWorkflowName(task, plan) {
  const summary = typeof plan?.summary === 'string' ? plan.summary.trim() : '';
  const base = summary || task || 'New workflow';
  const cleaned = base.replace(/[.?!]+$/g, '').trim();
  if (!cleaned) return 'New workflow';
  const words = cleaned.split(/\s+/).slice(0, 6).join(' ');
  return words.length > 42 ? `${words.slice(0, 41).trimEnd()}…` : words;
}

function ensureString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizePlannerPlan(plan, task) {
  const rawNodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  const seenIds = new Set();

  const nodes = rawNodes
    .map((node, index) => {
      const fallbackId = `agent_${index + 1}`;
      let id = ensureString(node?.id, fallbackId).trim() || fallbackId;
      if (seenIds.has(id)) {
        id = `${id}_${index + 1}`;
      }
      seenIds.add(id);

      return {
        id,
        name: ensureString(node?.name, `Agent ${index + 1}`).trim() || `Agent ${index + 1}`,
        role: ensureString(node?.role, '').trim(),
        objective: ensureString(node?.objective, '').trim(),
      };
    })
    .filter(Boolean);

  const nodeIds = new Set(nodes.map((node) => node.id));

  const edges = (Array.isArray(plan?.edges) ? plan.edges : [])
    .map((edge) => ({
      source: ensureString(edge?.source, '').trim(),
      target: ensureString(edge?.target, '').trim(),
      handoff: ensureString(edge?.handoff, '').trim(),
    }))
    .filter((edge) => edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target));

  return {
    summary:
      ensureString(plan?.summary, '').trim() ||
      `Workflow generated from: ${truncate(task || 'task', 120)}`,
    generated_by: ensureString(plan?.generated_by, 'frontend_mvp'),
    warnings: Array.isArray(plan?.warnings)
      ? plan.warnings.filter((warning) => typeof warning === 'string' && warning.trim())
      : [],
    nodes,
    edges,
  };
}

function graphValidationError(nodes, edges) {
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const edgeList = Array.isArray(edges) ? edges : [];

  if (nodeList.length === 0) {
    return 'Workflow needs at least one agent node.';
  }

  const ids = new Set();
  for (const node of nodeList) {
    const id = ensureString(node?.id, '').trim();
    if (!id) return 'Every agent requires a stable id.';
    if (ids.has(id)) return `Duplicate agent id: ${id}`;
    ids.add(id);
  }

  const pairs = new Set();
  for (const edge of edgeList) {
    const source = ensureString(edge?.source, '').trim();
    const target = ensureString(edge?.target, '').trim();
    if (!ids.has(source) || !ids.has(target)) {
      return 'Edges must connect existing agents.';
    }
    if (source === target) {
      return 'Self-loops are not allowed in a DAG.';
    }
    const pairKey = `${source}->${target}`;
    if (pairs.has(pairKey)) {
      return `Duplicate edge: ${pairKey}`;
    }
    pairs.add(pairKey);
  }

  const indegree = new Map(nodeList.map((node) => [node.id, 0]));
  const adjacency = new Map(nodeList.map((node) => [node.id, []]));

  for (const edge of edgeList) {
    adjacency.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  }

  const queue = nodeList.map((node) => node.id).filter((id) => (indegree.get(id) || 0) === 0);
  let visited = 0;
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor++];
    visited += 1;
    for (const next of adjacency.get(current) || []) {
      indegree.set(next, (indegree.get(next) || 0) - 1);
      if ((indegree.get(next) || 0) === 0) {
        queue.push(next);
      }
    }
  }

  if (visited !== nodeList.length) {
    return 'Graph contains a cycle. Remove or re-route one edge to keep it acyclic.';
  }

  return null;
}

function sortByNewest(items, dateKey) {
  return [...items].sort((a, b) => {
    const aTime = new Date(a?.[dateKey] || 0).getTime();
    const bTime = new Date(b?.[dateKey] || 0).getTime();
    return bTime - aTime;
  });
}

function loadStoredList(key) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredList(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or serialization failures in MVP.
  }
}

function buildDagLayout(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return null;
  }

  const nodeList = nodes
    .map((node, index) => ({
      id: typeof node.id === 'string' && node.id.trim() ? node.id.trim() : `agent_${index + 1}`,
      name: typeof node.name === 'string' && node.name.trim() ? node.name.trim() : `Agent ${index + 1}`,
      role: typeof node.role === 'string' ? node.role.trim() : '',
      objective: typeof node.objective === 'string' ? node.objective.trim() : '',
    }))
    .filter((node, index, list) => list.findIndex((candidate) => candidate.id === node.id) === index);

  const nodeIds = new Set(nodeList.map((node) => node.id));
  const filteredEdges = Array.isArray(edges)
    ? edges.filter(
        (edge) =>
          edge &&
          typeof edge.source === 'string' &&
          typeof edge.target === 'string' &&
          edge.source !== edge.target &&
          nodeIds.has(edge.source) &&
          nodeIds.has(edge.target)
      )
    : [];

  const adjacency = new Map(nodeList.map((node) => [node.id, []]));
  const incoming = new Map(nodeList.map((node) => [node.id, []]));
  const indegree = new Map(nodeList.map((node) => [node.id, 0]));

  filteredEdges.forEach((edge) => {
    adjacency.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });

  const queue = nodeList.map((node) => node.id).filter((id) => (indegree.get(id) || 0) === 0);
  const order = [];
  const queued = new Set(queue);
  let cursor = 0;

  while (cursor < queue.length) {
    const id = queue[cursor++];
    order.push(id);

    (adjacency.get(id) || []).forEach((target) => {
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if ((indegree.get(target) || 0) === 0 && !queued.has(target)) {
        queued.add(target);
        queue.push(target);
      }
    });
  }

  nodeList.forEach((node) => {
    if (!order.includes(node.id)) {
      order.push(node.id);
    }
  });

  const layerById = new Map();
  order.forEach((id, orderIndex) => {
    const parents = incoming.get(id) || [];
    const parentLayers = parents
      .map((parentId) => layerById.get(parentId))
      .filter((value) => Number.isInteger(value));

    const layer = parentLayers.length ? Math.max(...parentLayers) + 1 : 0;
    layerById.set(id, Number.isInteger(layer) ? layer : orderIndex);
  });

  const columns = [];
  order.forEach((id) => {
    const layer = layerById.get(id) || 0;
    if (!columns[layer]) columns[layer] = [];
    columns[layer].push(id);
  });

  const nodeWidth = 240;
  const nodeHeight = 96;
  const horizontalGap = 92;
  const verticalGap = 32;
  const paddingX = 28;
  const paddingY = 28;

  const maxRows = Math.max(1, ...columns.map((column) => (column ? column.length : 0)));
  const width = paddingX * 2 + columns.length * nodeWidth + Math.max(0, columns.length - 1) * horizontalGap;
  const height =
    paddingY * 2 + maxRows * nodeHeight + Math.max(0, maxRows - 1) * verticalGap;

  const positions = new Map();
  columns.forEach((column, columnIndex) => {
    const columnHeight = column.length * nodeHeight + Math.max(0, column.length - 1) * verticalGap;
    const startY = paddingY + (height - paddingY * 2 - columnHeight) / 2;

    column.forEach((id, rowIndex) => {
      positions.set(id, {
        x: paddingX + columnIndex * (nodeWidth + horizontalGap),
        y: startY + rowIndex * (nodeHeight + verticalGap),
      });
    });
  });

  const nodesById = new Map(nodeList.map((node) => [node.id, node]));

  return {
    width,
    height,
    nodeWidth,
    nodeHeight,
    positions,
    nodesById,
    edges: filteredEdges,
  };
}

function WorkflowDag({ plan }) {
  if (!plan || !Array.isArray(plan.nodes) || plan.nodes.length === 0) {
    return (
      <div className="dag-empty" role="status" aria-live="polite">
        Create or select a workflow to view the DAG.
      </div>
    );
  }

  const layout = buildDagLayout(plan.nodes, plan.edges || []);
  if (!layout) {
    return <div className="dag-empty">Unable to render DAG.</div>;
  }

  return (
    <div className="dag-shell">
      <svg
        className="dag-svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="Workflow directed acyclic graph"
        preserveAspectRatio="xMinYMin meet"
      >
        <defs>
          <marker
            id="dag-arrow"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(223, 232, 245, 0.72)" />
          </marker>
        </defs>

        {layout.edges.map((edge, index) => {
          const from = layout.positions.get(edge.source);
          const to = layout.positions.get(edge.target);
          if (!from || !to) return null;

          const sx = from.x + layout.nodeWidth;
          const sy = from.y + layout.nodeHeight / 2;
          const tx = to.x;
          const ty = to.y + layout.nodeHeight / 2;
          const dx = Math.max(42, (tx - sx) * 0.45);
          const path = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
          const labelX = (sx + tx) / 2;
          const labelY = (sy + ty) / 2;

          return (
            <g key={`${edge.source}-${edge.target}-${index}`}>
              <path
                d={path}
                fill="none"
                stroke="rgba(223, 232, 245, 0.55)"
                strokeWidth="2"
                markerEnd="url(#dag-arrow)"
              />
              {edge.handoff ? (
                <text
                  x={labelX}
                  y={labelY - 6}
                  textAnchor="middle"
                  fill="rgba(168, 176, 190, 0.9)"
                  fontSize="11"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {truncate(edge.handoff, 18)}
                </text>
              ) : null}
            </g>
          );
        })}

        {plan.nodes.map((node) => {
          const position = layout.positions.get(node.id);
          if (!position) return null;
          const title = truncate(node.name, 26);
          const role = truncate(node.role, 34);

          return (
            <g key={node.id} transform={`translate(${position.x} ${position.y})`}>
              <rect
                width={layout.nodeWidth}
                height={layout.nodeHeight}
                rx="11"
                fill="rgba(12, 16, 23, 0.92)"
                stroke="rgba(255, 255, 255, 0.12)"
              />
              <rect
                x="0.5"
                y="0.5"
                width={layout.nodeWidth - 1}
                height={layout.nodeHeight - 1}
                rx="10.5"
                fill="none"
                stroke="rgba(223, 232, 245, 0.06)"
              />
              <text
                x="16"
                y="28"
                fill="rgba(238, 242, 247, 0.96)"
                fontSize="13"
                fontFamily="IBM Plex Mono, monospace"
              >
                {title}
              </text>
              <text
                x="16"
                y="50"
                fill="rgba(168, 176, 190, 0.95)"
                fontSize="11"
                fontFamily="IBM Plex Mono, monospace"
              >
                {role}
              </text>
              <text
                x="16"
                y="74"
                fill="rgba(219, 228, 239, 0.78)"
                fontSize="10"
                fontFamily="IBM Plex Mono, monospace"
              >
                {truncate(node.id, 32)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DotField() {
  const canvasRef = useRef(null);
  const pointerRef = useRef({ x: -1000, y: -1000, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let rafId = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (event) => {
      pointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        active: true,
      };
    };

    const onLeave = () => {
      pointerRef.current = {
        ...pointerRef.current,
        active: false,
      };
    };

    const draw = () => {
      const now = performance.now() * 0.001;
      const spacing = 24;
      const influenceRadius = 180;
      const { x, y, active } = pointerRef.current;

      ctx.clearRect(0, 0, width, height);

      for (let py = -spacing; py <= height + spacing; py += spacing) {
        for (let px = -spacing; px <= width + spacing; px += spacing) {
          const dx = x - px;
          const dy = y - py;
          const distance = Math.hypot(dx, dy);
          const influence = active ? Math.max(0, 1 - distance / influenceRadius) : 0;

          const pulse = 0.25 + 0.1 * Math.sin((px + py) * 0.03 + now * 2.2);
          const radius = 1.15 + pulse + influence * 2.6;
          const alpha = 0.12 + influence * 0.45;

          let offsetX = 0;
          let offsetY = 0;
          if (active && distance > 0.0001) {
            const pull = influence * 3.25;
            offsetX = (dx / distance) * pull;
            offsetY = (dy / distance) * pull;
          }

          ctx.beginPath();
          ctx.arc(px + offsetX, py + offsetY, radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(196, 201, 209, ${alpha})`;
          ctx.fill();
        }
      }

      rafId = window.requestAnimationFrame(draw);
    };

    resize();
    draw();

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="dot-field" aria-hidden="true" />;
}

function LoginCard({ password, onPasswordChange, onSubmit, loading, error }) {
  return (
    <section className="panel" aria-labelledby="login-title">
      <h1 id="login-title" className="login-title">
        Enter password
      </h1>

      <form onSubmit={onSubmit} className="login-form">
        <input
          id="password"
          type="password"
          aria-label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder="password"
          className="input"
          disabled={loading}
        />

        <p className={error ? 'error' : 'hint'} role={error ? 'alert' : undefined}>
          {error || ' '}
        </p>

        <button type="submit" className="button" disabled={loading}>
          {loading ? 'Verifying…' : 'Enter'}
        </button>
      </form>
    </section>
  );
}

function StatCard({ label, value, meta }) {
  return (
    <article className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      <p className="stat-meta">{meta}</p>
    </article>
  );
}

function EmptyState({ title, body, actionLabel, onAction }) {
  return (
    <div className="empty-state" role="status">
      <h3>{title}</h3>
      <p>{body}</p>
      {actionLabel && onAction ? (
        <button type="button" className="button button-compact" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function StatusPill({ status }) {
  const safe = ensureString(status, 'unknown').toLowerCase();
  return <span className={`status-pill ${safe}`}>{safe}</span>;
}

function RunsList({ runs, onSelectWorkflow, compact = false }) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return (
      <EmptyState
        title="No runs yet"
        body="Run a workflow to populate execution history and node-level outcomes."
      />
    );
  }

  return (
    <div className={`run-list ${compact ? 'compact' : ''}`}>
      {runs.map((run) => (
        <article key={run.id} className="run-card">
          <div className="run-card-top">
            <div>
              <p className="run-workflow-name">{run.workflowName || 'Workflow'}</p>
              <p className="run-meta-line">
                Started {formatDateTime(run.startedAt)} • {formatDuration(run.durationMs)}
              </p>
            </div>
            <StatusPill status={run.status} />
          </div>

          <p className="run-summary">{run.outputSummary || 'Execution completed.'}</p>

          {Array.isArray(run.nodeRuns) && run.nodeRuns.length > 0 ? (
            <div className="node-run-grid" aria-label="Node run statuses">
              {run.nodeRuns.map((nodeRun) => (
                <div key={`${run.id}-${nodeRun.nodeId}`} className="node-run-chip">
                  <span>{truncate(nodeRun.name || nodeRun.nodeId, 18)}</span>
                  <StatusPill status={nodeRun.status} />
                </div>
              ))}
            </div>
          ) : null}

          {run.workflowId && onSelectWorkflow ? (
            <div className="run-card-actions">
              <button
                type="button"
                className="button ghost button-compact"
                onClick={() => onSelectWorkflow(run.workflowId)}
              >
                Open Workflow
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function DashboardView({ homeMessage, workflows, runs, onOpenNewWorkflow, onSelectWorkflow, onRunWorkflow }) {
  const totalWorkflows = workflows.length;
  const totalRuns = runs.length;
  const lastRun = runs[0] || null;
  const successRuns = runs.filter((run) => run.status === 'success').length;
  const successRate = totalRuns > 0 ? `${Math.round((successRuns / totalRuns) * 100)}%` : '—';

  return (
    <div className="page-stack">
      {homeMessage ? <div className="banner-note">{homeMessage}</div> : null}

      <section className="stats-grid" aria-label="Workflow stats">
        <StatCard label="Workflows" value={String(totalWorkflows)} meta="Saved locally in browser" />
        <StatCard label="Runs" value={String(totalRuns)} meta="Execution history (MVP simulation)" />
        <StatCard label="Success Rate" value={successRate} meta="Across all recorded runs" />
        <StatCard label="Last Run" value={lastRun ? formatDateTime(lastRun.startedAt) : '—'} meta="Most recent execution" />
      </section>

      <section className="panel-surface">
        <div className="section-head">
          <h2>Quick Start</h2>
          <span className="chip subtle-chip">mvp</span>
        </div>
        <p className="surface-copy">
          Create a workflow from a natural language prompt, review the generated DAG, edit agents and edges,
          then run it from the workflow detail page.
        </p>
        <div className="inline-actions">
          <button type="button" className="button" onClick={onOpenNewWorkflow}>
            New Workflow
          </button>
        </div>
      </section>

      <div className="dashboard-columns">
        <section className="panel-surface">
          <div className="section-head">
            <h2>Recent Workflows</h2>
            <span className="chip subtle-chip">{workflows.length}</span>
          </div>
          {workflows.length === 0 ? (
            <EmptyState
              title="No workflows yet"
              body="Use New Workflow to generate your first agent DAG from a prompt."
              actionLabel="Create Workflow"
              onAction={onOpenNewWorkflow}
            />
          ) : (
            <div className="workflow-list compact">
              {workflows.slice(0, 6).map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  className="workflow-row"
                  onClick={() => onSelectWorkflow(workflow.id)}
                >
                  <div className="workflow-row-main">
                    <p className="workflow-row-title">{workflow.name}</p>
                    <p className="workflow-row-copy">{truncate(workflow.summary || workflow.prompt, 96)}</p>
                    <p className="workflow-row-meta">
                      {workflow.nodes?.length || 0} agents • {workflow.edges?.length || 0} edges • Updated{' '}
                      {formatDateTime(workflow.updatedAt)}
                    </p>
                  </div>
                  <div className="workflow-row-side">
                    <StatusPill status={workflow.lastRunStatus || 'draft'} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel-surface">
          <div className="section-head">
            <h2>Recent Runs</h2>
            <span className="chip subtle-chip">{runs.length}</span>
          </div>
          {runs.length === 0 ? (
            <EmptyState
              title="No executions yet"
              body="Run a workflow after creating one to see execution history here."
            />
          ) : (
            <div className="dashboard-run-list">
              {runs.slice(0, 4).map((run) => (
                <article key={run.id} className="dashboard-run-row">
                  <div>
                    <p className="run-workflow-name">{run.workflowName}</p>
                    <p className="run-meta-line">{formatDateTime(run.startedAt)} • {formatDuration(run.durationMs)}</p>
                  </div>
                  <div className="dashboard-run-actions">
                    <StatusPill status={run.status} />
                    <button
                      type="button"
                      className="button ghost button-compact"
                      onClick={() => onSelectWorkflow(run.workflowId)}
                    >
                      Open
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function WorkflowListPanel({ workflows, selectedWorkflowId, onSelectWorkflow, onOpenNewWorkflow, onRunWorkflow }) {
  return (
    <section className="panel-surface workflow-list-panel" aria-label="Saved workflows">
      <div className="section-head">
        <h2>Saved Workflows</h2>
        <div className="inline-actions">
          <span className="chip subtle-chip">{workflows.length}</span>
          <button type="button" className="button ghost button-compact" onClick={onOpenNewWorkflow}>
            New
          </button>
        </div>
      </div>

      {workflows.length === 0 ? (
        <EmptyState
          title="No workflows saved"
          body="Generate a workflow from a prompt to populate this list."
          actionLabel="New Workflow"
          onAction={onOpenNewWorkflow}
        />
      ) : (
        <div className="workflow-list">
          {workflows.map((workflow) => (
            <article
              key={workflow.id}
              className={`workflow-row selectable ${selectedWorkflowId === workflow.id ? 'selected' : ''}`}
            >
              <button type="button" className="workflow-row-button" onClick={() => onSelectWorkflow(workflow.id)}>
                <div className="workflow-row-main">
                  <p className="workflow-row-title">{workflow.name}</p>
                  <p className="workflow-row-copy">{truncate(workflow.summary || workflow.prompt, 110)}</p>
                  <p className="workflow-row-meta">
                    {workflow.nodes?.length || 0} agents • {workflow.edges?.length || 0} edges • {workflow.runCount || 0}{' '}
                    runs
                  </p>
                </div>
                <div className="workflow-row-side">
                  <StatusPill status={workflow.lastRunStatus || 'draft'} />
                </div>
              </button>
              <div className="workflow-row-footer">
                <span className="workflow-row-date">Updated {formatDateTime(workflow.updatedAt)}</span>
                <button
                  type="button"
                  className="button ghost button-compact"
                  onClick={() => onRunWorkflow(workflow.id)}
                >
                  Run
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function WorkflowOverviewTab({ workflow }) {
  return (
    <div className="detail-grid">
      <section className="panel-surface">
        <div className="section-head">
          <h2>Summary</h2>
          <span className="chip subtle-chip">v{workflow.version || 1}</span>
        </div>
        <p className="surface-copy">{workflow.summary || 'No summary provided.'}</p>
        <div className="kv-grid">
          <div className="kv-card">
            <span>Generated By</span>
            <strong>{plannerSourceLabel(workflow.generatedBy)}</strong>
          </div>
          <div className="kv-card">
            <span>Created</span>
            <strong>{formatDateTime(workflow.createdAt)}</strong>
          </div>
          <div className="kv-card">
            <span>Last Updated</span>
            <strong>{formatDateTime(workflow.updatedAt)}</strong>
          </div>
          <div className="kv-card">
            <span>Last Run</span>
            <strong>{formatDateTime(workflow.lastRunAt)}</strong>
          </div>
        </div>
      </section>

      <section className="panel-surface">
        <div className="section-head">
          <h2>Prompt</h2>
          <span className="chip subtle-chip">source</span>
        </div>
        <pre className="code-block">{workflow.prompt || '—'}</pre>
      </section>

      {Array.isArray(workflow.warnings) && workflow.warnings.length > 0 ? (
        <section className="panel-surface">
          <div className="section-head">
            <h2>Planner Warnings</h2>
          </div>
          <div className="stack-list">
            {workflow.warnings.map((warning, index) => (
              <div key={`${warning}-${index}`} className="workflow-warning">
                {warning}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DagEditor({ workflow, error, onAddEdge, onUpdateEdge, onDeleteEdge }) {
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const [newSource, setNewSource] = useState(nodes[0]?.id || '');
  const [newTarget, setNewTarget] = useState(nodes[1]?.id || nodes[0]?.id || '');
  const [handoff, setHandoff] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    setNewSource(nodes[0]?.id || '');
    setNewTarget(nodes[1]?.id || nodes[0]?.id || '');
    setHandoff('');
    setLocalError('');
  }, [workflow.id, nodes.length]);

  const addEdge = () => {
    const message = onAddEdge({
      source: newSource,
      target: newTarget,
      handoff: handoff.trim(),
    });
    if (message) {
      setLocalError(message);
      return;
    }
    setLocalError('');
    setHandoff('');
  };

  return (
    <div className="page-stack">
      <section className="panel-surface">
        <div className="section-head">
          <h2>Graph Preview</h2>
          <span className="chip subtle-chip">read-only preview</span>
        </div>
        <WorkflowDag plan={workflow} />
        <p className="hint inline-hint">Edit edges below. DAG validation prevents cycles and duplicate edges.</p>
      </section>

      <section className="panel-surface">
        <div className="section-head">
          <h2>Edges</h2>
          <span className="chip subtle-chip">{workflow.edges?.length || 0}</span>
        </div>

        {error ? (
          <div className="workflow-warning" role="alert">
            {error}
          </div>
        ) : null}

        {workflow.edges?.length ? (
          <div className="edge-list">
            {workflow.edges.map((edge, index) => (
              <div key={`${edge.source}-${edge.target}-${index}`} className="edge-row">
                <label className="field-group">
                  <span>Source</span>
                  <select
                    className="select"
                    value={edge.source}
                    onChange={(event) => onUpdateEdge(index, { source: event.target.value })}
                  >
                    {nodes.map((node) => (
                      <option key={`src-${node.id}`} value={node.id}>
                        {node.name} ({node.id})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-group">
                  <span>Target</span>
                  <select
                    className="select"
                    value={edge.target}
                    onChange={(event) => onUpdateEdge(index, { target: event.target.value })}
                  >
                    {nodes.map((node) => (
                      <option key={`dst-${node.id}`} value={node.id}>
                        {node.name} ({node.id})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-group edge-handoff-field">
                  <span>Handoff Label</span>
                  <input
                    type="text"
                    className="input"
                    value={edge.handoff || ''}
                    onChange={(event) => onUpdateEdge(index, { handoff: event.target.value })}
                    placeholder="optional handoff"
                  />
                </label>

                <button type="button" className="button danger button-compact" onClick={() => onDeleteEdge(index)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="surface-copy">No edges yet. Add a connection between agents below.</p>
        )}

        <div className="edge-add">
          <label className="field-group">
            <span>New Source</span>
            <select className="select" value={newSource} onChange={(event) => setNewSource(event.target.value)}>
              {nodes.map((node) => (
                <option key={`new-src-${node.id}`} value={node.id}>
                  {node.name} ({node.id})
                </option>
              ))}
            </select>
          </label>

          <label className="field-group">
            <span>New Target</span>
            <select className="select" value={newTarget} onChange={(event) => setNewTarget(event.target.value)}>
              {nodes.map((node) => (
                <option key={`new-target-${node.id}`} value={node.id}>
                  {node.name} ({node.id})
                </option>
              ))}
            </select>
          </label>

          <label className="field-group edge-handoff-field">
            <span>Handoff Label</span>
            <input
              type="text"
              className="input"
              value={handoff}
              onChange={(event) => setHandoff(event.target.value)}
              placeholder="pass context / output"
            />
          </label>

          <button type="button" className="button button-compact" onClick={addEdge} disabled={nodes.length < 2}>
            Add Edge
          </button>
        </div>

        {(localError || error) && !error ? (
          <p className="error" role="alert">
            {localError}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function AgentsEditor({ workflow, onAddAgent, onDeleteAgent, onUpdateAgentField }) {
  return (
    <div className="page-stack">
      <section className="panel-surface">
        <div className="section-head">
          <h2>Agents</h2>
          <div className="inline-actions">
            <span className="chip subtle-chip">auto-saves locally</span>
            <button type="button" className="button button-compact" onClick={onAddAgent}>
              Add Agent
            </button>
          </div>
        </div>

        {workflow.nodes?.length ? (
          <div className="agent-grid">
            {workflow.nodes.map((node) => (
              <article key={node.id} className="agent-card agent-card-editor">
                <div className="agent-card-head">
                  <code>{node.id}</code>
                  <button
                    type="button"
                    className="button danger button-compact"
                    onClick={() => onDeleteAgent(node.id)}
                    disabled={(workflow.nodes?.length || 0) <= 1}
                  >
                    Delete
                  </button>
                </div>

                <label className="field-group">
                  <span>Name</span>
                  <input
                    type="text"
                    className="input"
                    value={node.name || ''}
                    onChange={(event) => onUpdateAgentField(node.id, 'name', event.target.value)}
                    placeholder="Research Agent"
                  />
                </label>

                <label className="field-group">
                  <span>Role</span>
                  <input
                    type="text"
                    className="input"
                    value={node.role || ''}
                    onChange={(event) => onUpdateAgentField(node.id, 'role', event.target.value)}
                    placeholder="Gathers context and constraints"
                  />
                </label>

                <label className="field-group">
                  <span>Objective</span>
                  <textarea
                    className="textarea textarea-compact"
                    rows={4}
                    value={node.objective || ''}
                    onChange={(event) => onUpdateAgentField(node.id, 'objective', event.target.value)}
                    placeholder="Collect source material and produce a concise brief for the next node."
                  />
                </label>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No agents"
            body="Add an agent to start defining the workflow."
            actionLabel="Add Agent"
            onAction={onAddAgent}
          />
        )}
      </section>
    </div>
  );
}

function WorkflowRunsTab({ workflow, runs, onRunWorkflow, onSelectWorkflow }) {
  return (
    <div className="page-stack">
      <section className="panel-surface">
        <div className="section-head">
          <h2>Run Workflow</h2>
          <span className="chip subtle-chip">simulation</span>
        </div>
        <p className="surface-copy">
          MVP frontend run mode simulates execution using the current DAG and records node statuses locally.
        </p>
        <div className="inline-actions">
          <button type="button" className="button" onClick={() => onRunWorkflow(workflow.id)}>
            Run Workflow
          </button>
        </div>
      </section>

      <section className="panel-surface">
        <div className="section-head">
          <h2>Run History</h2>
          <span className="chip subtle-chip">{runs.length}</span>
        </div>
        <RunsList runs={runs} onSelectWorkflow={onSelectWorkflow} compact />
      </section>
    </div>
  );
}

function WorkflowDetail({
  workflow,
  runs,
  detailTab,
  onSelectDetailTab,
  onRunWorkflow,
  onSelectWorkflow,
  onAddAgent,
  onDeleteAgent,
  onUpdateAgentField,
  dagEditorError,
  onAddEdge,
  onUpdateEdge,
  onDeleteEdge,
}) {
  if (!workflow) {
    return (
      <section className="panel-surface workflow-detail-panel">
        <EmptyState
          title="Select a workflow"
          body="Choose a workflow from the list to inspect its DAG, edit agents, and run it."
        />
      </section>
    );
  }

  return (
    <section className="panel-surface workflow-detail-panel" aria-labelledby="workflow-detail-title">
      <div className="detail-header">
        <div>
          <div className="chip subtle-chip">workflow</div>
          <h2 id="workflow-detail-title" className="detail-title">
            {workflow.name}
          </h2>
          <p className="detail-copy">{truncate(workflow.summary || workflow.prompt, 220)}</p>
          <p className="detail-meta">
            {workflow.nodes?.length || 0} agents • {workflow.edges?.length || 0} edges • {workflow.runCount || 0}{' '}
            runs • Updated {formatDateTime(workflow.updatedAt)}
          </p>
        </div>
        <div className="detail-actions">
          <StatusPill status={workflow.lastRunStatus || 'draft'} />
          <button type="button" className="button" onClick={() => onRunWorkflow(workflow.id)}>
            Run Workflow
          </button>
        </div>
      </div>

      <div className="detail-tabs" role="tablist" aria-label="Workflow detail tabs">
        {WORKFLOW_DETAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={detailTab === tab.id}
            className={`tab-button ${detailTab === tab.id ? 'active' : ''}`}
            onClick={() => onSelectDetailTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="detail-tab-panel" role="tabpanel">
        {detailTab === 'overview' ? <WorkflowOverviewTab workflow={workflow} /> : null}
        {detailTab === 'dag' ? (
          <DagEditor
            workflow={workflow}
            error={dagEditorError}
            onAddEdge={onAddEdge}
            onUpdateEdge={onUpdateEdge}
            onDeleteEdge={onDeleteEdge}
          />
        ) : null}
        {detailTab === 'agents' ? (
          <AgentsEditor
            workflow={workflow}
            onAddAgent={onAddAgent}
            onDeleteAgent={onDeleteAgent}
            onUpdateAgentField={onUpdateAgentField}
          />
        ) : null}
        {detailTab === 'runs' ? (
          <WorkflowRunsTab
            workflow={workflow}
            runs={runs}
            onRunWorkflow={onRunWorkflow}
            onSelectWorkflow={onSelectWorkflow}
          />
        ) : null}
      </div>
    </section>
  );
}

function WorkflowsView({
  workflows,
  selectedWorkflow,
  selectedWorkflowId,
  workflowRuns,
  detailTab,
  onSelectWorkflow,
  onOpenNewWorkflow,
  onRunWorkflow,
  onSelectDetailTab,
  onAddAgent,
  onDeleteAgent,
  onUpdateAgentField,
  dagEditorError,
  onAddEdge,
  onUpdateEdge,
  onDeleteEdge,
}) {
  return (
    <div className="workflows-layout">
      <WorkflowListPanel
        workflows={workflows}
        selectedWorkflowId={selectedWorkflowId}
        onSelectWorkflow={onSelectWorkflow}
        onOpenNewWorkflow={onOpenNewWorkflow}
        onRunWorkflow={onRunWorkflow}
      />
      <WorkflowDetail
        workflow={selectedWorkflow}
        runs={workflowRuns}
        detailTab={detailTab}
        onSelectDetailTab={onSelectDetailTab}
        onRunWorkflow={onRunWorkflow}
        onSelectWorkflow={onSelectWorkflow}
        onAddAgent={onAddAgent}
        onDeleteAgent={onDeleteAgent}
        onUpdateAgentField={onUpdateAgentField}
        dagEditorError={dagEditorError}
        onAddEdge={onAddEdge}
        onUpdateEdge={onUpdateEdge}
        onDeleteEdge={onDeleteEdge}
      />
    </div>
  );
}

function RunsView({ runs, onSelectWorkflow }) {
  return (
    <section className="panel-surface">
      <div className="section-head">
        <h2>All Runs</h2>
        <span className="chip subtle-chip">{runs.length}</span>
      </div>
      <p className="surface-copy">
        Frontend MVP run history is persisted in local storage and uses simulated execution results.
      </p>
      <RunsList runs={runs} onSelectWorkflow={onSelectWorkflow} />
    </section>
  );
}

function SettingsView({ onResetDemoData }) {
  return (
    <div className="page-stack">
      <section className="panel-surface">
        <div className="section-head">
          <h2>Settings</h2>
          <span className="chip subtle-chip">mvp</span>
        </div>
        <p className="surface-copy">
          This frontend MVP stores workflows and run history in browser local storage. Planner generation still uses your backend endpoint.
        </p>
        <div className="kv-grid">
          <div className="kv-card">
            <span>Storage</span>
            <strong>localStorage</strong>
          </div>
          <div className="kv-card">
            <span>DAG Editing</span>
            <strong>Edge list editor</strong>
          </div>
          <div className="kv-card">
            <span>Agent Editing</span>
            <strong>Inline forms</strong>
          </div>
          <div className="kv-card">
            <span>Runs</span>
            <strong>Simulated</strong>
          </div>
        </div>
      </section>

      <section className="panel-surface">
        <div className="section-head">
          <h2>Reset Demo Data</h2>
        </div>
        <p className="surface-copy">
          Clears locally saved workflows and runs from this browser only.
        </p>
        <div className="inline-actions">
          <button type="button" className="button danger" onClick={onResetDemoData}>
            Clear Local Data
          </button>
        </div>
      </section>
    </div>
  );
}

function NewWorkflowModal({ open, onClose, onCreateWorkflow }) {
  const [taskInput, setTaskInput] = useState('');
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerError, setPlannerError] = useState('');
  const [draftPlan, setDraftPlan] = useState(null);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    setTaskInput('');
    setPlannerLoading(false);
    setPlannerError('');
    setDraftPlan(null);
  }, [open]);

  if (!open) return null;

  const handleGenerateWorkflow = async (event) => {
    event.preventDefault();
    if (plannerLoading) return;

    const task = taskInput.trim();
    if (!task) {
      setPlannerError('Enter a workflow description first.');
      return;
    }

    setPlannerLoading(true);
    setPlannerError('');
    setDraftPlan(null);

    try {
      const response = await apiFetch('/api/workflow/plan', {
        method: 'POST',
        body: JSON.stringify({ task }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to generate workflow'));
      }

      const data = await response.json();
      const normalized = normalizePlannerPlan(data, task);
      const validation = graphValidationError(normalized.nodes, normalized.edges);
      if (validation) {
        normalized.warnings = [...(normalized.warnings || []), validation];
      }
      setDraftPlan(normalized);
    } catch (err) {
      setPlannerError(err instanceof Error ? err.message : 'Failed to generate workflow');
    } finally {
      setPlannerLoading(false);
    }
  };

  const handleCreate = () => {
    const task = taskInput.trim();
    if (!task) {
      setPlannerError('Enter a workflow description first.');
      return;
    }
    if (!draftPlan) {
      setPlannerError('Generate a draft workflow before saving.');
      return;
    }

    onCreateWorkflow(task, draftPlan);
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-workflow-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="chip">new workflow</div>
            <h2 id="new-workflow-title">Describe a workflow</h2>
            <p className="subtitle">
              Use a prompt to generate an agent DAG draft, then save it to your dashboard.
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close new workflow dialog">
            ×
          </button>
        </div>

        <div className="modal-body">
          <form className="page-stack" onSubmit={handleGenerateWorkflow}>
            <label className="field-group" htmlFor="new-workflow-input">
              <span>Workflow Prompt</span>
              <textarea
                id="new-workflow-input"
                className="textarea"
                rows={5}
                value={taskInput}
                onChange={(event) => {
                  setTaskInput(event.target.value);
                  if (draftPlan) {
                    setDraftPlan(null);
                  }
                }}
                disabled={plannerLoading}
                placeholder="Build an agent workflow to intake feature requests, gather product context, propose an implementation plan, review risks, and produce a launch checklist..."
              />
            </label>

            <div className="modal-actions">
              <p className={plannerError ? 'error' : 'hint'} role={plannerError ? 'alert' : 'status'}>
                {plannerError || 'Generate a draft to preview the DAG before saving.'}
              </p>
              <div className="inline-actions">
                <button type="button" className="button ghost" onClick={onClose} disabled={plannerLoading}>
                  Cancel
                </button>
                <button type="submit" className="button" disabled={plannerLoading}>
                  {plannerLoading ? 'Generating…' : 'Generate Draft'}
                </button>
              </div>
            </div>
          </form>

          {draftPlan ? (
            <div className="modal-preview-grid">
              <section className="panel-surface modal-preview-panel">
                <div className="section-head">
                  <h2>Draft Preview</h2>
                  <span className="chip subtle-chip">{plannerSourceLabel(draftPlan.generated_by)}</span>
                </div>
                <p className="surface-copy">{draftPlan.summary}</p>
                {draftPlan.warnings?.length ? (
                  <div className="stack-list">
                    {draftPlan.warnings.map((warning, index) => (
                      <div key={`${warning}-${index}`} className="workflow-warning">
                        {warning}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="kv-grid">
                  <div className="kv-card">
                    <span>Agents</span>
                    <strong>{draftPlan.nodes.length}</strong>
                  </div>
                  <div className="kv-card">
                    <span>Edges</span>
                    <strong>{draftPlan.edges.length}</strong>
                  </div>
                </div>
              </section>

              <section className="panel-surface modal-preview-panel">
                <div className="section-head">
                  <h2>DAG Preview</h2>
                  <button type="button" className="button button-compact" onClick={handleCreate}>
                    Save Workflow
                  </button>
                </div>
                <WorkflowDag plan={draftPlan} />
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function HomeCard({ message, onLogout, loading }) {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [isNewWorkflowOpen, setIsNewWorkflowOpen] = useState(false);
  const [workflows, setWorkflows] = useState(() => sortByNewest(loadStoredList(WORKFLOWS_STORAGE_KEY), 'updatedAt'));
  const [runs, setRuns] = useState(() => sortByNewest(loadStoredList(RUNS_STORAGE_KEY), 'startedAt'));
  const [dagEditorError, setDagEditorError] = useState('');
  const [uiNotice, setUiNotice] = useState('');

  useEffect(() => {
    saveStoredList(WORKFLOWS_STORAGE_KEY, workflows);
  }, [workflows]);

  useEffect(() => {
    saveStoredList(RUNS_STORAGE_KEY, runs);
  }, [runs]);

  useEffect(() => {
    if (!selectedWorkflowId) {
      if (workflows[0]?.id) {
        setSelectedWorkflowId(workflows[0].id);
      }
      return;
    }

    const exists = workflows.some((workflow) => workflow.id === selectedWorkflowId);
    if (!exists) {
      setSelectedWorkflowId(workflows[0]?.id || null);
      setDetailTab('overview');
      setDagEditorError('');
    }
  }, [selectedWorkflowId, workflows]);

  useEffect(() => {
    if (!uiNotice) return undefined;
    const timer = window.setTimeout(() => setUiNotice(''), 2400);
    return () => window.clearTimeout(timer);
  }, [uiNotice]);

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) || null;
  const selectedWorkflowRuns = runs.filter((run) => run.workflowId === selectedWorkflowId);

  const setWorkflowFields = (workflowId, updater) => {
    setWorkflows((prev) =>
      sortByNewest(
        prev.map((workflow) => {
          if (workflow.id !== workflowId) return workflow;
          const cloned = {
            ...workflow,
            nodes: Array.isArray(workflow.nodes) ? workflow.nodes.map((node) => ({ ...node })) : [],
            edges: Array.isArray(workflow.edges) ? workflow.edges.map((edge) => ({ ...edge })) : [],
            warnings: Array.isArray(workflow.warnings) ? [...workflow.warnings] : [],
          };
          const next = updater(cloned) || cloned;
          return {
            ...next,
            updatedAt: new Date().toISOString(),
          };
        }),
        'updatedAt'
      )
    );
  };

  const handleSelectWorkflow = (workflowId) => {
    setActiveSection('workflows');
    setSelectedWorkflowId(workflowId);
    setDetailTab('overview');
    setDagEditorError('');
  };

  const handleCreateWorkflow = (task, draftPlan) => {
    const normalized = normalizePlannerPlan(draftPlan, task);
    const validation = graphValidationError(normalized.nodes, normalized.edges);
    if (validation) {
      normalized.warnings = [...(normalized.warnings || []), validation];
    }

    const now = new Date().toISOString();
    const workflow = {
      id: generateId('wf'),
      name: inferWorkflowName(task, normalized),
      prompt: task,
      summary: normalized.summary,
      generatedBy: normalized.generated_by,
      warnings: normalized.warnings || [],
      nodes: normalized.nodes,
      edges: normalized.edges,
      version: 1,
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: 'draft',
    };

    setWorkflows((prev) => sortByNewest([workflow, ...prev], 'updatedAt'));
    setSelectedWorkflowId(workflow.id);
    setActiveSection('workflows');
    setDetailTab('overview');
    setDagEditorError('');
    setUiNotice(`Created ${workflow.name}`);
  };

  const applyEdgeUpdate = (nextEdges, successNotice) => {
    if (!selectedWorkflow) return 'Select a workflow first.';
    const validation = graphValidationError(selectedWorkflow.nodes, nextEdges);
    if (validation) {
      setDagEditorError(validation);
      return validation;
    }

    setDagEditorError('');
    setWorkflowFields(selectedWorkflow.id, (workflow) => ({
      ...workflow,
      edges: nextEdges,
    }));
    if (successNotice) {
      setUiNotice(successNotice);
    }
    return null;
  };

  const handleAddEdge = (edge) => {
    if (!selectedWorkflow) return 'Select a workflow first.';
    const source = ensureString(edge?.source, '').trim();
    const target = ensureString(edge?.target, '').trim();
    if (!source || !target) return 'Choose both source and target.';

    const nextEdges = [...(selectedWorkflow.edges || []), { source, target, handoff: ensureString(edge?.handoff, '').trim() }];
    return applyEdgeUpdate(nextEdges, 'DAG updated');
  };

  const handleUpdateEdge = (edgeIndex, patch) => {
    if (!selectedWorkflow) return;
    const nextEdges = (selectedWorkflow.edges || []).map((edge, index) => {
      if (index !== edgeIndex) return edge;
      return {
        ...edge,
        ...patch,
      };
    });
    applyEdgeUpdate(
      nextEdges.map((edge) => ({
        ...edge,
        source: ensureString(edge.source, '').trim(),
        target: ensureString(edge.target, '').trim(),
        handoff: ensureString(edge.handoff, '').trim(),
      })),
      'DAG updated'
    );
  };

  const handleDeleteEdge = (edgeIndex) => {
    if (!selectedWorkflow) return;
    const nextEdges = (selectedWorkflow.edges || []).filter((_, index) => index !== edgeIndex);
    applyEdgeUpdate(nextEdges, 'Edge removed');
  };

  const handleAddAgent = () => {
    if (!selectedWorkflow) return;
    const existingIds = new Set((selectedWorkflow.nodes || []).map((node) => node.id));
    let counter = (selectedWorkflow.nodes?.length || 0) + 1;
    let id = `agent_${counter}`;
    while (existingIds.has(id)) {
      counter += 1;
      id = `agent_${counter}`;
    }

    const newNode = {
      id,
      name: `Agent ${counter}`,
      role: '',
      objective: '',
    };

    setWorkflowFields(selectedWorkflow.id, (workflow) => ({
      ...workflow,
      nodes: [...(workflow.nodes || []), newNode],
    }));
    setUiNotice('Agent added');
  };

  const handleDeleteAgent = (nodeId) => {
    if (!selectedWorkflow) return;
    const nodes = selectedWorkflow.nodes || [];
    if (nodes.length <= 1) return;

    const nextNodes = nodes.filter((node) => node.id !== nodeId);
    const nextEdges = (selectedWorkflow.edges || []).filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    const validation = graphValidationError(nextNodes, nextEdges);
    if (validation) {
      setDagEditorError(validation);
      return;
    }

    setDagEditorError('');
    setWorkflowFields(selectedWorkflow.id, (workflow) => ({
      ...workflow,
      nodes: nextNodes,
      edges: nextEdges,
    }));
    setUiNotice('Agent removed');
  };

  const handleUpdateAgentField = (nodeId, field, value) => {
    if (!selectedWorkflow) return;
    setWorkflowFields(selectedWorkflow.id, (workflow) => ({
      ...workflow,
      nodes: (workflow.nodes || []).map((node) =>
        node.id === nodeId
          ? {
              ...node,
              [field]: value,
            }
          : node
      ),
    }));
  };

  const handleRunWorkflow = (workflowId) => {
    const workflow = workflows.find((candidate) => candidate.id === workflowId);
    if (!workflow) return;

    const validation = graphValidationError(workflow.nodes, workflow.edges || []);
    if (validation) {
      setDagEditorError(validation);
      setActiveSection('workflows');
      setSelectedWorkflowId(workflowId);
      setDetailTab('dag');
      return;
    }

    const startedAt = new Date();
    const nodeRuns = (workflow.nodes || []).map((node, index) => ({
      nodeId: node.id,
      name: node.name,
      status: 'success',
      durationMs: 350 + index * 180,
    }));
    const durationMs = nodeRuns.reduce((total, nodeRun) => total + nodeRun.durationMs, 0);
    const finishedAt = new Date(startedAt.getTime() + durationMs);
    const run = {
      id: generateId('run'),
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'success',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      nodeRuns,
      outputSummary: `Executed ${nodeRuns.length} agents and completed the workflow successfully.`,
    };

    setRuns((prev) => sortByNewest([run, ...prev], 'startedAt'));
    setWorkflows((prev) =>
      sortByNewest(
        prev.map((item) =>
          item.id === workflow.id
            ? {
                ...item,
                updatedAt: new Date().toISOString(),
                lastRunAt: run.startedAt,
                lastRunStatus: run.status,
                runCount: (item.runCount || 0) + 1,
              }
            : item
        ),
        'updatedAt'
      )
    );

    if (selectedWorkflowId === workflowId) {
      setDetailTab('runs');
    }
    setUiNotice(`Ran ${workflow.name}`);
  };

  const handleResetDemoData = () => {
    setWorkflows([]);
    setRuns([]);
    setSelectedWorkflowId(null);
    setDetailTab('overview');
    setDagEditorError('');
    setUiNotice('Cleared local workflow data');
  };

  const pageTitle =
    activeSection === 'dashboard'
      ? 'Dashboard'
      : activeSection === 'workflows'
        ? selectedWorkflow?.name || 'Workflows'
        : activeSection === 'runs'
          ? 'Runs'
          : 'Settings';

  const pageSubtitle =
    activeSection === 'dashboard'
      ? 'Create and manage agent workflows generated from natural language prompts.'
      : activeSection === 'workflows'
        ? 'Inspect workflow DAGs, edit agent nodes, and trigger runs.'
        : activeSection === 'runs'
          ? 'Review execution history and node outcomes.'
          : 'Frontend MVP settings and local storage controls.';

  return (
    <section className="panel home-panel" aria-labelledby="home-title">
      <div className="app-layout">
        <aside className="sidebar" aria-label="App navigation">
          <div className="sidebar-brand">
            <div className="chip">ninth seat</div>
            <p className="sidebar-brand-title">Agent Workflow Builder</p>
            <p className="sidebar-brand-copy">Prompt-to-DAG planning and workflow execution UI.</p>
          </div>

          <nav className="sidebar-nav">
            {SIDEBAR_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`sidebar-tab ${activeSection === tab.id ? 'active' : ''}`}
                onClick={() => setActiveSection(tab.id)}
              >
                <span>{tab.label}</span>
                {tab.id === 'workflows' ? <small>{workflows.length}</small> : null}
                {tab.id === 'runs' ? <small>{runs.length}</small> : null}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-session">
              <span className="chip subtle-chip">authenticated</span>
              <p className="sidebar-footnote">Local MVP data persists in this browser session.</p>
            </div>
            <button type="button" className="button ghost button-compact" onClick={onLogout} disabled={loading}>
              {loading ? 'Signing out…' : 'Logout'}
            </button>
          </div>
        </aside>

        <div className="workspace">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">frontend mvp</p>
              <h1 id="home-title">{pageTitle}</h1>
              <p className="subtitle workspace-subtitle">{pageSubtitle}</p>
            </div>
            <div className="workspace-actions">
              {uiNotice ? <p className="inline-toast">{uiNotice}</p> : null}
              <button type="button" className="button" onClick={() => setIsNewWorkflowOpen(true)}>
                New Workflow
              </button>
            </div>
          </header>

          <div className="workspace-content">
            {activeSection === 'dashboard' ? (
              <DashboardView
                homeMessage={message}
                workflows={workflows}
                runs={runs}
                onOpenNewWorkflow={() => setIsNewWorkflowOpen(true)}
                onSelectWorkflow={handleSelectWorkflow}
                onRunWorkflow={handleRunWorkflow}
              />
            ) : null}

            {activeSection === 'workflows' ? (
              <WorkflowsView
                workflows={workflows}
                selectedWorkflow={selectedWorkflow}
                selectedWorkflowId={selectedWorkflowId}
                workflowRuns={selectedWorkflowRuns}
                detailTab={detailTab}
                onSelectWorkflow={handleSelectWorkflow}
                onOpenNewWorkflow={() => setIsNewWorkflowOpen(true)}
                onRunWorkflow={handleRunWorkflow}
                onSelectDetailTab={setDetailTab}
                onAddAgent={handleAddAgent}
                onDeleteAgent={handleDeleteAgent}
                onUpdateAgentField={handleUpdateAgentField}
                dagEditorError={dagEditorError}
                onAddEdge={handleAddEdge}
                onUpdateEdge={handleUpdateEdge}
                onDeleteEdge={handleDeleteEdge}
              />
            ) : null}

            {activeSection === 'runs' ? (
              <RunsView runs={runs} onSelectWorkflow={handleSelectWorkflow} />
            ) : null}

            {activeSection === 'settings' ? (
              <SettingsView onResetDemoData={handleResetDemoData} />
            ) : null}
          </div>
        </div>
      </div>

      <NewWorkflowModal
        open={isNewWorkflowOpen}
        onClose={() => setIsNewWorkflowOpen(false)}
        onCreateWorkflow={handleCreateWorkflow}
      />
    </section>
  );
}

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [homeMessage, setHomeMessage] = useState('');

  const loadHomeMessage = async () => {
    const response = await apiFetch('/api/home');
    if (!response.ok) {
      throw new Error('Unable to load home page');
    }
    const data = await response.json();
    setHomeMessage(data.message || 'nothing here yet');
  };

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        const response = await apiFetch('/api/session');
        if (!response.ok) {
          throw new Error('Session check failed');
        }
        const data = await response.json();
        if (!active) return;

        setAuthenticated(Boolean(data.authenticated));
        if (data.authenticated) {
          await loadHomeMessage();
        }
      } catch {
        if (!active) return;
        setAuthenticated(false);
      } finally {
        if (active) {
          setAuthChecked(true);
        }
      }
    };

    checkSession();

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError('');

    try {
      const response = await apiFetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Invalid password'));
      }

      setAuthenticated(true);
      setPassword('');
      await loadHomeMessage();
    } catch (err) {
      setAuthenticated(false);
      setHomeMessage('');
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      await apiFetch('/api/logout', { method: 'POST' });
    } finally {
      setAuthenticated(false);
      setHomeMessage('');
      setLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <DotField />
      <div className="ambient ambient-a" aria-hidden="true" />
      <div className="ambient ambient-b" aria-hidden="true" />

      {!authChecked ? (
        <section className="panel loading-panel">
          <div className="chip">initializing</div>
          <p className="subtitle">Checking session…</p>
        </section>
      ) : authenticated ? (
        <HomeCard message={homeMessage} onLogout={handleLogout} loading={loading} />
      ) : (
        <LoginCard
          password={password}
          onPasswordChange={setPassword}
          onSubmit={handleSubmit}
          loading={loading}
          error={error}
        />
      )}
    </main>
  );
}

export default App;
