import { useEffect, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

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

  const queue = nodeList
    .map((node) => node.id)
    .filter((id) => (indegree.get(id) || 0) === 0);
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
        Describe a task above to generate a workflow DAG.
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

function HomeCard({ message, onLogout, loading }) {
  const [taskInput, setTaskInput] = useState('');
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerError, setPlannerError] = useState('');
  const [workflowPlan, setWorkflowPlan] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);

  const handleGenerateWorkflow = async (event) => {
    event.preventDefault();
    if (plannerLoading) return;

    const task = taskInput.trim();
    if (!task) {
      setPlannerError('Enter a task description first');
      return;
    }

    setPlannerLoading(true);
    setPlannerError('');
    setChatMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, role: 'user', content: task },
    ]);

    try {
      const response = await apiFetch('/api/workflow/plan', {
        method: 'POST',
        body: JSON.stringify({ task }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to generate workflow'));
      }

      const data = await response.json();
      setWorkflowPlan(data);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-assistant`,
          role: 'assistant',
          content:
            typeof data.summary === 'string' && data.summary.trim()
              ? data.summary.trim()
              : 'Generated a workflow plan.',
        },
      ]);
    } catch (err) {
      setPlannerError(err instanceof Error ? err.message : 'Failed to generate workflow');
    } finally {
      setPlannerLoading(false);
    }
  };

  return (
    <section className="panel home-panel" aria-labelledby="home-title">
      <div className="home-toolbar">
        <div className="chip">authenticated session</div>
        <button type="button" className="button ghost button-compact" onClick={onLogout} disabled={loading}>
          {loading ? 'Signing out…' : 'Logout'}
        </button>
      </div>

      <h1 id="home-title">Agent Workflow Builder</h1>
      <p className="subtitle home-subtitle">{message || 'Describe a task to generate an agent DAG.'}</p>

      <section className="workflow-section" aria-labelledby="chat-title">
        <div className="section-head">
          <h2 id="chat-title">Task Chat</h2>
          <span className="chip subtle-chip">workflow planner</span>
        </div>

        <div className="chat-window" aria-live="polite" aria-label="Workflow planning chat transcript">
          {chatMessages.length === 0 ? (
            <div className="chat-placeholder">
              Start with a task like “Plan a feature launch with research, implementation, and QA agents.”
            </div>
          ) : (
            chatMessages.map((entry) => (
              <article key={entry.id} className={`chat-message ${entry.role}`}>
                <div className="chat-message-role">{entry.role === 'user' ? 'you' : 'planner'}</div>
                <p>{entry.content}</p>
              </article>
            ))
          )}
        </div>

        <form onSubmit={handleGenerateWorkflow} className="chat-form">
          <label className="label" htmlFor="task-input">
            Describe the workflow task
          </label>
          <textarea
            id="task-input"
            className="textarea"
            value={taskInput}
            onChange={(event) => setTaskInput(event.target.value)}
            placeholder="Build an agent workflow to triage support tickets, gather account context, draft a response, and escalate risky cases..."
            rows={4}
            disabled={plannerLoading}
          />
          <div className="chat-form-footer">
            <p className={plannerError ? 'error' : 'hint'} role={plannerError ? 'alert' : 'status'}>
              {plannerError || 'The backend uses LangChain + LangGraph when configured with an OpenAI API key.'}
            </p>
            <button type="submit" className="button" disabled={plannerLoading}>
              {plannerLoading ? 'Generating…' : 'Generate Workflow'}
            </button>
          </div>
        </form>
      </section>

      <section className="workflow-section" aria-labelledby="dag-title">
        <div className="section-head">
          <h2 id="dag-title">Workflow DAG</h2>
          {workflowPlan ? (
            <span className="chip subtle-chip">
              {workflowPlan.generated_by === 'langchain_openai' ? 'langchain + langgraph' : 'fallback planner'}
            </span>
          ) : null}
        </div>

        {workflowPlan ? (
          <>
            <p className="workflow-summary">{workflowPlan.summary}</p>
            {Array.isArray(workflowPlan.warnings) && workflowPlan.warnings.length > 0 ? (
              <div className="workflow-warning" role="status">
                {workflowPlan.warnings[0]}
              </div>
            ) : null}
            <WorkflowDag plan={workflowPlan} />
            <div className="agent-grid" aria-label="Agent node details">
              {(workflowPlan.nodes || []).map((node) => (
                <article key={node.id} className="agent-card">
                  <h3>{node.name}</h3>
                  <p className="agent-role">{node.role}</p>
                  <p className="agent-objective">{node.objective}</p>
                  <code>{node.id}</code>
                </article>
              ))}
            </div>
          </>
        ) : (
          <WorkflowDag plan={null} />
        )}
      </section>
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
