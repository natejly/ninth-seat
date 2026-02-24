import { useEffect, useId, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const WORKFLOWS_STORAGE_KEY = 'ninth-seat.workflows.v1';
const RUNS_STORAGE_KEY = 'ninth-seat.runs.v1';

const SIDEBAR_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'workflows', label: 'Workflow Creator' },
  { id: 'workflowRuns', label: 'Workflows & Runs' },
];

const INTERACTIVE_GRAPH_LAYOUT = {
  nodeWidth: 280,
  nodeHeight: 112,
  horizontalGap: 132,
  verticalGap: 72,
  paddingX: 56,
  paddingY: 56,
  minCanvasWidth: 1280,
  minCanvasHeight: 680,
};

const INPUT_MODULE_TYPE_OPTIONS = [
  { value: 'user_input', label: 'User Input' },
  { value: 'long_text', label: 'Long Text' },
  { value: 'file_upload', label: 'File Upload' },
  { value: 'url', label: 'URL' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'choice', label: 'Choice' },
  { value: 'json', label: 'JSON' },
];

const OUTPUT_TYPE_OPTIONS = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Text' },
  { value: 'file', label: 'File' },
  { value: 'json', label: 'JSON' },
  { value: 'csv', label: 'CSV' },
  { value: 'pdf', label: 'PDF' },
  { value: 'code_bundle', label: 'Code Bundle' },
];

const HANDOFF_FIELD_TYPE_OPTIONS = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'array', label: 'Array' },
  { value: 'object', label: 'Object' },
  { value: 'json', label: 'JSON' },
  { value: 'any', label: 'Any' },
];

const LIVE_UPLOAD_MAX_FILE_BYTES = 2 * 1024 * 1024;
const LIVE_UPLOAD_MAX_TEXT_CHARS = 120_000;
const LIVE_UPLOAD_MAX_DATA_URL_CHARS = 220_000;

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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function isLikelyTextUpload(file) {
  const mime = ensureString(file?.type, '').toLowerCase();
  const name = ensureString(file?.name, '').toLowerCase();
  if (mime.startsWith('text/')) return true;
  if (mime.includes('json') || mime.includes('xml') || mime.includes('yaml') || mime.includes('csv')) return true;
  return /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|rb|go|java|c|cc|cpp|h|hpp|rs|sh|sql|html|css|xml|yaml|yml)$/i.test(
    name
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function serializeUploadedFileForRun(file) {
  if (!file) throw new Error('No file selected');
  if (file.size > LIVE_UPLOAD_MAX_FILE_BYTES) {
    throw new Error(`${file.name} exceeds ${formatBytes(LIVE_UPLOAD_MAX_FILE_BYTES)}. Upload a smaller file.`);
  }

  const base = {
    id: generateId('upl'),
    name: ensureString(file.name, 'upload'),
    mimeType: ensureString(file.type, '') || 'application/octet-stream',
    sizeBytes: Number.isFinite(file.size) ? file.size : 0,
    uploadedAt: new Date().toISOString(),
  };

  if (isLikelyTextUpload(file)) {
    const raw = await file.text();
    const text = raw.slice(0, LIVE_UPLOAD_MAX_TEXT_CHARS);
    return {
      ...base,
      kind: 'text',
      content: text,
      preview: truncate(text, 1000),
      truncated: raw.length > LIVE_UPLOAD_MAX_TEXT_CHARS,
    };
  }

  const dataUrl = await readFileAsDataUrl(file);
  return {
    ...base,
    kind: 'data_url',
    content: dataUrl.slice(0, LIVE_UPLOAD_MAX_DATA_URL_CHARS),
    preview: `${base.mimeType} (${formatBytes(base.sizeBytes)})`,
    truncated: dataUrl.length > LIVE_UPLOAD_MAX_DATA_URL_CHARS,
  };
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

function parseLineItems(text) {
  if (typeof text !== 'string') return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatLineItems(items) {
  if (!Array.isArray(items)) return '';
  return items
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n');
}

function slugifyClient(value, fallback) {
  const normalized = ensureString(value, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function createDefaultHandoffFieldMappings() {
  return [
    {
      id: 'handoff_field_1',
      targetKey: 'summary',
      sourcePath: 'summary',
      type: 'string',
      required: true,
      description: 'Primary summary from the source agent output.',
    },
    {
      id: 'handoff_field_2',
      targetKey: 'details',
      sourcePath: 'details',
      type: 'object',
      required: false,
      description: 'Structured details from the source agent output.',
    },
  ];
}

function coerceHandoffFieldMappings(rawItems, { preserveEmpty = false, ensureDefault = true } = {}) {
  const allowedTypes = new Set(HANDOFF_FIELD_TYPE_OPTIONS.map((option) => option.value));
  const items = Array.isArray(rawItems) ? rawItems : [];
  const normalized = items
    .map((item, index) => {
      const targetKey = ensureString(item?.targetKey, '').trim();
      const sourcePath = ensureString(item?.sourcePath, '').trim();
      const type = ensureString(item?.type, 'any').trim().toLowerCase() || 'any';
      const safeType = allowedTypes.has(type) ? type : 'any';
      return {
        id: ensureString(item?.id, `handoff_field_${index + 1}`) || `handoff_field_${index + 1}`,
        targetKey,
        sourcePath,
        type: safeType,
        required: item?.required !== false,
        description: ensureString(item?.description, '').trim(),
      };
    })
    .filter((item) => (preserveEmpty ? true : item.targetKey && item.sourcePath));

  if (normalized.length > 0) return normalized;
  if (ensureDefault) return createDefaultHandoffFieldMappings();
  return [];
}

function coerceHandoffContract(rawContract, edgeLabel = '', options = {}) {
  const contract = rawContract && typeof rawContract === 'object' ? rawContract : {};
  const rawPacketType = ensureString(contract?.packetType, '').trim();
  return {
    packetType: slugifyClient(rawPacketType || edgeLabel || 'handoff_packet', 'handoff_packet'),
    fields: coerceHandoffFieldMappings(contract?.fields ?? contract?.fieldMappings ?? contract?.mappings, options),
  };
}

function coerceWorkflowEdge(edge, { preserveEmptyHandoffFields = false } = {}) {
  const handoff = ensureString(edge?.handoff, '').trim();
  return {
    source: ensureString(edge?.source, '').trim(),
    target: ensureString(edge?.target, '').trim(),
    handoff,
    handoffContract: coerceHandoffContract(edge?.handoffContract ?? edge?.handoff_contract, handoff, {
      preserveEmpty: preserveEmptyHandoffFields,
      ensureDefault: true,
    }),
  };
}

function normalizeInputModuleSpecs(rawItems, task = '') {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const seen = new Set();
  const normalized = items
    .map((item, index) => {
      const fallbackName = index === 0 ? 'user_request' : `input_${index + 1}`;
      let name = slugifyClient(item?.name, fallbackName);
      if (seen.has(name)) {
        let suffix = 2;
        while (seen.has(`${name}_${suffix}`)) suffix += 1;
        name = `${name}_${suffix}`;
      }
      seen.add(name);

      const type = ensureString(item?.type, 'user_input').trim() || 'user_input';
      const allowedTypes = new Set(INPUT_MODULE_TYPE_OPTIONS.map((option) => option.value));
      const safeType = allowedTypes.has(type) ? type : 'user_input';

      return {
        id: ensureString(item?.id, `inputmod_${index + 1}`) || `inputmod_${index + 1}`,
        name,
        label:
          ensureString(item?.label, '')
            .trim() ||
          name
            .split('_')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' '),
        type: safeType,
        required: item?.required !== false,
        description: ensureString(item?.description, '').trim(),
      };
    })
    .filter((item) => item.name);

  if (normalized.length > 0) return normalized;

  const taskHint = ensureString(task, '').toLowerCase();
  const defaults = [
    {
      id: 'inputmod_1',
      name: 'user_request',
      label: 'User Request',
      type: 'long_text',
      required: true,
      description: 'Primary request or goal for the workflow.',
    },
  ];
  if (taskHint.includes('file') || taskHint.includes('pdf') || taskHint.includes('document')) {
    defaults.push({
      id: 'inputmod_2',
      name: 'reference_files',
      label: 'Reference Files',
      type: 'file_upload',
      required: false,
      description: 'Optional uploaded files used as context.',
    });
  }
  return defaults;
}

function createLiveRunInputDrafts(inputModules) {
  const modules = Array.isArray(inputModules) ? inputModules : [];
  const next = {};
  for (const module of modules) {
    const name = ensureString(module?.name, '').trim();
    if (!name) continue;
    const type = ensureString(module?.type, 'user_input');
    if (type === 'boolean') {
      next[name] = false;
    } else if (type === 'file_upload') {
      next[name] = [];
    } else {
      next[name] = '';
    }
  }
  return next;
}

function isWorkflowInputValueProvided(module, value) {
  const type = ensureString(module?.type, 'user_input');
  if (type === 'file_upload') {
    return Array.isArray(value) && value.length > 0;
  }
  if (type === 'boolean') {
    return typeof value === 'boolean';
  }
  if (type === 'number') {
    if (value == null) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.trim() !== '' && Number.isFinite(Number(value));
    return false;
  }
  if (type === 'json') {
    if (value == null) return false;
    if (typeof value !== 'string') return true;
    return value.trim() !== '';
  }
  if (typeof value === 'string') return value.trim() !== '';
  return value != null;
}

function listMissingRequiredInputs(inputModules, draftInputs) {
  const modules = Array.isArray(inputModules) ? inputModules : [];
  const drafts = draftInputs && typeof draftInputs === 'object' ? draftInputs : {};
  return modules.filter((module) => module?.required !== false && !isWorkflowInputValueProvided(module, drafts[module.name]));
}

function normalizeOutputSpecs(rawItems, task = '') {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const seen = new Set();
  const normalized = items
    .map((item, index) => {
      let name = slugifyClient(item?.name, index === 0 ? 'final_output' : `deliverable_${index + 1}`);
      if (seen.has(name)) {
        let suffix = 2;
        while (seen.has(`${name}_${suffix}`)) suffix += 1;
        name = `${name}_${suffix}`;
      }
      seen.add(name);

      const type = ensureString(item?.type, 'markdown').trim() || 'markdown';
      const allowedTypes = new Set(OUTPUT_TYPE_OPTIONS.map((option) => option.value));
      const safeType = allowedTypes.has(type) ? type : 'markdown';

      return {
        id: ensureString(item?.id, `outputspec_${index + 1}`) || `outputspec_${index + 1}`,
        name,
        label:
          ensureString(item?.label, '')
            .trim() ||
          name
            .split('_')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' '),
        type: safeType,
        description: ensureString(item?.description, '').trim(),
      };
    })
    .filter((item) => item.name);

  if (normalized.length > 0) return normalized;

  return [
    {
      id: 'outputspec_1',
      name: 'final_output',
      label: 'Final Output',
      type: 'markdown',
      description:
        task && typeof task === 'string'
          ? `Primary deliverable inferred from workflow prompt: ${truncate(task, 90)}`
          : 'Primary workflow output.',
    },
  ];
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
    .map((edge) => coerceWorkflowEdge(edge))
    .filter((edge) => edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target));

  const input_modules = normalizeInputModuleSpecs(plan?.inputs, task);
  const deliverable_specs = normalizeOutputSpecs(plan?.deliverables, task);

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
    input_modules,
    deliverable_specs,
    inputs: input_modules.map((item) => item.name),
    deliverables: deliverable_specs.map((item) => item.name),
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

function formatJsonPreview(value) {
  if (value == null) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isTerminalRunStatus(status) {
  return ['success', 'failed', 'cancelled'].includes(ensureString(status).toLowerCase());
}

function isActiveRunStatus(status) {
  return ['queued', 'running', 'awaiting_input'].includes(ensureString(status).toLowerCase());
}

function computeDurationMs(startedAt, finishedAt) {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return null;
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function normalizeWorkflowRun(run) {
  const rawNodeRuns = Array.isArray(run?.nodeRuns) ? run.nodeRuns : [];
  const nodeRuns = rawNodeRuns.map((nodeRun) => ({
    nodeId: ensureString(nodeRun?.nodeId, ''),
    name: ensureString(nodeRun?.name, ''),
    role: ensureString(nodeRun?.role, ''),
    objective: ensureString(nodeRun?.objective, ''),
    status: ensureString(nodeRun?.status, 'queued'),
    startedAt: ensureString(nodeRun?.startedAt, '') || null,
    finishedAt: ensureString(nodeRun?.finishedAt, '') || null,
    durationMs: Number.isFinite(nodeRun?.durationMs) ? nodeRun.durationMs : computeDurationMs(nodeRun?.startedAt, nodeRun?.finishedAt),
    logs: Array.isArray(nodeRun?.logs)
      ? nodeRun.logs.map((log) => ({
          id: ensureString(log?.id, generateId('log')),
          seq: Number.isFinite(log?.seq) ? log.seq : 0,
          timestamp: ensureString(log?.timestamp, ''),
          category: ensureString(log?.category, 'lifecycle'),
          title: ensureString(log?.title, ''),
          message: ensureString(log?.message, ''),
          nodeId: ensureString(log?.nodeId, '') || null,
          payload: log?.payload ?? null,
        }))
      : [],
    output: nodeRun?.output ?? null,
    outputSummary: ensureString(nodeRun?.outputSummary, ''),
    upstreamInputs: Array.isArray(nodeRun?.upstreamInputs) ? nodeRun.upstreamInputs : [],
  }));

  const logs = Array.isArray(run?.logs)
    ? run.logs.map((log) => ({
        id: ensureString(log?.id, generateId('log')),
        seq: Number.isFinite(log?.seq) ? log.seq : 0,
        timestamp: ensureString(log?.timestamp, ''),
        category: ensureString(log?.category, 'lifecycle'),
        title: ensureString(log?.title, ''),
        message: ensureString(log?.message, ''),
        nodeId: ensureString(log?.nodeId, '') || null,
        payload: log?.payload ?? null,
      }))
    : [];

  const lastThinkingByNodeId = {};
  for (const log of logs) {
    if (log.category === 'thinking' && log.nodeId) {
      lastThinkingByNodeId[log.nodeId] = log.message;
    }
  }

  const startedAt = ensureString(run?.startedAt, '') || ensureString(run?.createdAt, '') || null;
  const finishedAt = ensureString(run?.finishedAt, '') || null;
  const durationMs = Number.isFinite(run?.durationMs) ? run.durationMs : computeDurationMs(startedAt, finishedAt);
  const outputs = run?.outputs && typeof run.outputs === 'object' ? run.outputs : {};
  const outputSummary = ensureString(outputs?.summary, '') || ensureString(run?.error, '') || '';

  return {
    id: ensureString(run?.id, generateId('run')),
    workflowId: ensureString(run?.workflowId, ''),
    workflowName: ensureString(run?.workflowName, 'Workflow'),
    workflowPrompt: ensureString(run?.workflowPrompt, ''),
    workflowSummary: ensureString(run?.workflowSummary, ''),
    status: ensureString(run?.status, 'queued'),
    createdAt: ensureString(run?.createdAt, '') || null,
    startedAt,
    finishedAt,
    durationMs,
    activeNodeId: ensureString(run?.activeNodeId, '') || null,
    progress:
      run?.progress && typeof run.progress === 'object'
        ? {
            totalNodes: Number.isFinite(run.progress.totalNodes) ? run.progress.totalNodes : nodeRuns.length,
            completedNodes: Number.isFinite(run.progress.completedNodes) ? run.progress.completedNodes : 0,
            failedNodes: Number.isFinite(run.progress.failedNodes) ? run.progress.failedNodes : 0,
          }
        : { totalNodes: nodeRuns.length, completedNodes: 0, failedNodes: 0 },
    error: ensureString(run?.error, '') || null,
    inputs: run?.inputs && typeof run.inputs === 'object' ? run.inputs : {},
    outputs,
    deliverables: Array.isArray(run?.deliverables) ? run.deliverables : [],
    inputRequests: Array.isArray(run?.inputRequests) ? run.inputRequests : [],
    pendingInputRequest: run?.pendingInputRequest ?? null,
    requestedDeliverables: Array.isArray(run?.requestedDeliverables) ? run.requestedDeliverables : [],
    logs,
    nodeRuns,
    outputSummary: outputSummary || (isTerminalRunStatus(run?.status) ? 'Execution completed.' : 'Execution in progress.'),
    lastThinkingByNodeId,
    workflowSnapshot: run?.workflowSnapshot ?? null,
  };
}

function serializeWorkflowTemplateForRun(workflow) {
  return {
    id: ensureString(workflow?.id, ''),
    name: ensureString(workflow?.name, 'Workflow'),
    prompt: ensureString(workflow?.prompt, ''),
    summary: ensureString(workflow?.summary, ''),
    nodes: Array.isArray(workflow?.nodes)
      ? workflow.nodes.map((node) => ({
          id: ensureString(node?.id, ''),
          name: ensureString(node?.name, ensureString(node?.id, 'Agent')),
          role: ensureString(node?.role, ''),
          objective: ensureString(node?.objective, ''),
        }))
      : [],
    edges: Array.isArray(workflow?.edges)
      ? workflow.edges.map((edge) => {
          const normalized = coerceWorkflowEdge(edge);
          return {
            source: ensureString(normalized?.source, ''),
            target: ensureString(normalized?.target, ''),
            handoff: ensureString(normalized?.handoff, ''),
            handoffContract: normalized?.handoffContract
              ? {
                  packetType: ensureString(normalized.handoffContract.packetType, 'handoff_packet'),
                  fields: Array.isArray(normalized.handoffContract.fields)
                    ? normalized.handoffContract.fields
                        .map((field) => ({
                          targetKey: ensureString(field?.targetKey, '').trim(),
                          sourcePath: ensureString(field?.sourcePath, '').trim(),
                          type: ensureString(field?.type, 'any').trim() || 'any',
                          required: field?.required !== false,
                          description: ensureString(field?.description, '').trim(),
                        }))
                        .filter((field) => field.targetKey && field.sourcePath)
                    : createDefaultHandoffFieldMappings().map(({ id, ...field }) => field),
                }
              : undefined,
          };
        })
      : [],
  };
}

async function createWorkflowRunApi(payload) {
  const response = await apiFetch('/api/workflow-runs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to start workflow run'));
  }
  const data = await response.json();
  return normalizeWorkflowRun(data);
}

async function listWorkflowRunsApi(limit = 100) {
  const response = await apiFetch(`/api/workflow-runs?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load workflow runs'));
  }
  const data = await response.json();
  const runs = Array.isArray(data?.runs) ? data.runs : [];
  return runs.map(normalizeWorkflowRun);
}

async function getWorkflowRunApi(runId) {
  const response = await apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load workflow run'));
  }
  const data = await response.json();
  return normalizeWorkflowRun(data);
}

async function cancelWorkflowRunApi(runId) {
  const response = await apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to cancel workflow run'));
  }
  const data = await response.json();
  return normalizeWorkflowRun(data);
}

async function deleteWorkflowRunApi(runId) {
  const response = await apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to delete workflow run'));
  }
  const data = await response.json();
  return {
    deleted: Boolean(data?.deleted),
    run: data?.run ? normalizeWorkflowRun(data.run) : null,
  };
}

function buildDagLayout(nodes, edges, options = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return null;
  }

  const {
    positionOverrides = null,
    nodeWidth = 240,
    nodeHeight = 96,
    horizontalGap = 92,
    verticalGap = 32,
    paddingX = 28,
    paddingY = 28,
    minCanvasWidth = 0,
    minCanvasHeight = 0,
  } = options;

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

  const maxRows = Math.max(1, ...columns.map((column) => (column ? column.length : 0)));
  const baseWidth =
    paddingX * 2 + columns.length * nodeWidth + Math.max(0, columns.length - 1) * horizontalGap;
  const baseHeight =
    paddingY * 2 + maxRows * nodeHeight + Math.max(0, maxRows - 1) * verticalGap;

  const positions = new Map();
  columns.forEach((column, columnIndex) => {
    const columnHeight = column.length * nodeHeight + Math.max(0, column.length - 1) * verticalGap;
    const startY = paddingY + (baseHeight - paddingY * 2 - columnHeight) / 2;

    column.forEach((id, rowIndex) => {
      positions.set(id, {
        x: paddingX + columnIndex * (nodeWidth + horizontalGap),
        y: startY + rowIndex * (nodeHeight + verticalGap),
      });
    });
  });

  if (positionOverrides && typeof positionOverrides === 'object') {
    nodeList.forEach((node) => {
      const override = positionOverrides[node.id];
      if (!override || typeof override !== 'object') return;
      const x = Number(override.x);
      const y = Number(override.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      positions.set(node.id, {
        x: Math.max(12, Math.round(x)),
        y: Math.max(12, Math.round(y)),
      });
    });
  }

  let width = Math.max(baseWidth, minCanvasWidth);
  let height = Math.max(baseHeight, minCanvasHeight);
  positions.forEach((position) => {
    width = Math.max(width, position.x + nodeWidth + paddingX);
    height = Math.max(height, position.y + nodeHeight + paddingY);
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

function normalizeNodePositionsMap(value) {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  for (const [nodeId, position] of Object.entries(value)) {
    if (!position || typeof position !== 'object') continue;
    const x = Number(position.x);
    const y = Number(position.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    result[nodeId] = {
      x: Math.max(12, Math.round(x)),
      y: Math.max(12, Math.round(y)),
    };
  }
  return result;
}

function buildAutoNodePositions(nodes, edges, layoutOptions = INTERACTIVE_GRAPH_LAYOUT) {
  const layout = buildDagLayout(nodes, edges, layoutOptions);
  if (!layout) return {};
  const positions = {};
  layout.positions.forEach((position, nodeId) => {
    positions[nodeId] = {
      x: Math.round(position.x),
      y: Math.round(position.y),
    };
  });
  return positions;
}

function WorkflowDag({
  plan,
  nodePositions,
  selectedNodeId = null,
  selectedEdgeIndex = null,
  onNodeSelect,
  onEdgeSelect,
  onNodePositionChange,
  onCanvasSelect,
  onAddEdge,
  onUpdateEdge,
  onDeleteEdge,
  layoutOptions,
  interactive = false,
  className = '',
  svgClassName = '',
  emptyMessage = 'Create or select a workflow to view the DAG.',
}) {
  const uid = useId().replace(/[:]/g, '');
  const markerId = `dag-arrow-${uid}`;
  const gridId = `dag-grid-${uid}`;
  const svgRef = useRef(null);
  const interactionRef = useRef(null);
  const draftPositionsRef = useRef({});
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const [draftPositions, setDraftPositions] = useState({});
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [connectionPreview, setConnectionPreview] = useState(null);

  useEffect(() => {
    draftPositionsRef.current = {};
    setDraftPositions({});
    setConnectionPreview(null);
    setViewport({ x: 0, y: 0, scale: 1 });
    viewportRef.current = { x: 0, y: 0, scale: 1 };
  }, [plan?.id, Array.isArray(plan?.nodes) ? plan.nodes.length : 0]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(
    () => () => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      window.removeEventListener('pointermove', interaction.onMove);
      window.removeEventListener('pointerup', interaction.onUp);
      window.removeEventListener('pointercancel', interaction.onUp);
      interactionRef.current = null;
    },
    []
  );

  if (!plan || !Array.isArray(plan.nodes) || plan.nodes.length === 0) {
    return (
      <div className="dag-empty" role="status" aria-live="polite">
        {emptyMessage}
      </div>
    );
  }

  const mergedPositions =
    nodePositions || Object.keys(draftPositions).length
      ? {
          ...(nodePositions && typeof nodePositions === 'object' ? nodePositions : {}),
          ...draftPositions,
        }
      : null;

  const layout = buildDagLayout(plan.nodes, plan.edges || [], {
    ...(layoutOptions || {}),
    positionOverrides: mergedPositions,
  });
  if (!layout) {
    return <div className="dag-empty">Unable to render DAG.</div>;
  }

  const setViewportSafe = (updater) => {
    setViewport((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const scale = Math.min(3.2, Math.max(0.45, Number(next?.scale) || 1));
      const normalized = {
        x: Math.round(Number(next?.x) || 0),
        y: Math.round(Number(next?.y) || 0),
        scale,
      };
      viewportRef.current = normalized;
      return normalized;
    });
  };

  const getSvgPoint = (event) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const viewBox = svg.viewBox.baseVal;
    const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const renderedWidth = viewBox.width * scale;
    const renderedHeight = viewBox.height * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    const x = (event.clientX - rect.left - offsetX) / scale + viewBox.x;
    const y = (event.clientY - rect.top - offsetY) / scale + viewBox.y;
    return { x, y };
  };

  const toGraphPoint = (svgPoint, activeViewport = viewportRef.current) => {
    if (!svgPoint) return null;
    return {
      x: (svgPoint.x - activeViewport.x) / activeViewport.scale,
      y: (svgPoint.y - activeViewport.y) / activeViewport.scale,
    };
  };

  const getGraphPoint = (event) => toGraphPoint(getSvgPoint(event));

  const stopInteraction = () => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    window.removeEventListener('pointermove', interaction.onMove);
    window.removeEventListener('pointerup', interaction.onUp);
    window.removeEventListener('pointercancel', interaction.onUp);
    interactionRef.current = null;
  };

  const beginInteraction = (handlers) => {
    stopInteraction();
    interactionRef.current = handlers;
    window.addEventListener('pointermove', handlers.onMove);
    window.addEventListener('pointerup', handlers.onUp);
    window.addEventListener('pointercancel', handlers.onUp);
  };

  const findNodeAtPoint = (point, { excludeId } = {}) => {
    if (!point) return null;
    const nodesInHitOrder = [...plan.nodes].reverse();
    for (const node of nodesInHitOrder) {
      if (excludeId && node.id === excludeId) continue;
      const position = layout.positions.get(node.id);
      if (!position) continue;
      if (
        point.x >= position.x &&
        point.x <= position.x + layout.nodeWidth &&
        point.y >= position.y &&
        point.y <= position.y + layout.nodeHeight
      ) {
        return node;
      }
    }
    return null;
  };

  const setDraftNodePosition = (nodeId, position) => {
    setDraftPositions((prev) => ({
      ...prev,
      [nodeId]: position,
    }));
    draftPositionsRef.current = {
      ...draftPositionsRef.current,
      [nodeId]: position,
    };
  };

  const clearDraftNodePosition = (nodeId) => {
    setDraftPositions((prev) => {
      if (!(nodeId in prev)) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
    if (nodeId in draftPositionsRef.current) {
      const nextDraft = { ...draftPositionsRef.current };
      delete nextDraft[nodeId];
      draftPositionsRef.current = nextDraft;
    }
  };

  const startNodeDragging = (event, nodeId) => {
    if (!interactive || typeof onNodePositionChange !== 'function') return;
    if (event.button !== 0) return;
    const point = getGraphPoint(event);
    const currentPosition = layout.positions.get(nodeId);
    if (!point || !currentPosition) return;

    event.preventDefault();
    event.stopPropagation();
    onNodeSelect?.(nodeId);

    const offsetX = point.x - currentPosition.x;
    const offsetY = point.y - currentPosition.y;

    const onMove = (moveEvent) => {
      const nextPoint = getSvgPoint(moveEvent);
      const nextGraphPoint = toGraphPoint(nextPoint);
      if (!nextGraphPoint) return;
      const x = Math.max(12, nextGraphPoint.x - offsetX);
      const y = Math.max(12, nextGraphPoint.y - offsetY);
      setDraftNodePosition(nodeId, { x, y });
    };

    const onUp = () => {
      const finalPosition = draftPositionsRef.current[nodeId] || layout.positions.get(nodeId);
      if (finalPosition) {
        onNodePositionChange(nodeId, {
          x: Math.max(12, Math.round(finalPosition.x)),
          y: Math.max(12, Math.round(finalPosition.y)),
        });
      }
      clearDraftNodePosition(nodeId);
      stopInteraction();
    };

    beginInteraction({ type: 'node-drag', onMove, onUp });
  };

  const startPan = (event) => {
    if (!interactive) return;
    if (event.button !== 0) return;
    const startPoint = getSvgPoint(event);
    if (!startPoint) return;

    event.preventDefault();
    const initialViewport = viewportRef.current;
    onCanvasSelect?.();

    const onMove = (moveEvent) => {
      const nextPoint = getSvgPoint(moveEvent);
      if (!nextPoint) return;
      setViewportSafe({
        x: initialViewport.x + (nextPoint.x - startPoint.x),
        y: initialViewport.y + (nextPoint.y - startPoint.y),
        scale: initialViewport.scale,
      });
    };

    const onUp = () => {
      stopInteraction();
    };

    beginInteraction({ type: 'pan', onMove, onUp });
  };

  const startConnectionDrag = (event, sourceId) => {
    if (!interactive || typeof onAddEdge !== 'function') return;
    if (event.button !== 0) return;
    const point = getGraphPoint(event);
    const sourcePosition = layout.positions.get(sourceId);
    if (!point || !sourcePosition) return;

    event.preventDefault();
    event.stopPropagation();
    onNodeSelect?.(sourceId);

    const fromX = sourcePosition.x + layout.nodeWidth;
    const fromY = sourcePosition.y + layout.nodeHeight / 2;
    setConnectionPreview({
      kind: 'new',
      edgeIndex: null,
      sourceId,
      fromX,
      fromY,
      toX: point.x,
      toY: point.y,
      targetCandidateId: null,
    });

    const onMove = (moveEvent) => {
      const nextPoint = getGraphPoint(moveEvent);
      if (!nextPoint) return;
      const candidate = findNodeAtPoint(nextPoint, { excludeId: sourceId });
      setConnectionPreview((prev) =>
        prev && prev.kind === 'new'
          ? {
              ...prev,
              toX: nextPoint.x,
              toY: nextPoint.y,
              targetCandidateId: candidate?.id || null,
            }
          : prev
      );
    };

    const onUp = (upEvent) => {
      const nextPoint = getGraphPoint(upEvent);
      if (nextPoint) {
        const targetNode = findNodeAtPoint(nextPoint, { excludeId: sourceId });
        if (targetNode) {
          onAddEdge({ source: sourceId, target: targetNode.id, handoff: '' });
          onEdgeSelect?.(null);
          onNodeSelect?.(targetNode.id);
        }
      }
      setConnectionPreview(null);
      stopInteraction();
    };

    beginInteraction({ type: 'connect', onMove, onUp });
  };

  const startEdgeTargetDrag = (event, edgeIndex, edge) => {
    if (!interactive || (!onUpdateEdge && !onDeleteEdge)) return;
    if (event.button !== 0) return;
    const sourcePosition = layout.positions.get(edge.source);
    const targetPosition = layout.positions.get(edge.target);
    if (!sourcePosition || !targetPosition) return;

    event.preventDefault();
    event.stopPropagation();

    const fromX = sourcePosition.x + layout.nodeWidth;
    const fromY = sourcePosition.y + layout.nodeHeight / 2;
    const initialToX = targetPosition.x;
    const initialToY = targetPosition.y + layout.nodeHeight / 2;

    setConnectionPreview({
      kind: 'rewire',
      edgeIndex,
      sourceId: edge.source,
      fromX,
      fromY,
      toX: initialToX,
      toY: initialToY,
      targetCandidateId: edge.target,
    });

    const onMove = (moveEvent) => {
      const nextPoint = getGraphPoint(moveEvent);
      if (!nextPoint) return;
      const candidate = findNodeAtPoint(nextPoint, { excludeId: edge.source });
      setConnectionPreview((prev) =>
        prev && prev.kind === 'rewire'
          ? {
              ...prev,
              toX: nextPoint.x,
              toY: nextPoint.y,
              targetCandidateId: candidate?.id || null,
            }
          : prev
      );
    };

    const onUp = (upEvent) => {
      const nextPoint = getGraphPoint(upEvent);
      const targetNode = nextPoint ? findNodeAtPoint(nextPoint, { excludeId: edge.source }) : null;

      if (targetNode && typeof onUpdateEdge === 'function') {
        onUpdateEdge(edgeIndex, { target: targetNode.id });
        onEdgeSelect?.(null);
        onNodeSelect?.(targetNode.id);
      } else if (!targetNode && typeof onDeleteEdge === 'function') {
        onDeleteEdge(edgeIndex);
      }

      setConnectionPreview(null);
      stopInteraction();
    };

    beginInteraction({ type: 'edge-rewire', onMove, onUp });
  };

  const handleSvgPointerDown = (event) => {
    if (!interactive) return;
    if (event.target === event.currentTarget) {
      startPan(event);
    }
  };

  const handleWheel = (event) => {
    if (!interactive) return;
    event.preventDefault();

    const svgPoint = getSvgPoint(event);
    if (!svgPoint) return;

    const current = viewportRef.current;
    const worldPoint = toGraphPoint(svgPoint, current);
    if (!worldPoint) return;

    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const nextScale = Math.min(3.2, Math.max(0.45, current.scale * zoomFactor));
    setViewportSafe({
      scale: nextScale,
      x: svgPoint.x - worldPoint.x * nextScale,
      y: svgPoint.y - worldPoint.y * nextScale,
    });
  };

  const handleDoubleClick = (event) => {
    if (!interactive) return;
    if (event.target !== event.currentTarget) return;
    setViewportSafe({ x: 0, y: 0, scale: 1 });
  };

  const renderEdgePath = (sx, sy, tx, ty) => {
    const dx = Math.max(42, Math.abs(tx - sx) * 0.45);
    return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
  };

  const viewportTransform = interactive
    ? `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`
    : undefined;

  const activeTargetHighlightId = connectionPreview?.targetCandidateId || null;

  const renderConnectionPreview = () => {
    if (!interactive || !connectionPreview) return null;
    const { fromX, fromY, toX, toY, kind } = connectionPreview;
    const path = renderEdgePath(fromX, fromY, toX, toY);
    return (
      <g className="dag-connection-preview" pointerEvents="none">
        <path
          d={path}
          fill="none"
          stroke={kind === 'rewire' ? 'rgba(255, 208, 146, 0.92)' : 'rgba(125, 176, 246, 0.92)'}
          strokeWidth="2.5"
          strokeDasharray="8 6"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={toX}
          cy={toY}
          r="7"
          fill={kind === 'rewire' ? 'rgba(255, 208, 146, 0.18)' : 'rgba(125, 176, 246, 0.18)'}
          stroke={kind === 'rewire' ? 'rgba(255, 208, 146, 0.9)' : 'rgba(125, 176, 246, 0.9)'}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  };

  const showEdgeHandlesForIndex = (edgeIndex, edge) => {
    if (!interactive) return false;
    if (selectedEdgeIndex === edgeIndex) return true;
    if (!selectedNodeId) return true;
    if (connectionPreview?.kind === 'rewire' && connectionPreview.edgeIndex === edgeIndex) return true;
    return edge.source === selectedNodeId || edge.target === selectedNodeId;
  };

  const hasInteractiveConnectionControls =
    interactive && (typeof onAddEdge === 'function' || typeof onUpdateEdge === 'function' || typeof onDeleteEdge === 'function');

  const zoomLabel = `${Math.round(viewport.scale * 100)}%`;

  const renderNodeHandles = (node, isSelected) => {
    if (!hasInteractiveConnectionControls) return null;
    const cy = layout.nodeHeight / 2;
    return (
      <>
        <circle
          cx="0"
          cy={cy}
          r="6"
          className={`dag-node-handle input ${isSelected ? 'active' : ''}`}
          fill={isSelected ? 'rgba(223, 232, 245, 0.18)' : 'rgba(223, 232, 245, 0.06)'}
          stroke={isSelected ? 'rgba(223, 232, 245, 0.72)' : 'rgba(223, 232, 245, 0.32)'}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        <circle
          cx={layout.nodeWidth}
          cy={cy}
          r="6"
          className={`dag-node-handle output ${isSelected ? 'active' : ''}`}
          fill={isSelected ? 'rgba(125, 176, 246, 0.2)' : 'rgba(125, 176, 246, 0.06)'}
          stroke={isSelected ? 'rgba(125, 176, 246, 0.78)' : 'rgba(125, 176, 246, 0.38)'}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        <circle
          cx={layout.nodeWidth}
          cy={cy}
          r="13"
          fill="transparent"
          className="dag-node-handle-hit"
          onPointerDown={(event) => startConnectionDrag(event, node.id)}
        />
      </>
    );
  };

  const graphLayerChildren = (
    <>
      {interactive ? (
        <>
          <rect x="-2400" y="-2400" width="7200" height="7200" fill="rgba(4, 6, 10, 0.35)" pointerEvents="none" />
          <rect x="0" y="0" width={layout.width} height={layout.height} fill={`url(#${gridId})`} pointerEvents="none" />
          <rect
            x="0"
            y="0"
            width={layout.width}
            height={layout.height}
            fill={`url(#${gridId})`}
            opacity="0.35"
            transform="translate(16 16)"
            pointerEvents="none"
          />
        </>
      ) : null}

      {layout.edges.map((edge, index) => {
        const from = layout.positions.get(edge.source);
        const to = layout.positions.get(edge.target);
        if (!from || !to) return null;
        const edgeConnected =
          selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);
        const edgeSelected = selectedEdgeIndex === index;

        const sx = from.x + layout.nodeWidth;
        const sy = from.y + layout.nodeHeight / 2;
        const tx = to.x;
        const ty = to.y + layout.nodeHeight / 2;
        const path = renderEdgePath(sx, sy, tx, ty);
        const labelX = (sx + tx) / 2;
        const labelY = (sy + ty) / 2;
        const showHandle = showEdgeHandlesForIndex(index, edge);
        const handleActive = connectionPreview?.kind === 'rewire' && connectionPreview.edgeIndex === index;
        const edgeLabel =
          ensureString(edge?.handoff, '').trim() ||
          ensureString(edge?.handoffContract?.packetType, '').trim() ||
          '';

        return (
          <g key={`${edge.source}-${edge.target}-${index}`}>
            {interactive ? (
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth="16"
                className={`dag-edge-hit ${edgeSelected ? 'active' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onEdgeSelect?.(edgeSelected ? null : index);
                }}
              />
            ) : null}
            <path
              d={path}
              fill="none"
              stroke={
                edgeSelected
                  ? 'rgba(125, 176, 246, 0.98)'
                  : edgeConnected
                    ? 'rgba(223, 232, 245, 0.92)'
                    : 'rgba(223, 232, 245, 0.55)'
              }
              strokeWidth={edgeSelected ? '3' : edgeConnected ? '2.7' : '2'}
              opacity={selectedNodeId && !edgeConnected && !edgeSelected ? 0.34 : 1}
              markerEnd={`url(#${markerId})`}
              pointerEvents="none"
              vectorEffect="non-scaling-stroke"
            />
            {edgeLabel ? (
              <text
                x={labelX}
                y={labelY - 6}
                textAnchor="middle"
                fill="rgba(168, 176, 190, 0.9)"
                fontSize="11"
                fontFamily="IBM Plex Mono, monospace"
                pointerEvents="none"
              >
                {truncate(edgeLabel, 18)}
              </text>
            ) : null}
            {showHandle ? (
              <g>
                <circle
                  cx={tx}
                  cy={ty}
                  r="7"
                  fill={
                    handleActive
                      ? 'rgba(255, 208, 146, 0.2)'
                      : edgeSelected
                        ? 'rgba(125, 176, 246, 0.16)'
                        : 'rgba(223, 232, 245, 0.08)'
                  }
                  stroke={
                    handleActive
                      ? 'rgba(255, 208, 146, 0.86)'
                      : edgeSelected
                        ? 'rgba(125, 176, 246, 0.78)'
                        : 'rgba(223, 232, 245, 0.45)'
                  }
                  strokeWidth="1.8"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
                <circle
                  cx={tx}
                  cy={ty}
                  r="13"
                  fill="transparent"
                  className="dag-edge-handle-hit"
                  onPointerDown={(event) => startEdgeTargetDrag(event, index, edge)}
                />
              </g>
            ) : null}
          </g>
        );
      })}

      {renderConnectionPreview()}

      {plan.nodes.map((node) => {
        const position = layout.positions.get(node.id);
        if (!position) return null;
        const title = truncate(node.name, 26);
        const role = truncate(node.role, 34);
        const isSelected = selectedNodeId === node.id;
        const isConnectionTarget = activeTargetHighlightId === node.id;

        return (
          <g
            key={node.id}
            transform={`translate(${position.x} ${position.y})`}
            className={[
              'dag-node',
              interactive ? 'interactive' : '',
              isSelected ? 'selected' : '',
              isConnectionTarget ? 'candidate' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={(event) => {
              event.stopPropagation();
              onEdgeSelect?.(null);
              onNodeSelect?.(node.id);
            }}
            onPointerDown={(event) => startNodeDragging(event, node.id)}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `Agent node ${node.name}` : undefined}
          >
            <rect
              width={layout.nodeWidth}
              height={layout.nodeHeight}
              rx="11"
              fill={
                isConnectionTarget
                  ? 'rgba(22, 35, 52, 0.96)'
                  : isSelected
                    ? 'rgba(18, 26, 38, 0.96)'
                    : 'rgba(12, 16, 23, 0.92)'
              }
              stroke={
                isConnectionTarget
                  ? 'rgba(125, 176, 246, 0.5)'
                  : isSelected
                    ? 'rgba(223, 232, 245, 0.38)'
                    : 'rgba(255, 255, 255, 0.12)'
              }
              strokeWidth={isSelected || isConnectionTarget ? '2' : '1'}
            />
            <rect
              x="0.5"
              y="0.5"
              width={layout.nodeWidth - 1}
              height={layout.nodeHeight - 1}
              rx="10.5"
              fill="none"
              stroke={
                isConnectionTarget
                  ? 'rgba(125, 176, 246, 0.18)'
                  : isSelected
                    ? 'rgba(223, 232, 245, 0.16)'
                    : 'rgba(223, 232, 245, 0.06)'
              }
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
              y={layout.nodeHeight - 22}
              fill="rgba(219, 228, 239, 0.78)"
              fontSize="10"
              fontFamily="IBM Plex Mono, monospace"
            >
              {truncate(node.id, 32)}
            </text>
            {renderNodeHandles(node, isSelected)}
          </g>
        );
      })}
    </>
  );

  const shellClasses = ['dag-shell', interactive ? 'interactive' : '', className].filter(Boolean).join(' ');

  const svgClasses = ['dag-svg', interactive ? 'interactive' : '', svgClassName].filter(Boolean).join(' ');

  const shellTitle =
    interactive && hasInteractiveConnectionControls
      ? `Scroll to zoom, drag empty space to pan, drag node handles to connect, drag edge endpoints to rewire/delete. Zoom ${zoomLabel}`
      : undefined;

  return (
    <div className={shellClasses} title={shellTitle}>
      <svg
        ref={svgRef}
        className={svgClasses}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="Workflow directed acyclic graph"
        preserveAspectRatio={interactive ? 'xMidYMid meet' : 'xMinYMin meet'}
        onPointerDown={handleSvgPointerDown}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          {interactive ? (
            <pattern id={gridId} width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
            </pattern>
          ) : null}
          <marker
            id={markerId}
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

        {interactive ? <g transform={viewportTransform}>{graphLayerChildren}</g> : graphLayerChildren}
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

function RunsList({ runs, onSelectWorkflow, onSelectRun, onDeleteRun, compact = false }) {
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

          {((run.workflowId && onSelectWorkflow) || onSelectRun) ? (
            <div className="run-card-actions">
              {onSelectRun ? (
                <button
                  type="button"
                  className="button ghost button-compact"
                  onClick={() => onSelectRun(run.id)}
                >
                  Open Run
                </button>
              ) : null}
              {onDeleteRun ? (
                <button
                  type="button"
                  className="button danger button-compact"
                  onClick={() => onDeleteRun(run.id)}
                  disabled={isActiveRunStatus(run.status)}
                  title={isActiveRunStatus(run.status) ? 'Cancel the run before deleting it' : 'Delete run'}
                >
                  Delete
                </button>
              ) : null}
              {run.workflowId && onSelectWorkflow ? (
                <button
                  type="button"
                  className="button ghost button-compact"
                  onClick={() => onSelectWorkflow(run.workflowId)}
                >
                  Open Template
                </button>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function RunWorkflowModal({ open, workflow, onClose, onSubmit, loading, error }) {
  const [goal, setGoal] = useState('');
  const [requestText, setRequestText] = useState('');
  const [notes, setNotes] = useState('');
  const [deliverablesText, setDeliverablesText] = useState('');

  useEffect(() => {
    if (!open) return;
    setGoal(workflow?.name ? `Run ${workflow.name}` : '');
    setRequestText(workflow?.prompt || '');
    setNotes('');
    setDeliverablesText('');
  }, [open, workflow?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onClose]);

  if (!open || !workflow) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const requestedDeliverables = deliverablesText
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    await onSubmit({
      inputs: {
        goal: goal.trim(),
        request: requestText.trim(),
        notes: notes.trim(),
      },
      requestedDeliverables,
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => (loading ? null : onClose())}>
      <section
        className="modal-shell run-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-workflow-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="chip">run workflow</div>
            <h2 id="run-workflow-title">Start Workflow Run</h2>
            <p className="subtitle">Provide user inputs and requested deliverables for this workflow execution.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={loading} aria-label="Close run dialog">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="panel-surface run-modal-template-summary">
            <div className="section-head">
              <h2>{workflow.name}</h2>
              <span className="chip subtle-chip">{workflow.nodes?.length || 0} agents</span>
            </div>
            <p className="surface-copy">{truncate(workflow.summary || workflow.prompt, 280)}</p>
          </div>

          <form className="page-stack" onSubmit={handleSubmit}>
            <label className="field-group">
              <span>Goal</span>
              <input
                type="text"
                className="input"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="What should this run accomplish?"
                disabled={loading}
              />
            </label>

            <label className="field-group">
              <span>Run Input / Request</span>
              <textarea
                className="textarea"
                rows={4}
                value={requestText}
                onChange={(event) => setRequestText(event.target.value)}
                placeholder="Provide the task-specific request or context for this run."
                disabled={loading}
              />
            </label>

            <label className="field-group">
              <span>Additional Notes (optional)</span>
              <textarea
                className="textarea textarea-compact"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Constraints, assumptions, deadlines, output format preferences..."
                disabled={loading}
              />
            </label>

            <label className="field-group">
              <span>Requested Deliverables (comma-separated)</span>
              <input
                type="text"
                className="input"
                value={deliverablesText}
                onChange={(event) => setDeliverablesText(event.target.value)}
                placeholder="e.g. plan.md, risks.txt, checklist.csv"
                disabled={loading}
              />
            </label>

            <div className="modal-actions">
              <p className={error ? 'error' : 'hint'} role={error ? 'alert' : 'status'}>
                {error || 'Runs are executed on the backend and stream status/logs through polling.'}
              </p>
              <div className="inline-actions">
                <button type="button" className="button ghost" onClick={onClose} disabled={loading}>
                  Cancel
                </button>
                <button type="submit" className="button" disabled={loading}>
                  {loading ? 'Starting…' : 'Start Run'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

function RunLogFeed({ logs, selectedNodeId = '' }) {
  const [categoryFilter, setCategoryFilter] = useState('all');

  const filteredLogs = (Array.isArray(logs) ? logs : []).filter((log) => {
    if (categoryFilter !== 'all' && log.category !== categoryFilter) return false;
    if (selectedNodeId && log.nodeId !== selectedNodeId) return false;
    return true;
  });

  return (
    <section className="panel-surface">
      <div className="section-head">
        <h2>Logs</h2>
        <div className="inline-actions">
          <span className="chip subtle-chip">{filteredLogs.length}</span>
          <select className="select run-log-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="input">Inputs</option>
            <option value="handoff">Handoffs</option>
            <option value="thinking">Thinking</option>
            <option value="output">Outputs</option>
            <option value="lifecycle">Lifecycle</option>
            <option value="control">Control</option>
            <option value="error">Errors</option>
          </select>
        </div>
      </div>

      {filteredLogs.length === 0 ? (
        <EmptyState title="No logs" body="Logs will appear as the backend executor processes agents and handoffs." />
      ) : (
        <div className="run-log-list" role="log" aria-live="polite">
          {filteredLogs
            .slice()
            .sort((a, b) => (a.seq || 0) - (b.seq || 0))
            .map((log) => (
              <article key={log.id} className={`run-log-item category-${log.category}`}>
                <div className="run-log-head">
                  <div className="run-log-meta">
                    <span className={`log-category-badge ${log.category}`}>{log.category}</span>
                    {log.nodeId ? <code>{log.nodeId}</code> : null}
                    <span>{formatLongDateTime(log.timestamp)}</span>
                  </div>
                  <span className="chip subtle-chip">#{log.seq || 0}</span>
                </div>
                <p className="run-log-title">{log.title || 'Log event'}</p>
                <p className="run-log-message">{log.message || '—'}</p>
                {log.payload != null ? <pre className="code-block run-log-payload">{formatJsonPreview(log.payload)}</pre> : null}
              </article>
            ))}
        </div>
      )}
    </section>
  );
}

function WorkflowRunDetailPanel({ run, onCancelRun, onDeleteRun, onRefreshRun, onOpenTemplate }) {
  const [selectedNodeId, setSelectedNodeId] = useState('');

  useEffect(() => {
    if (!run) {
      setSelectedNodeId('');
      return;
    }
    const nodeRuns = Array.isArray(run.nodeRuns) ? run.nodeRuns : [];
    const activeNodeId = run.activeNodeId || '';
    const runningNode = nodeRuns.find((nodeRun) => nodeRun.status === 'running')?.nodeId || '';
    const firstNode = nodeRuns[0]?.nodeId || '';
    const nextSelected = [activeNodeId, runningNode, selectedNodeId, firstNode].find(
      (candidate) => candidate && nodeRuns.some((nodeRun) => nodeRun.nodeId === candidate)
    );
    if ((nextSelected || '') !== selectedNodeId) {
      setSelectedNodeId(nextSelected || '');
    }
  }, [run?.id, run?.activeNodeId, run?.status, run?.nodeRuns, selectedNodeId]);

  if (!run) {
    return (
      <section className="panel-surface">
        <EmptyState title="Select a workflow run" body="Choose a run to inspect live agent status, inputs, handoffs, thinking traces, and outputs." />
      </section>
    );
  }

  const nodeRuns = Array.isArray(run.nodeRuns) ? run.nodeRuns : [];
  const selectedNode = nodeRuns.find((nodeRun) => nodeRun.nodeId === selectedNodeId) || nodeRuns[0] || null;
  const canCancel = isActiveRunStatus(run.status);
  const canDelete = !isActiveRunStatus(run.status);
  const thinkingLog = selectedNode
    ? [...(selectedNode.logs || [])].reverse().find((log) => log.category === 'thinking') || null
    : null;

  return (
    <div className="page-stack workflow-run-detail">
      <section className="panel-surface">
        <div className="detail-header run-detail-header">
          <div>
            <div className="chip subtle-chip">workflow run</div>
            <h2 className="detail-title">{run.workflowName}</h2>
            <p className="detail-copy">{truncate(run.outputSummary || run.workflowSummary || run.workflowPrompt, 260)}</p>
            <p className="detail-meta">
              Run ID {run.id} • Started {formatLongDateTime(run.startedAt || run.createdAt)} • {formatDuration(run.durationMs)}
              {run.activeNodeId ? ` • Active agent ${run.activeNodeId}` : ''}
            </p>
          </div>
          <div className="detail-actions">
            <StatusPill status={run.status} />
            {onOpenTemplate && run.workflowId ? (
              <button type="button" className="button ghost button-compact" onClick={() => onOpenTemplate(run.workflowId)}>
                Open Template
              </button>
            ) : null}
            <button type="button" className="button ghost button-compact" onClick={() => onRefreshRun?.(run.id)}>
              Refresh
            </button>
            {canCancel ? (
              <button type="button" className="button danger button-compact" onClick={() => onCancelRun?.(run.id)}>
                Cancel
              </button>
            ) : null}
            {canDelete ? (
              <button type="button" className="button danger button-compact" onClick={() => onDeleteRun?.(run.id)}>
                Delete
              </button>
            ) : null}
          </div>
        </div>

        <div className="kv-grid">
          <div className="kv-card">
            <span>Status</span>
            <strong>{run.status}</strong>
          </div>
          <div className="kv-card">
            <span>Progress</span>
            <strong>
              {run.progress?.completedNodes || 0}/{run.progress?.totalNodes || nodeRuns.length}
            </strong>
          </div>
          <div className="kv-card">
            <span>Logs</span>
            <strong>{run.logs?.length || 0}</strong>
          </div>
          <div className="kv-card">
            <span>Deliverables</span>
            <strong>{run.deliverables?.length || 0}</strong>
          </div>
        </div>

        {run.error ? (
          <div className="workflow-warning" role="alert">
            {run.error}
          </div>
        ) : null}
      </section>

      <div className="run-detail-grid">
        <section className="panel-surface">
          <div className="section-head">
            <h2>Agents</h2>
            <span className="chip subtle-chip">{nodeRuns.length}</span>
          </div>
          <div className="run-agent-list">
            {nodeRuns.map((nodeRun) => (
              <button
                key={`${run.id}-${nodeRun.nodeId}`}
                type="button"
                className={`run-agent-row ${selectedNodeId === nodeRun.nodeId ? 'selected' : ''} ${nodeRun.status}`}
                onClick={() => setSelectedNodeId(nodeRun.nodeId)}
              >
                <div>
                  <p className="run-agent-title">{nodeRun.name || nodeRun.nodeId}</p>
                  <p className="run-agent-meta">
                    {nodeRun.nodeId} • {formatDuration(nodeRun.durationMs)}
                  </p>
                  {run.lastThinkingByNodeId?.[nodeRun.nodeId] ? (
                    <p className="run-agent-thinking-preview">{truncate(run.lastThinkingByNodeId[nodeRun.nodeId], 110)}</p>
                  ) : null}
                </div>
                <StatusPill status={nodeRun.status} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel-surface">
          <div className="section-head">
            <h2>{selectedNode ? selectedNode.name || selectedNode.nodeId : 'Agent Detail'}</h2>
            {selectedNode ? <StatusPill status={selectedNode.status} /> : null}
          </div>

          {!selectedNode ? (
            <EmptyState title="No agent selected" body="Select an agent run to inspect inputs, thinking traces, handoffs, and outputs." />
          ) : (
            <div className="page-stack">
              <div className="kv-grid">
                <div className="kv-card">
                  <span>Role</span>
                  <strong>{selectedNode.role || '—'}</strong>
                </div>
                <div className="kv-card">
                  <span>Started</span>
                  <strong>{formatDateTime(selectedNode.startedAt)}</strong>
                </div>
                <div className="kv-card">
                  <span>Finished</span>
                  <strong>{formatDateTime(selectedNode.finishedAt)}</strong>
                </div>
                <div className="kv-card">
                  <span>Node Logs</span>
                  <strong>{selectedNode.logs?.length || 0}</strong>
                </div>
              </div>

              <section className="panel-surface nested-panel">
                <div className="section-head">
                  <h2>Inputs</h2>
                </div>
                <pre className="code-block">{formatJsonPreview(selectedNode.upstreamInputs || [])}</pre>
              </section>

              <section className="panel-surface nested-panel">
                <div className="section-head">
                  <h2>Thinking</h2>
                  <span className="chip subtle-chip">visible trace</span>
                </div>
                {thinkingLog ? (
                  <div className="stack-list">
                    {selectedNode.logs
                      .filter((log) => log.category === 'thinking')
                      .map((log) => (
                        <div key={log.id} className="workflow-warning neutral-log-note">
                          {log.message}
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="surface-copy">No visible reasoning trace recorded yet.</p>
                )}
              </section>

              <section className="panel-surface nested-panel">
                <div className="section-head">
                  <h2>Output</h2>
                </div>
                <pre className="code-block">{formatJsonPreview(selectedNode.output || {})}</pre>
              </section>
            </div>
          )}
        </section>
      </div>

      <div className="run-detail-grid lower">
        <section className="panel-surface">
          <div className="section-head">
            <h2>Run Inputs</h2>
          </div>
          <pre className="code-block">{formatJsonPreview(run.inputs || {})}</pre>
        </section>

        <section className="panel-surface">
          <div className="section-head">
            <h2>Outputs & Deliverables</h2>
          </div>
          <pre className="code-block">{formatJsonPreview(run.outputs || {})}</pre>
          {Array.isArray(run.deliverables) && run.deliverables.length > 0 ? (
            <div className="deliverable-list">
              {run.deliverables.map((deliverable) => (
                <article key={deliverable.id || deliverable.name} className="deliverable-card">
                  <div className="deliverable-head">
                    <strong>{deliverable.name || 'deliverable'}</strong>
                    <StatusPill status={deliverable.status || 'final'} />
                  </div>
                  <p className="surface-copy">
                    {(deliverable.type || 'artifact')} • {deliverable.mimeType || 'unknown mime'}
                    {deliverable.producerNodeId ? ` • ${deliverable.producerNodeId}` : ''}
                  </p>
                  {deliverable.preview ? <pre className="code-block deliverable-preview">{String(deliverable.preview)}</pre> : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="surface-copy">No deliverables were produced yet.</p>
          )}
        </section>
      </div>

      <RunLogFeed logs={run.logs || []} selectedNodeId="" />
    </div>
  );
}

function WorkflowRunsMonitorView({
  runs,
  selectedRun,
  selectedRunId,
  runsLoading,
  runsError,
  onSelectRun,
  onRefreshRunList,
  onRefreshRun,
  onCancelRun,
  onDeleteRun,
  onOpenTemplate,
}) {
  return (
    <div className="workflows-layout workflow-runtime-layout">
      <section className="panel-surface workflow-list-panel" aria-label="Workflow runs">
        <div className="section-head">
          <h2>Workflow Runs</h2>
          <div className="inline-actions">
            {runsLoading ? <span className="chip subtle-chip">refreshing</span> : null}
            <span className="chip subtle-chip">{runs.length}</span>
            <button type="button" className="button ghost button-compact" onClick={onRefreshRunList}>
              Refresh
            </button>
          </div>
        </div>
        <p className="surface-copy">
          Live backend execution status with agent-level logs for inputs, handoffs, thinking, and outputs.
        </p>
        {runsError ? (
          <div className="workflow-warning" role="alert">
            {runsError}
          </div>
        ) : null}

        {runs.length === 0 ? (
          <EmptyState title="No workflow runs yet" body="Start a run from a workflow template to monitor live execution here." />
        ) : (
          <div className="workflow-list run-monitor-list">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                className={`workflow-row-button run-monitor-row ${selectedRunId === run.id ? 'selected' : ''}`}
                onClick={() => onSelectRun(run.id)}
              >
                <div className="workflow-row-main">
                  <p className="workflow-row-title">{run.workflowName || 'Workflow'}</p>
                  <p className="workflow-row-copy">{truncate(run.outputSummary || run.workflowSummary || run.workflowPrompt, 110)}</p>
                  <p className="workflow-row-meta">
                    {formatDateTime(run.startedAt || run.createdAt)} • {formatDuration(run.durationMs)} • {run.progress?.completedNodes || 0}/
                    {run.progress?.totalNodes || run.nodeRuns?.length || 0} agents
                  </p>
                </div>
                <div className="workflow-row-side run-monitor-row-side">
                  <StatusPill status={run.status} />
                  {run.activeNodeId ? <code>{truncate(run.activeNodeId, 18)}</code> : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <WorkflowRunDetailPanel
        run={selectedRun}
        onCancelRun={onCancelRun}
        onDeleteRun={onDeleteRun}
        onRefreshRun={onRefreshRun}
        onOpenTemplate={onOpenTemplate}
      />
    </div>
  );
}

function WorkflowRunsLiveView({
  workflows,
  preferredWorkflowId,
  runs,
  selectedRun,
  startLoading,
  startError,
  onStartRun,
  onSelectRun,
  onOpenTemplate,
  onSelectWorkflowForLive,
  onOpenRunsTab,
  onClearStartError,
}) {
  const [workflowId, setWorkflowId] = useState(preferredWorkflowId || workflows[0]?.id || '');
  const [draftInputs, setDraftInputs] = useState({});
  const [requestedDeliverableNames, setRequestedDeliverableNames] = useState([]);
  const [additionalDeliverablesText, setAdditionalDeliverablesText] = useState('');
  const [composerText, setComposerText] = useState('');
  const [sessionMessages, setSessionMessages] = useState([]);
  const [generalUploads, setGeneralUploads] = useState([]);
  const [selectedDeliverableId, setSelectedDeliverableId] = useState('');
  const [localError, setLocalError] = useState('');
  const [uploadingCount, setUploadingCount] = useState(0);

  const workflowsList = Array.isArray(workflows) ? workflows : [];

  useEffect(() => {
    const fallbackId = workflowsList[0]?.id || '';
    if (preferredWorkflowId && preferredWorkflowId !== workflowId && workflowsList.some((item) => item.id === preferredWorkflowId)) {
      setWorkflowId(preferredWorkflowId);
      return;
    }
    if (!workflowId || !workflowsList.some((item) => item.id === workflowId)) {
      setWorkflowId(preferredWorkflowId || fallbackId);
    }
  }, [preferredWorkflowId, workflowId, workflowsList]);

  const workflow = workflowsList.find((item) => item.id === workflowId) || null;
  const inputModules = normalizeInputModuleSpecs(
    workflow?.inputModules || workflow?.inputs || [],
    workflow?.prompt || workflow?.summary || ''
  );
  const outputSpecs = normalizeOutputSpecs(
    workflow?.outputSpecs || workflow?.deliverables || [],
    workflow?.prompt || workflow?.summary || ''
  );
  const missingRequiredModules = listMissingRequiredInputs(inputModules, draftInputs);

  const workflowRuns = workflow ? runs.filter((run) => run.workflowId === workflow.id) : [];
  const viewerRun =
    selectedRun && workflow && selectedRun.workflowId === workflow.id
      ? selectedRun
      : workflowRuns[0] || null;

  const deliverableItems = Array.isArray(viewerRun?.deliverables) ? viewerRun.deliverables : [];
  const selectedDeliverable =
    deliverableItems.find((item) => (item.id || item.name) === selectedDeliverableId) || deliverableItems[0] || null;

  useEffect(() => {
    if (!workflow) {
      setDraftInputs({});
      setRequestedDeliverableNames([]);
      setAdditionalDeliverablesText('');
      setComposerText('');
      setSessionMessages([]);
      setGeneralUploads([]);
      setLocalError('');
      return;
    }

    setDraftInputs(createLiveRunInputDrafts(inputModules));
    setRequestedDeliverableNames(outputSpecs.map((item) => item.name).filter(Boolean));
    setAdditionalDeliverablesText('');
    setComposerText('');
    setGeneralUploads([]);
    setLocalError('');
    setSessionMessages([
      {
        id: generateId('live_msg'),
        role: 'system',
        text: `Selected ${workflow.name}. Fill required inputs and upload supporting documents before starting the run.`,
      },
    ]);
    onClearStartError?.();
  }, [workflow?.id]);

  useEffect(() => {
    const currentIds = new Set(deliverableItems.map((item) => item.id || item.name).filter(Boolean));
    if (!selectedDeliverableId || !currentIds.has(selectedDeliverableId)) {
      setSelectedDeliverableId(deliverableItems[0]?.id || deliverableItems[0]?.name || '');
    }
  }, [selectedDeliverableId, deliverableItems]);

  const appendLiveMessage = (role, text) => {
    if (!text) return;
    setSessionMessages((prev) => [...prev, { id: generateId('live_msg'), role, text }]);
  };

  const updateDraftInput = (name, value) => {
    setDraftInputs((prev) => ({ ...prev, [name]: value }));
    setLocalError('');
    onClearStartError?.();
  };

  const handleWorkflowSelection = (nextWorkflowId) => {
    setWorkflowId(nextWorkflowId);
    onSelectWorkflowForLive?.(nextWorkflowId);
  };

  const handleSendComposerMessage = () => {
    const text = composerText.trim();
    if (!text) return;
    appendLiveMessage('user', text);
    setComposerText('');
    const primaryTextModule =
      inputModules.find((module) => ['long_text', 'user_input'].includes(module.type)) ||
      inputModules.find((module) => !['file_upload', 'boolean', 'number', 'json'].includes(module.type));
    if (primaryTextModule?.name) {
      setDraftInputs((prev) => {
        const existing = typeof prev[primaryTextModule.name] === 'string' ? prev[primaryTextModule.name].trim() : '';
        return {
          ...prev,
          [primaryTextModule.name]: existing ? `${existing}\n\n${text}` : text,
        };
      });
    }
  };

  const addUploadedFiles = async (files, targetType = 'general', moduleName = '') => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return;

    setUploadingCount((prev) => prev + fileList.length);
    setLocalError('');
    onClearStartError?.();

    const results = await Promise.allSettled(fileList.map((file) => serializeUploadedFileForRun(file)));
    const attachments = [];
    const errors = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        attachments.push(result.value);
      } else {
        const message = result.reason instanceof Error ? result.reason.message : 'Failed to read file';
        errors.push(message);
      }
    }

    setUploadingCount((prev) => Math.max(0, prev - fileList.length));

    if (attachments.length > 0) {
      if (targetType === 'module' && moduleName) {
        setDraftInputs((prev) => ({
          ...prev,
          [moduleName]: [...(Array.isArray(prev[moduleName]) ? prev[moduleName] : []), ...attachments],
        }));
      } else {
        setGeneralUploads((prev) => [...prev, ...attachments]);
      }
      appendLiveMessage(
        'system',
        `Attached ${attachments.length} document${attachments.length === 1 ? '' : 's'}${moduleName ? ` to ${moduleName}` : ''}.`
      );
    }

    if (errors.length > 0) {
      setLocalError(errors.join(' '));
    }
  };

  const removeModuleAttachment = (moduleName, attachmentId) => {
    setDraftInputs((prev) => ({
      ...prev,
      [moduleName]: (Array.isArray(prev[moduleName]) ? prev[moduleName] : []).filter((item) => item.id !== attachmentId),
    }));
  };

  const removeGeneralAttachment = (attachmentId) => {
    setGeneralUploads((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const toggleRequestedDeliverable = (name, checked) => {
    setRequestedDeliverableNames((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return [...next];
    });
  };

  const buildRunInputsPayload = () => {
    const payload = {};
    const parseErrors = [];

    for (const module of inputModules) {
      const rawValue = draftInputs[module.name];
      const type = ensureString(module.type, 'user_input');

      if (!isWorkflowInputValueProvided(module, rawValue)) {
        continue;
      }

      if (type === 'file_upload') {
        payload[module.name] = (Array.isArray(rawValue) ? rawValue : []).map((file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          uploadedAt: file.uploadedAt,
          kind: file.kind,
          content: file.content,
          truncated: Boolean(file.truncated),
        }));
        continue;
      }

      if (type === 'boolean') {
        payload[module.name] = Boolean(rawValue);
        continue;
      }

      if (type === 'number') {
        const numeric = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim());
        if (!Number.isFinite(numeric)) {
          parseErrors.push(`${module.label || module.name}: enter a valid number.`);
          continue;
        }
        payload[module.name] = numeric;
        continue;
      }

      if (type === 'json') {
        if (typeof rawValue !== 'string') {
          payload[module.name] = rawValue;
          continue;
        }
        try {
          payload[module.name] = JSON.parse(rawValue);
        } catch {
          parseErrors.push(`${module.label || module.name}: invalid JSON.`);
        }
        continue;
      }

      payload[module.name] = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    }

    const unsentComposer = composerText.trim();
    const userMessages = sessionMessages.filter((message) => message.role === 'user').map((message) => message.text.trim()).filter(Boolean);
    const combinedBrief = [...userMessages, unsentComposer].filter(Boolean).join('\n\n');
    if (combinedBrief) {
      payload.live_brief = combinedBrief;
    }

    if (generalUploads.length > 0) {
      payload.uploaded_documents = generalUploads.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        uploadedAt: file.uploadedAt,
        kind: file.kind,
        content: file.content,
        truncated: Boolean(file.truncated),
      }));
    }

    if (sessionMessages.length > 0) {
      payload.live_session_messages = sessionMessages.map((message) => ({
        role: message.role,
        text: message.text,
      }));
    }

    return { payload, parseErrors };
  };

  const handleStartRun = async () => {
    if (!workflow || typeof onStartRun !== 'function' || startLoading) return;
    if (uploadingCount > 0) {
      setLocalError('Wait for document uploads to finish before starting the run.');
      return;
    }
    const missing = listMissingRequiredInputs(inputModules, draftInputs);
    if (missing.length > 0) {
      setLocalError(`Missing required inputs: ${missing.map((item) => item.label || item.name).join(', ')}`);
      return;
    }

    const { payload, parseErrors } = buildRunInputsPayload();
    if (parseErrors.length > 0) {
      setLocalError(parseErrors.join(' '));
      return;
    }

    const extraRequested = additionalDeliverablesText
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const requestedDeliverables = [...new Set([...requestedDeliverableNames, ...extraRequested])];

    const startedRun = await onStartRun({
      workflowId: workflow.id,
      source: 'live',
      inputs: payload,
      requestedDeliverables,
    });

    if (startedRun) {
      appendLiveMessage('system', `Started run ${startedRun.id} for ${workflow.name}. Monitoring deliverables on the right.`);
      setLocalError('');
    }
  };

  const recentLogs = viewerRun ? [...(viewerRun.logs || [])].slice(-8).reverse() : [];
  const readinessComplete = missingRequiredModules.length === 0 && uploadingCount === 0;

  return (
    <div className="live-run-layout">
      <section className="panel-surface live-run-panel">
        <div className="section-head">
          <h2>Live Run</h2>
          <div className="inline-actions">
            {uploadingCount > 0 ? <span className="chip subtle-chip">uploading {uploadingCount}</span> : null}
            <span className={`chip subtle-chip ${readinessComplete ? 'chip-positive' : ''}`}>
              {readinessComplete ? 'ready' : `${missingRequiredModules.length} missing`}
            </span>
          </div>
        </div>

        {workflowsList.length === 0 ? (
          <EmptyState
            title="No workflow templates"
            body="Create a workflow template first, then use Live Run to collect inputs, upload documents, and launch a run."
          />
        ) : (
          <div className="page-stack">
            <div className="live-run-toolbar">
              <label className="field-group">
                <span>Workflow Template</span>
                <select
                  className="select"
                  value={workflowId}
                  onChange={(event) => handleWorkflowSelection(event.target.value)}
                  disabled={startLoading}
                >
                  {workflowsList.map((item) => (
                    <option key={`live-workflow-${item.id}`} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="live-run-toolbar-actions">
                {workflow?.id && onOpenTemplate ? (
                  <button type="button" className="button ghost button-compact" onClick={() => onOpenTemplate(workflow.id)}>
                    Open Template
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button ghost button-compact"
                  onClick={() => {
                    if (viewerRun?.id) {
                      onSelectRun?.(viewerRun.id);
                      onOpenRunsTab?.();
                    }
                  }}
                  disabled={!viewerRun}
                >
                  Open Run Monitor
                </button>
              </div>
            </div>

            {workflow ? (
              <div className="live-run-template-card">
                <div className="section-head">
                  <h2>{workflow.name}</h2>
                  <span className="chip subtle-chip">
                    {inputModules.length} inputs • {outputSpecs.length} deliverables
                  </span>
                </div>
                <p className="surface-copy">{truncate(workflow.summary || workflow.prompt, 220)}</p>
              </div>
            ) : null}

            <section className="panel-surface nested-panel live-run-chat-shell">
              <div className="section-head">
                <h2>Briefing</h2>
                <span className="chip subtle-chip">codex-style</span>
              </div>
              <div className="live-run-message-list" role="log" aria-live="polite">
                {sessionMessages.length === 0 ? (
                  <p className="surface-copy">Add context, instructions, and documents for this run.</p>
                ) : (
                  sessionMessages.map((message) => (
                    <div key={message.id} className={`live-run-message ${message.role}`}>
                      <div className="live-run-message-head">
                        <span className="chip subtle-chip">{message.role}</span>
                      </div>
                      <p>{message.text}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="live-run-composer">
                <textarea
                  className="textarea live-run-composer-textarea"
                  rows={4}
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                  placeholder="Tell the workflow what you need, constraints to honor, deadlines, output format preferences, and any extra context..."
                  disabled={startLoading}
                />
                <div className="live-run-composer-actions">
                  <label className="button ghost button-compact live-run-upload-button">
                    Upload Docs
                    <input
                      type="file"
                      multiple
                      onChange={(event) => {
                        void addUploadedFiles(event.target.files, 'general');
                        event.target.value = '';
                      }}
                      disabled={startLoading}
                    />
                  </label>
                  <button type="button" className="button ghost button-compact" onClick={handleSendComposerMessage} disabled={!composerText.trim()}>
                    Add Note
                  </button>
                </div>
              </div>

              {generalUploads.length > 0 ? (
                <div className="live-run-upload-list">
                  {generalUploads.map((file) => (
                    <div key={file.id} className="live-run-upload-chip">
                      <div>
                        <strong>{file.name}</strong>
                        <span>
                          {file.mimeType} • {formatBytes(file.sizeBytes)}
                          {file.truncated ? ' • truncated' : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="button danger button-compact"
                        onClick={() => removeGeneralAttachment(file.id)}
                        disabled={startLoading}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="panel-surface nested-panel">
              <div className="section-head">
                <h2>Gather Required Inputs Before Start</h2>
                <span className={`chip subtle-chip ${readinessComplete ? 'chip-positive' : ''}`}>
                  {readinessComplete ? 'complete' : 'needs input'}
                </span>
              </div>

              <div className="live-run-checklist">
                {inputModules.map((module) => {
                  const provided = isWorkflowInputValueProvided(module, draftInputs[module.name]);
                  return (
                    <div key={`check-${module.id || module.name}`} className={`live-run-check-item ${provided ? 'done' : ''}`}>
                      <span>{module.label || module.name}</span>
                      <div className="inline-actions">
                        <span className="chip subtle-chip">{module.type || 'input'}</span>
                        {module.required !== false ? (
                          <span className={`chip subtle-chip ${provided ? 'chip-positive' : ''}`}>
                            {provided ? 'required: done' : 'required'}
                          </span>
                        ) : (
                          <span className="chip subtle-chip">optional</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="live-run-input-grid">
                {inputModules.map((module, index) => {
                  const key = module.id || `${module.name}-${index}`;
                  const value = draftInputs[module.name];
                  const safeType = ensureString(module.type, 'user_input');

                  return (
                    <article key={key} className="live-run-input-card">
                      <div className="live-run-input-card-head">
                        <div>
                          <p className="contract-label">{module.required !== false ? 'Required Input' : 'Optional Input'}</p>
                          <h3>{module.label || module.name}</h3>
                          <p className="live-run-input-card-key">{module.name}</p>
                        </div>
                        <span className="chip subtle-chip">{safeType}</span>
                      </div>

                      {module.description ? <p className="surface-copy">{module.description}</p> : null}

                      {safeType === 'boolean' ? (
                        <label className="checkbox-inline">
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={(event) => updateDraftInput(module.name, event.target.checked)}
                            disabled={startLoading}
                          />
                          <span>{module.label || module.name}</span>
                        </label>
                      ) : null}

                      {safeType === 'number' ? (
                        <label className="field-group">
                          <span>Value</span>
                          <input
                            type="number"
                            className="input"
                            value={typeof value === 'string' || typeof value === 'number' ? value : ''}
                            onChange={(event) => updateDraftInput(module.name, event.target.value)}
                            placeholder="42"
                            disabled={startLoading}
                          />
                        </label>
                      ) : null}

                      {safeType === 'json' ? (
                        <label className="field-group">
                          <span>JSON</span>
                          <textarea
                            className="textarea textarea-compact"
                            rows={4}
                            value={typeof value === 'string' ? value : ''}
                            onChange={(event) => updateDraftInput(module.name, event.target.value)}
                            placeholder='{"customer_id":"123","priority":"high"}'
                            disabled={startLoading}
                          />
                        </label>
                      ) : null}

                      {safeType === 'file_upload' ? (
                        <div className="page-stack">
                          <div className="live-run-composer-actions">
                            <label className="button ghost button-compact live-run-upload-button">
                              Attach Files
                              <input
                                type="file"
                                multiple
                                onChange={(event) => {
                                  void addUploadedFiles(event.target.files, 'module', module.name);
                                  event.target.value = '';
                                }}
                                disabled={startLoading}
                              />
                            </label>
                            <span className="hint">{Array.isArray(value) ? `${value.length} attached` : 'No files attached'}</span>
                          </div>
                          {Array.isArray(value) && value.length > 0 ? (
                            <div className="live-run-upload-list compact">
                              {value.map((file) => (
                                <div key={file.id} className="live-run-upload-chip">
                                  <div>
                                    <strong>{file.name}</strong>
                                    <span>
                                      {file.mimeType} • {formatBytes(file.sizeBytes)}
                                      {file.truncated ? ' • truncated' : ''}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="button danger button-compact"
                                    onClick={() => removeModuleAttachment(module.name, file.id)}
                                    disabled={startLoading}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {!['boolean', 'number', 'json', 'file_upload'].includes(safeType) ? (
                        <label className="field-group">
                          <span>{safeType === 'long_text' ? 'Text' : 'Value'}</span>
                          {safeType === 'long_text' || safeType === 'user_input' ? (
                            <textarea
                              className="textarea textarea-compact"
                              rows={4}
                              value={typeof value === 'string' ? value : ''}
                              onChange={(event) => updateDraftInput(module.name, event.target.value)}
                              placeholder="Provide task context for this workflow input..."
                              disabled={startLoading}
                            />
                          ) : (
                            <input
                              type="text"
                              className="input"
                              value={typeof value === 'string' ? value : ''}
                              onChange={(event) => updateDraftInput(module.name, event.target.value)}
                              placeholder={safeType === 'url' ? 'https://example.com' : 'Enter a value'}
                              disabled={startLoading}
                            />
                          )}
                        </label>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="panel-surface nested-panel">
              <div className="section-head">
                <h2>Requested Deliverables</h2>
                <span className="chip subtle-chip">{requestedDeliverableNames.length}</span>
              </div>
              <div className="live-run-deliverable-checklist">
                {outputSpecs.map((spec) => {
                  const checked = requestedDeliverableNames.includes(spec.name);
                  return (
                    <label key={`req-${spec.id || spec.name}`} className="live-run-deliverable-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => toggleRequestedDeliverable(spec.name, event.target.checked)}
                        disabled={startLoading}
                      />
                      <div>
                        <strong>{spec.label || spec.name}</strong>
                        <span>
                          {spec.name} • {spec.type || 'deliverable'}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
              <label className="field-group">
                <span>Additional Deliverables (optional)</span>
                <input
                  type="text"
                  className="input"
                  value={additionalDeliverablesText}
                  onChange={(event) => setAdditionalDeliverablesText(event.target.value)}
                  placeholder="comma or newline separated file names (e.g. handoff.md, checklist.txt)"
                  disabled={startLoading}
                />
              </label>
              <div className="live-run-start-bar">
                <p className={startError || localError ? 'error' : 'hint'} role={startError || localError ? 'alert' : 'status'}>
                  {startError || localError || 'The run will not start until all required workflow inputs are collected.'}
                </p>
                <div className="inline-actions">
                  <button type="button" className="button" onClick={handleStartRun} disabled={startLoading || !workflow || !readinessComplete}>
                    {startLoading ? 'Starting…' : 'Start Workflow Run'}
                  </button>
                </div>
              </div>
            </section>

            {viewerRun ? (
              <section className="panel-surface nested-panel">
                <div className="section-head">
                  <h2>Recent Activity</h2>
                  <div className="inline-actions">
                    <StatusPill status={viewerRun.status} />
                    <span className="chip subtle-chip">{recentLogs.length} recent logs</span>
                  </div>
                </div>
                {recentLogs.length === 0 ? (
                  <p className="surface-copy">Logs will appear after the run starts.</p>
                ) : (
                  <div className="live-run-activity-list">
                    {recentLogs.map((log) => (
                      <article key={log.id} className={`live-run-activity-item ${log.category || 'lifecycle'}`}>
                        <div className="live-run-activity-head">
                          <span className={`log-category-badge ${log.category}`}>{log.category}</span>
                          <span>{formatDateTime(log.timestamp)}</span>
                          {log.nodeId ? <code>{log.nodeId}</code> : null}
                        </div>
                        <p className="live-run-activity-title">{log.title || 'Event'}</p>
                        <p className="live-run-activity-copy">{truncate(log.message || '', 240)}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        )}
      </section>

      <section className="panel-surface live-run-viewer-panel">
        <div className="section-head">
          <h2>Deliverables Viewer</h2>
          <div className="inline-actions">
            {viewerRun ? (
              <>
                <StatusPill status={viewerRun.status} />
                <span className="chip subtle-chip">{deliverableItems.length} files</span>
              </>
            ) : (
              <span className="chip subtle-chip">waiting for run</span>
            )}
          </div>
        </div>

        {!workflow ? (
          <EmptyState title="Select a workflow" body="Choose a template on the left to prepare a live run and preview deliverables here." />
        ) : !viewerRun ? (
          <div className="page-stack">
            <p className="surface-copy">
              Start a run from the left panel after collecting all required inputs. Deliverables will stream into this viewer.
            </p>
            <div className="deliverable-file-list compact">
              {outputSpecs.map((spec) => (
                <div key={`expected-${spec.id || spec.name}`} className="deliverable-file-row placeholder">
                  <div>
                    <strong>{spec.label || spec.name}</strong>
                    <span>
                      {spec.name} • expected {spec.type || 'deliverable'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="deliverable-viewer-layout">
            <aside className="deliverable-file-list">
              {deliverableItems.length > 0 ? (
                deliverableItems.map((deliverable) => {
                  const rowId = deliverable.id || deliverable.name;
                  return (
                    <button
                      key={rowId}
                      type="button"
                      className={`deliverable-file-row ${selectedDeliverable && (selectedDeliverable.id || selectedDeliverable.name) === rowId ? 'active' : ''}`}
                      onClick={() => setSelectedDeliverableId(rowId)}
                    >
                      <div>
                        <strong>{deliverable.name || 'deliverable'}</strong>
                        <span>
                          {deliverable.mimeType || deliverable.type || 'file'}
                          {deliverable.producerNodeId ? ` • ${deliverable.producerNodeId}` : ''}
                        </span>
                      </div>
                      <StatusPill status={deliverable.status || 'final'} />
                    </button>
                  );
                })
              ) : (
                <div className="deliverable-file-row placeholder">
                  <div>
                    <strong>No deliverables yet</strong>
                    <span>The workflow is still running or has not produced files.</span>
                  </div>
                </div>
              )}
            </aside>

            <section className="deliverable-file-preview-panel">
              <div className="deliverable-file-preview-head">
                <div>
                  <h3>{selectedDeliverable?.name || 'Run Outputs'}</h3>
                  <p className="surface-copy">
                    {selectedDeliverable
                      ? `${selectedDeliverable.mimeType || selectedDeliverable.type || 'file'} • ${selectedDeliverable.status || 'final'}`
                      : `Run ${viewerRun.id} • ${viewerRun.status}`}
                  </p>
                </div>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button ghost button-compact"
                    onClick={() => {
                      onSelectRun?.(viewerRun.id);
                      onOpenRunsTab?.();
                    }}
                  >
                    Open Full Run
                  </button>
                </div>
              </div>

              {viewerRun.pendingInputRequest ? (
                <div className="workflow-warning" role="alert">
                  Runtime requested more input mid-run, but resume UI is not wired yet. Use the preflight inputs on the left before starting.
                </div>
              ) : null}

              <pre className="code-block deliverable-file-preview">
                {selectedDeliverable
                  ? typeof selectedDeliverable.content === 'string'
                    ? selectedDeliverable.content
                    : formatJsonPreview(selectedDeliverable.preview || selectedDeliverable)
                  : formatJsonPreview(viewerRun.outputs || {})}
              </pre>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function WorkflowRunsWorkspaceView({
  activeTab,
  onSelectTab,
  workflows,
  preferredWorkflowId,
  runs,
  selectedRun,
  selectedRunId,
  runsLoading,
  runsError,
  startLoading,
  startError,
  onStartRun,
  onSelectRun,
  onRefreshRunList,
  onRefreshRun,
  onCancelRun,
  onDeleteRun,
  onOpenTemplate,
  onSelectWorkflowForLive,
  onClearStartError,
}) {
  return (
    <div className="page-stack workflow-runs-workspace">
      <section className="panel-surface workflow-runs-tab-shell">
        <div className="detail-tabs workflow-runs-tabs" role="tablist" aria-label="Workflow runs views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'live'}
            className={`tab-button ${activeTab === 'live' ? 'active' : ''}`}
            onClick={() => onSelectTab?.('live')}
          >
            Live
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'runs'}
            className={`tab-button ${activeTab === 'runs' ? 'active' : ''}`}
            onClick={() => onSelectTab?.('runs')}
          >
            Runs
          </button>
        </div>
        <p className="surface-copy workflow-runs-tab-copy">
          Live gathers user inputs and documents before launch. Runs shows the full execution monitor, logs, and agent traces.
        </p>
      </section>

      {activeTab === 'live' ? (
        <WorkflowRunsLiveView
          workflows={workflows}
          preferredWorkflowId={preferredWorkflowId}
          runs={runs}
          selectedRun={selectedRun}
          startLoading={startLoading}
          startError={startError}
          onStartRun={onStartRun}
          onSelectRun={onSelectRun}
          onOpenTemplate={onOpenTemplate}
          onSelectWorkflowForLive={onSelectWorkflowForLive}
          onOpenRunsTab={() => onSelectTab?.('runs')}
          onClearStartError={onClearStartError}
        />
      ) : (
        <WorkflowRunsMonitorView
          runs={runs}
          selectedRun={selectedRun}
          selectedRunId={selectedRunId}
          runsLoading={runsLoading}
          runsError={runsError}
          onSelectRun={onSelectRun}
          onRefreshRunList={onRefreshRunList}
          onRefreshRun={onRefreshRun}
          onCancelRun={onCancelRun}
          onDeleteRun={onDeleteRun}
          onOpenTemplate={onOpenTemplate}
        />
      )}
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
        <StatCard label="Runs" value={String(totalRuns)} meta="Backend workflow run history" />
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

function WorkflowListPanel({
  workflows,
  selectedWorkflowId,
  onSelectWorkflow,
  onOpenNewWorkflow,
  onRunWorkflow,
  onDeleteWorkflow,
}) {
  return (
    <section className="panel-surface workflow-list-panel" aria-label="Saved workflow templates">
      <div className="section-head">
        <h2>Workflow Templates</h2>
        <span className="chip subtle-chip">{workflows.length}</span>
      </div>

      {workflows.length === 0 ? (
        <p className="surface-copy workflow-list-empty-hint">
          No workflow templates saved yet. Create one from the card below.
        </p>
      ) : null}

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
            </button>
          </article>
        ))}

        <button type="button" className="workflow-create-row" onClick={onOpenNewWorkflow}>
          <div className="workflow-create-row-head">
            <span className="workflow-create-badge" aria-hidden="true">
              +
            </span>
            <div className="workflow-row-main">
              <p className="workflow-row-title">New Workflow Template</p>
              <p className="workflow-row-copy">
                Generate a graph from a prompt, then tune agents and connections on the canvas.
              </p>
            </div>
          </div>
          <div className="workflow-create-skeleton" aria-hidden="true">
            <span className="workflow-create-skeleton-line workflow-create-skeleton-line-long" />
            <span className="workflow-create-skeleton-line workflow-create-skeleton-line-mid" />
            <span className="workflow-create-skeleton-line workflow-create-skeleton-line-short" />
          </div>
        </button>
      </div>
    </section>
  );
}

function WorkflowOverviewTab({ workflow }) {
  const workflowInputs = Array.isArray(workflow.inputs) ? workflow.inputs : [];
  const workflowDeliverables = Array.isArray(workflow.deliverables) ? workflow.deliverables : [];

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

      <section className="panel-surface">
        <div className="section-head">
          <h2>Workflow Contract</h2>
          <span className="chip subtle-chip">
            {workflowInputs.length} inputs • {workflowDeliverables.length} deliverables
          </span>
        </div>
        <div className="contract-columns">
          <div className="contract-column">
            <p className="contract-label">Inputs</p>
            {workflowInputs.length > 0 ? (
              <ul className="contract-list">
                {workflowInputs.map((item, index) => (
                  <li key={`input-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="surface-copy">No workflow inputs specified.</p>
            )}
          </div>
          <div className="contract-column">
            <p className="contract-label">Deliverables</p>
            {workflowDeliverables.length > 0 ? (
              <ul className="contract-list">
                {workflowDeliverables.map((item, index) => (
                  <li key={`deliverable-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="surface-copy">No deliverables specified.</p>
            )}
          </div>
        </div>
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

function GraphEditor({
  workflow,
  error,
  selectedNodeId,
  selectedEdgeIndex,
  onSelectNode,
  onSelectEdge,
  onAddAgent,
  onDeleteAgent,
  onUpdateAgentField,
  onUpdateWorkflowContract,
  onSetNodePosition,
  onAutoLayout,
  onAddEdge,
  onUpdateEdge,
  onDeleteEdge,
}) {
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const edges = Array.isArray(workflow.edges) ? workflow.edges : [];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedEdge =
    Number.isInteger(selectedEdgeIndex) && selectedEdgeIndex >= 0 && selectedEdgeIndex < edges.length
      ? coerceWorkflowEdge(edges[selectedEdgeIndex], { preserveEmptyHandoffFields: true })
      : null;
  const nodeNameById = new Map(nodes.map((node) => [node.id, node.name || node.id]));
  const [workflowInputsText, setWorkflowInputsText] = useState(formatLineItems(workflow.inputs));
  const [workflowDeliverablesText, setWorkflowDeliverablesText] = useState(formatLineItems(workflow.deliverables));

  useEffect(() => {
    setWorkflowInputsText(formatLineItems(workflow.inputs));
    setWorkflowDeliverablesText(formatLineItems(workflow.deliverables));
  }, [workflow.id]);

  const updateSelectedEdge = (patch) => {
    if (!Number.isInteger(selectedEdgeIndex) || typeof onUpdateEdge !== 'function') return;
    onUpdateEdge(selectedEdgeIndex, patch);
  };

  const updateSelectedEdgeContract = (contractPatch) => {
    const baseContract = coerceHandoffContract(selectedEdge?.handoffContract, selectedEdge?.handoff || '', {
      preserveEmpty: true,
      ensureDefault: true,
    });
    updateSelectedEdge({
      handoffContract: {
        ...baseContract,
        ...contractPatch,
      },
    });
  };

  const addSelectedEdgeField = () => {
    const fields = Array.isArray(selectedEdge?.handoffContract?.fields) ? selectedEdge.handoffContract.fields : [];
    updateSelectedEdgeContract({
      fields: [
        ...fields,
        {
          id: generateId('handoff_field'),
          targetKey: '',
          sourcePath: '',
          type: 'string',
          required: true,
          description: '',
        },
      ],
    });
  };

  const updateSelectedEdgeField = (fieldId, patch) => {
    const fields = Array.isArray(selectedEdge?.handoffContract?.fields) ? selectedEdge.handoffContract.fields : [];
    updateSelectedEdgeContract({
      fields: fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
    });
  };

  const removeSelectedEdgeField = (fieldId) => {
    const fields = Array.isArray(selectedEdge?.handoffContract?.fields) ? selectedEdge.handoffContract.fields : [];
    const nextFields = fields.filter((field) => field.id !== fieldId);
    updateSelectedEdgeContract({ fields: nextFields.length > 0 ? nextFields : createDefaultHandoffFieldMappings() });
  };

  return (
    <div className="graph-editor-layout">
      <section className="panel-surface graph-stage-panel">
        <div className="graph-stage-head">
          <div>
            <div className="section-head">
              <h2>Workflow Graph</h2>
              <span className="chip subtle-chip">{nodes.length} agents</span>
            </div>
            <p className="surface-copy graph-help">
              Scroll to zoom, drag empty space to pan, drag nodes to reposition, and drag from a node handle to create a
              connection. Click an edge to select it, then press Delete. Drag an edge endpoint off a node to remove it.
            </p>
          </div>
          <div className="inline-actions graph-toolbar-actions">
            <button type="button" className="button ghost button-compact" onClick={onAutoLayout}>
              Auto Layout
            </button>
            <button type="button" className="button button-compact" onClick={onAddAgent}>
              Add Agent
            </button>
          </div>
        </div>

        {error ? (
          <div className="workflow-warning" role="alert">
            {error}
          </div>
        ) : null}

        <WorkflowDag
          plan={workflow}
          nodePositions={workflow.nodePositions}
          selectedNodeId={selectedNodeId}
          selectedEdgeIndex={selectedEdgeIndex}
          onNodeSelect={onSelectNode}
          onEdgeSelect={onSelectEdge}
          onCanvasSelect={() => {
            onSelectEdge?.(null);
            onSelectNode(null);
          }}
          onNodePositionChange={onSetNodePosition}
          onAddEdge={onAddEdge}
          onUpdateEdge={onUpdateEdge}
          onDeleteEdge={onDeleteEdge}
          interactive
          layoutOptions={INTERACTIVE_GRAPH_LAYOUT}
          className="graph-canvas-shell"
          svgClassName="graph-canvas-svg"
          emptyMessage="Add agents to start building the graph."
        />
      </section>

      <aside className="panel-surface graph-inspector-panel" aria-label="Selected agent properties">
        <section className="graph-connection-section workflow-contract-section">
          <details className="workflow-contract-disclosure">
            <summary className="workflow-contract-summary">
              <div className="workflow-contract-summary-main">
                <h2>Workflow Contract</h2>
                <p className="workflow-contract-summary-copy">Workflow-level inputs + deliverables</p>
              </div>
              <div className="workflow-contract-summary-side">
                <span className="chip subtle-chip">
                  {(workflow.inputs?.length || 0)} in • {(workflow.deliverables?.length || 0)} out
                </span>
                <span className="workflow-contract-caret" aria-hidden="true" />
              </div>
            </summary>

            <div className="workflow-contract-body">
              <label className="field-group">
                <span>Workflow Inputs</span>
                <textarea
                  className="textarea textarea-compact workflow-contract-textarea"
                  rows={2}
                  value={workflowInputsText}
                  onChange={(event) => {
                    const value = event.target.value;
                    setWorkflowInputsText(value);
                    onUpdateWorkflowContract?.({
                      inputs: parseLineItems(value),
                      deliverables: parseLineItems(workflowDeliverablesText),
                    });
                  }}
                  placeholder={'user_id\nrequest text\nproject context'}
                />
              </label>
              <label className="field-group">
                <span>Workflow Deliverables</span>
                <textarea
                  className="textarea textarea-compact workflow-contract-textarea"
                  rows={2}
                  value={workflowDeliverablesText}
                  onChange={(event) => {
                    const value = event.target.value;
                    setWorkflowDeliverablesText(value);
                    onUpdateWorkflowContract?.({
                      inputs: parseLineItems(workflowInputsText),
                      deliverables: parseLineItems(value),
                    });
                  }}
                  placeholder={'final response draft\nrisk summary\nnext actions'}
                />
              </label>
              <p className="hint inline-hint workflow-contract-hint">
                One item per line. Defines workflow-level inputs and deliverables.
              </p>
            </div>
          </details>
        </section>

        <section className="graph-connection-section graph-edge-contract-section">
          <div className="section-head">
            <h2>Connection Inspector</h2>
            <span className="chip subtle-chip">{selectedEdge ? 'selected' : 'none'}</span>
          </div>

          {!selectedEdge ? (
            <div className="graph-inspector-empty">
              <p>Select an edge in the graph to define a typed handoff packet contract.</p>
            </div>
          ) : (
            <div className="graph-inspector-stack">
              <div className="graph-node-meta">
                <code>
                  {(nodeNameById.get(selectedEdge.source) || selectedEdge.source || 'source') +
                    ' → ' +
                    (nodeNameById.get(selectedEdge.target) || selectedEdge.target || 'target')}
                </code>
                <span className="chip subtle-chip">edge {selectedEdgeIndex + 1}</span>
              </div>

              <label className="field-group">
                <span>Handoff Label</span>
                <input
                  type="text"
                  className="input"
                  value={selectedEdge.handoff || ''}
                  onChange={(event) => updateSelectedEdge({ handoff: event.target.value })}
                  placeholder="Research brief"
                />
              </label>

              <label className="field-group">
                <span>Packet Type</span>
                <input
                  type="text"
                  className="input"
                  value={ensureString(selectedEdge?.handoffContract?.packetType, 'handoff_packet')}
                  onChange={(event) => updateSelectedEdgeContract({ packetType: event.target.value })}
                  placeholder="research_brief"
                />
              </label>

              <div className="graph-connection-card handoff-contract-card">
                <div className="section-head">
                  <h3>Fields</h3>
                  <button type="button" className="button ghost button-compact" onClick={addSelectedEdgeField}>
                    Add Field
                  </button>
                </div>
                <p className="surface-copy handoff-contract-copy">
                  Map source agent output paths (for example `summary` or `details.summary`) into a structured packet for the
                  downstream agent.
                </p>
                <div className="handoff-field-list">
                  {(selectedEdge?.handoffContract?.fields || []).map((field, index) => (
                    <div key={field.id || `handoff-field-${index}`} className="handoff-field-row">
                      <div className="handoff-field-grid">
                        <label className="field-group">
                          <span>Target Key</span>
                          <input
                            type="text"
                            className="input"
                            value={ensureString(field?.targetKey, '')}
                            onChange={(event) => updateSelectedEdgeField(field.id, { targetKey: event.target.value })}
                            placeholder="summary"
                          />
                        </label>
                        <label className="field-group">
                          <span>Source Path</span>
                          <input
                            type="text"
                            className="input"
                            value={ensureString(field?.sourcePath, '')}
                            onChange={(event) => updateSelectedEdgeField(field.id, { sourcePath: event.target.value })}
                            placeholder="summary"
                          />
                        </label>
                        <label className="field-group">
                          <span>Type</span>
                          <select
                            className="select"
                            value={ensureString(field?.type, 'any') || 'any'}
                            onChange={(event) => updateSelectedEdgeField(field.id, { type: event.target.value })}
                          >
                            {HANDOFF_FIELD_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="field-group handoff-required-toggle">
                          <span>Required</span>
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={field?.required !== false}
                              onChange={(event) => updateSelectedEdgeField(field.id, { required: event.target.checked })}
                            />
                            <span>{field?.required !== false ? 'Yes' : 'No'}</span>
                          </label>
                        </div>
                      </div>

                      <div className="handoff-field-row-foot">
                        <label className="field-group">
                          <span>Description</span>
                          <input
                            type="text"
                            className="input"
                            value={ensureString(field?.description, '')}
                            onChange={(event) => updateSelectedEdgeField(field.id, { description: event.target.value })}
                            placeholder="What this downstream field should contain"
                          />
                        </label>
                        <button
                          type="button"
                          className="button ghost danger button-compact"
                          onClick={() => removeSelectedEdgeField(field.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="section-head">
          <h2>Agent Inspector</h2>
          <span className="chip subtle-chip">{selectedNode ? 'selected' : 'none'}</span>
        </div>

        {!selectedNode ? (
          <div className="graph-inspector-empty">
            <p>Select an agent in the graph to edit its properties.</p>
            <button type="button" className="button button-compact" onClick={onAddAgent}>
              Add Agent
            </button>
          </div>
        ) : (
          <div className="graph-inspector-stack">
            <div className="graph-node-meta">
              <code>{selectedNode.id}</code>
              <button
                type="button"
                className="button danger button-compact"
                onClick={() => onDeleteAgent(selectedNode.id)}
                disabled={nodes.length <= 1}
              >
                Delete Agent
              </button>
            </div>

            <label className="field-group">
              <span>Name</span>
              <input
                type="text"
                className="input"
                value={selectedNode.name || ''}
                onChange={(event) => onUpdateAgentField(selectedNode.id, 'name', event.target.value)}
                placeholder="Research Agent"
              />
            </label>

            <label className="field-group">
              <span>Role</span>
              <input
                type="text"
                className="input"
                value={selectedNode.role || ''}
                onChange={(event) => onUpdateAgentField(selectedNode.id, 'role', event.target.value)}
                placeholder="Gathers facts / context"
              />
            </label>

            <label className="field-group">
              <span>Objective</span>
              <textarea
                className="textarea textarea-compact"
                rows={4}
                value={selectedNode.objective || ''}
                onChange={(event) => onUpdateAgentField(selectedNode.id, 'objective', event.target.value)}
                placeholder="Describe what this agent should produce."
              />
            </label>
          </div>
        )}
      </aside>
    </div>
  );
}

function WorkflowRunsTab({ workflow, runs, onRunWorkflow, onSelectWorkflow, onSelectRun, onOpenWorkflowsMonitor }) {
  return (
    <div className="page-stack">
      <section className="panel-surface">
        <div className="section-head">
          <h2>Run Workflow</h2>
          <span className="chip subtle-chip">backend runtime</span>
        </div>
        <p className="surface-copy">
          Start a backend workflow run with inputs and requested deliverables. Agent status and logs stream into the Workflows & Runs tab.
        </p>
        <div className="inline-actions">
          <button type="button" className="button" onClick={() => onRunWorkflow(workflow.id)}>
            Run Workflow
          </button>
          {typeof onOpenWorkflowsMonitor === 'function' ? (
            <button type="button" className="button ghost button-compact" onClick={onOpenWorkflowsMonitor}>
              Open Live Workflows
            </button>
          ) : null}
        </div>
      </section>

      <section className="panel-surface">
        <div className="section-head">
          <h2>Run History</h2>
          <span className="chip subtle-chip">{runs.length}</span>
        </div>
        <RunsList runs={runs} onSelectWorkflow={onSelectWorkflow} onSelectRun={onSelectRun} compact />
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
  onDeleteWorkflow,
  onSelectWorkflow,
  onSelectRun,
  onOpenWorkflowsMonitor,
  selectedNodeId,
  selectedEdgeIndex,
  onSelectNode,
  onSelectEdge,
  onAddAgent,
  onDeleteAgent,
  onUpdateAgentField,
  onUpdateWorkflowContract,
  onSetNodePosition,
  onAutoLayout,
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
          body="Choose a workflow from the list to inspect its graph, edit agents, and run it."
        />
      </section>
    );
  }

  return (
    <section className="panel-surface workflow-detail-panel graph-mode" aria-labelledby="workflow-detail-title">
      <div className="detail-header">
        <div>
          <div className="chip subtle-chip">workflow</div>
          <h2 id="workflow-detail-title" className="detail-title">
            {workflow.name}
          </h2>
          <p className="detail-meta detail-meta-graph">
            {workflow.nodes?.length || 0} agents • {workflow.edges?.length || 0} edges • drag to rearrange
          </p>
        </div>
        <div className="detail-actions">
          <StatusPill status={workflow.lastRunStatus || 'draft'} />
          <button type="button" className="button" onClick={() => onRunWorkflow(workflow.id)}>
            Run Workflow
          </button>
          <button type="button" className="button danger button-compact" onClick={() => onDeleteWorkflow?.(workflow.id)}>
            Delete
          </button>
        </div>
      </div>

      <div className="detail-tab-panel">
        <GraphEditor
          workflow={workflow}
          error={dagEditorError}
          selectedNodeId={selectedNodeId}
          selectedEdgeIndex={selectedEdgeIndex}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onSetNodePosition={onSetNodePosition}
          onAutoLayout={onAutoLayout}
          onAddAgent={onAddAgent}
          onDeleteAgent={onDeleteAgent}
          onUpdateAgentField={onUpdateAgentField}
          onUpdateWorkflowContract={onUpdateWorkflowContract}
          onAddEdge={onAddEdge}
          onUpdateEdge={onUpdateEdge}
          onDeleteEdge={onDeleteEdge}
        />
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
  onDeleteWorkflow,
  onSelectRun,
  onOpenWorkflowsMonitor,
  onSelectDetailTab,
  selectedNodeId,
  selectedEdgeIndex,
  onSelectNode,
  onSelectEdge,
  onAddAgent,
  onDeleteAgent,
  onUpdateAgentField,
  onUpdateWorkflowContract,
  onSetNodePosition,
  onAutoLayout,
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
        onDeleteWorkflow={onDeleteWorkflow}
      />
      <WorkflowDetail
        workflow={selectedWorkflow}
        runs={workflowRuns}
        detailTab={detailTab}
        onSelectDetailTab={onSelectDetailTab}
        onRunWorkflow={onRunWorkflow}
        onDeleteWorkflow={onDeleteWorkflow}
        onSelectWorkflow={onSelectWorkflow}
        onSelectRun={onSelectRun}
        onOpenWorkflowsMonitor={onOpenWorkflowsMonitor}
        selectedNodeId={selectedNodeId}
        selectedEdgeIndex={selectedEdgeIndex}
        onSelectNode={onSelectNode}
        onSelectEdge={onSelectEdge}
        onAddAgent={onAddAgent}
        onDeleteAgent={onDeleteAgent}
        onUpdateAgentField={onUpdateAgentField}
        onUpdateWorkflowContract={onUpdateWorkflowContract}
        onSetNodePosition={onSetNodePosition}
        onAutoLayout={onAutoLayout}
        dagEditorError={dagEditorError}
        onAddEdge={onAddEdge}
        onUpdateEdge={onUpdateEdge}
        onDeleteEdge={onDeleteEdge}
      />
    </div>
  );
}

function RunsView({ runs, onSelectWorkflow, onSelectRun, onDeleteRun }) {
  return (
    <section className="panel-surface">
      <div className="section-head">
        <h2>All Runs</h2>
        <span className="chip subtle-chip">{runs.length}</span>
      </div>
      <p className="surface-copy">
        Backend workflow run history with node statuses. Open a run to inspect live/recorded execution logs.
      </p>
      <RunsList runs={runs} onSelectWorkflow={onSelectWorkflow} onSelectRun={onSelectRun} onDeleteRun={onDeleteRun} />
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
          Workflow templates persist in local storage. Planner generation and workflow execution runs (status/logs/deliverables) are served by the backend API.
        </p>
        <div className="kv-grid">
          <div className="kv-card">
            <span>Storage</span>
            <strong>localStorage</strong>
          </div>
          <div className="kv-card">
            <span>DAG Editing</span>
            <strong>Interactive graph canvas</strong>
          </div>
          <div className="kv-card">
            <span>Agent Editing</span>
            <strong>Graph inspector panel</strong>
          </div>
          <div className="kv-card">
            <span>Runs</span>
            <strong>Backend runtime</strong>
          </div>
        </div>
      </section>

      <section className="panel-surface">
        <div className="section-head">
          <h2>Reset Demo Data</h2>
        </div>
        <p className="surface-copy">
          Clears locally saved workflow templates from this browser. Backend workflow run history is not deleted.
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
  const [wizardStep, setWizardStep] = useState('prompt');
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerError, setPlannerError] = useState('');
  const [draftPlan, setDraftPlan] = useState(null);
  const [draftInputModules, setDraftInputModules] = useState([]);
  const [draftOutputSpecs, setDraftOutputSpecs] = useState([]);

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
    setWizardStep('prompt');
    setPlannerLoading(false);
    setPlannerError('');
    setDraftPlan(null);
    setDraftInputModules([]);
    setDraftOutputSpecs([]);
  }, [open]);

  if (!open) return null;

  const setInputModuleField = (index, field, value) => {
    setDraftInputModules((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item))
    );
  };

  const addInputModule = (type = 'user_input') => {
    setDraftInputModules((prev) => {
      const nextIndex = prev.length + 1;
      return [
        ...prev,
        {
          id: `inputmod_new_${Date.now()}_${nextIndex}`,
          name: `input_${nextIndex}`,
          label: `Input ${nextIndex}`,
          type,
          required: true,
          description: '',
        },
      ];
    });
  };

  const removeInputModule = (index) => {
    setDraftInputModules((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const setOutputSpecField = (index, field, value) => {
    setDraftOutputSpecs((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item))
    );
  };

  const addOutputSpec = (type = 'markdown') => {
    setDraftOutputSpecs((prev) => {
      const nextIndex = prev.length + 1;
      return [
        ...prev,
        {
          id: `outputspec_new_${Date.now()}_${nextIndex}`,
          name: `deliverable_${nextIndex}`,
          label: `Deliverable ${nextIndex}`,
          type,
          description: '',
        },
      ];
    });
  };

  const removeOutputSpec = (index) => {
    setDraftOutputSpecs((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

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
      setDraftInputModules(normalizeInputModuleSpecs(normalized.input_modules || normalized.inputs, task));
      setDraftOutputSpecs(normalizeOutputSpecs(normalized.deliverable_specs || normalized.deliverables, task));
      setWizardStep('review');
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

    const inputModules = normalizeInputModuleSpecs(draftInputModules, task);
    const outputSpecs = normalizeOutputSpecs(draftOutputSpecs, task);

    onCreateWorkflow(task, draftPlan, {
      inputs: inputModules.map((item) => item.name),
      deliverables: outputSpecs.map((item) => item.name),
      inputModules,
      outputSpecs,
    });
    onClose();
  };

  const inferredInputCount = normalizeInputModuleSpecs(draftInputModules, taskInput.trim()).length;
  const inferredOutputCount = normalizeOutputSpecs(draftOutputSpecs, taskInput.trim()).length;
  const requiredInputCount = draftInputModules.filter((item) => item?.required !== false).length;
  const optionalInputCount = Math.max(0, draftInputModules.length - requiredInputCount);
  const inputTypeLabelByValue = Object.fromEntries(INPUT_MODULE_TYPE_OPTIONS.map((option) => [option.value, option.label]));
  const outputTypeLabelByValue = Object.fromEntries(OUTPUT_TYPE_OPTIONS.map((option) => [option.value, option.label]));

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
              Step 1: prompt the planner. Step 2: review and edit LLM-inferred inputs and outputs before saving.
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close new workflow dialog">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="wizard-stepbar" role="tablist" aria-label="Workflow creation steps">
            <button
              type="button"
              role="tab"
              aria-selected={wizardStep === 'prompt'}
              className={`wizard-step ${wizardStep === 'prompt' ? 'active' : ''}`}
              onClick={() => setWizardStep('prompt')}
            >
              1. Prompt
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={wizardStep === 'review'}
              className={`wizard-step ${wizardStep === 'review' ? 'active' : ''}`}
              onClick={() => {
                if (draftPlan) setWizardStep('review');
              }}
              disabled={!draftPlan}
            >
              2. Inputs & Outputs
            </button>
          </div>

          {wizardStep === 'prompt' ? (
            <form className="page-stack" onSubmit={handleGenerateWorkflow}>
              <label className="field-group" htmlFor="new-workflow-input">
                <span>Workflow Prompt</span>
                <textarea
                  id="new-workflow-input"
                  className="textarea"
                  rows={6}
                  value={taskInput}
                  onChange={(event) => {
                    setTaskInput(event.target.value);
                    if (draftPlan) {
                      setDraftPlan(null);
                      setDraftInputModules([]);
                      setDraftOutputSpecs([]);
                    }
                  }}
                  disabled={plannerLoading}
                  placeholder="Build an agent workflow to intake feature requests, gather product context, propose an implementation plan, review risks, and produce a launch checklist..."
                />
              </label>

              <div className="panel-surface compact-note-panel">
                <div className="section-head">
                  <h2>What Happens Next</h2>
                  <span className="chip subtle-chip">LLM-assisted</span>
                </div>
                <div className="stack-list compact-list">
                  <p className="surface-copy">The planner generates the DAG (agents + handoffs).</p>
                  <p className="surface-copy">Then it infers workflow-level inputs and outputs (deliverables).</p>
                  <p className="surface-copy">You review/edit the contract before saving the template.</p>
                </div>
              </div>

              <div className="modal-actions">
                <p className={plannerError ? 'error' : 'hint'} role={plannerError ? 'alert' : 'status'}>
                  {plannerError || 'Generate a draft to continue to the inputs/outputs review step.'}
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
          ) : null}

          {wizardStep === 'review' && draftPlan ? (
            <div className="modal-preview-grid">
              <section className="panel-surface modal-preview-panel contract-review-panel">
                <div className="contract-review-header">
                  <div className="contract-review-header-main">
                    <h2>Review Inputs & Outputs</h2>
                    <p className="surface-copy contract-review-copy">
                      Clean up the workflow contract before saving. Input and output names become machine-readable keys.
                    </p>
                  </div>
                  <div className="contract-review-header-actions">
                    <span className="chip subtle-chip">{plannerSourceLabel(draftPlan.generated_by)}</span>
                    <button type="button" className="button ghost button-compact" onClick={() => setWizardStep('prompt')}>
                      Back
                    </button>
                  </div>
                </div>

                <div className="contract-review-summary-card">
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

                  <div className="contract-review-metrics" aria-label="Draft workflow contract summary">
                    <div className="contract-review-metric">
                      <span>Agents</span>
                      <strong>{draftPlan.nodes.length}</strong>
                    </div>
                    <div className="contract-review-metric">
                      <span>Edges</span>
                      <strong>{draftPlan.edges.length}</strong>
                    </div>
                    <div className="contract-review-metric">
                      <span>Inputs</span>
                      <strong>{inferredInputCount}</strong>
                    </div>
                    <div className="contract-review-metric">
                      <span>Deliverables</span>
                      <strong>{inferredOutputCount}</strong>
                    </div>
                  </div>
                  <p className="hint contract-review-footnote">
                    Tip: keep names short and stable (for example `user_request`, `risk_summary`, `final_response`).
                  </p>
                </div>

                <div className="contract-editor-columns" aria-label="Workflow inputs and outputs editor">
                  <section className="contract-editor-pane" aria-labelledby="contract-inputs-title">
                    <div className="contract-editor-pane-head">
                      <div className="contract-editor-pane-title">
                        <p className="contract-label">Inputs</p>
                        <h3 id="contract-inputs-title">Input Modules</h3>
                        <p className="contract-editor-pane-copy">
                          {requiredInputCount} required
                          {optionalInputCount > 0 ? ` • ${optionalInputCount} optional` : ''}
                        </p>
                      </div>
                      <button type="button" className="button ghost button-compact" onClick={() => addInputModule()}>
                        Add Input
                      </button>
                    </div>

                    <div className="module-editor-list contract-editor-list">
                      {draftInputModules.map((module, index) => (
                        <article key={module.id || `${module.name}-${index}`} className="module-editor-card contract-editor-card">
                          <div className="module-editor-card-head">
                            <div className="module-editor-card-title">
                              <p className="module-editor-card-kicker">Input {index + 1}</p>
                              <code>{module.name || `input_${index + 1}`}</code>
                            </div>
                            <div className="module-editor-card-meta">
                              <span className="chip subtle-chip">
                                {inputTypeLabelByValue[module.type] || inputTypeLabelByValue.user_input}
                              </span>
                              <span className={`chip subtle-chip ${module.required !== false ? 'chip-positive' : ''}`}>
                                {module.required !== false ? 'Required' : 'Optional'}
                              </span>
                            </div>
                          </div>

                          <div className="module-editor-grid">
                            <div className="module-editor-row">
                              <label className="field-group">
                                <span>Name</span>
                                <input
                                  type="text"
                                  className="input"
                                  value={module.name || ''}
                                  onChange={(event) => setInputModuleField(index, 'name', event.target.value)}
                                  placeholder="user_request"
                                />
                              </label>
                              <label className="field-group">
                                <span>Type</span>
                                <select
                                  className="select"
                                  value={module.type || 'user_input'}
                                  onChange={(event) => setInputModuleField(index, 'type', event.target.value)}
                                >
                                  {INPUT_MODULE_TYPE_OPTIONS.map((option) => (
                                    <option key={`input-type-${option.value}`} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            <label className="field-group">
                              <span>Description</span>
                              <input
                                type="text"
                                className="input"
                                value={module.description || ''}
                                onChange={(event) => setInputModuleField(index, 'description', event.target.value)}
                                placeholder="What the user should provide"
                              />
                            </label>
                          </div>

                          <div className="module-editor-actions">
                            <label className="checkbox-inline">
                              <input
                                type="checkbox"
                                checked={module.required !== false}
                                onChange={(event) => setInputModuleField(index, 'required', event.target.checked)}
                              />
                              <span>Required</span>
                            </label>
                            <button
                              type="button"
                              className="button danger button-compact"
                              onClick={() => removeInputModule(index)}
                              disabled={draftInputModules.length <= 1}
                            >
                              Remove
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="contract-editor-pane" aria-labelledby="contract-outputs-title">
                    <div className="contract-editor-pane-head">
                      <div className="contract-editor-pane-title">
                        <p className="contract-label">Outputs</p>
                        <h3 id="contract-outputs-title">Deliverables</h3>
                        <p className="contract-editor-pane-copy">{draftOutputSpecs.length} LLM-inferred deliverables</p>
                      </div>
                      <button type="button" className="button ghost button-compact" onClick={() => addOutputSpec()}>
                        Add Output
                      </button>
                    </div>

                    <div className="module-editor-list contract-editor-list">
                      {draftOutputSpecs.map((output, index) => (
                        <article key={output.id || `${output.name}-${index}`} className="module-editor-card contract-editor-card">
                          <div className="module-editor-card-head">
                            <div className="module-editor-card-title">
                              <p className="module-editor-card-kicker">Deliverable {index + 1}</p>
                              <code>{output.name || `deliverable_${index + 1}`}</code>
                            </div>
                            <div className="module-editor-card-meta">
                              <span className="chip subtle-chip">
                                {outputTypeLabelByValue[output.type] || outputTypeLabelByValue.markdown}
                              </span>
                            </div>
                          </div>

                          <div className="module-editor-grid">
                            <div className="module-editor-row">
                              <label className="field-group">
                                <span>Name</span>
                                <input
                                  type="text"
                                  className="input"
                                  value={output.name || ''}
                                  onChange={(event) => setOutputSpecField(index, 'name', event.target.value)}
                                  placeholder="final_output"
                                />
                              </label>
                              <label className="field-group">
                                <span>Type</span>
                                <select
                                  className="select"
                                  value={output.type || 'markdown'}
                                  onChange={(event) => setOutputSpecField(index, 'type', event.target.value)}
                                >
                                  {OUTPUT_TYPE_OPTIONS.map((option) => (
                                    <option key={`output-type-${option.value}`} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            <label className="field-group">
                              <span>Description</span>
                              <input
                                type="text"
                                className="input"
                                value={output.description || ''}
                                onChange={(event) => setOutputSpecField(index, 'description', event.target.value)}
                                placeholder="What this workflow should produce"
                              />
                            </label>
                          </div>

                          <div className="module-editor-actions module-editor-actions-end">
                            <button
                              type="button"
                              className="button danger button-compact"
                              onClick={() => removeOutputSpec(index)}
                              disabled={draftOutputSpecs.length <= 1}
                            >
                              Remove
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              </section>

              <section className="panel-surface modal-preview-panel">
                <div className="section-head">
                  <h2>DAG + Save</h2>
                  <div className="inline-actions">
                    <span className="chip subtle-chip">Step 2</span>
                    <button type="button" className="button button-compact" onClick={handleCreate}>
                      Save Workflow
                    </button>
                  </div>
                </div>
                <p className="surface-copy">
                  Review the inferred contract, then save this template. You can continue editing the graph and contract later.
                </p>
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
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeIndex, setSelectedEdgeIndex] = useState(null);
  const [detailTab, setDetailTab] = useState('dag');
  const [workflowRunsTab, setWorkflowRunsTab] = useState('live');
  const [isNewWorkflowOpen, setIsNewWorkflowOpen] = useState(false);
  const [runWorkflowTargetId, setRunWorkflowTargetId] = useState(null);
  const [runModalLoading, setRunModalLoading] = useState(false);
  const [runModalError, setRunModalError] = useState('');
  const [workflows, setWorkflows] = useState(() => sortByNewest(loadStoredList(WORKFLOWS_STORAGE_KEY), 'updatedAt'));
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState('');
  const [selectedWorkflowRunId, setSelectedWorkflowRunId] = useState(null);
  const [selectedWorkflowRunDetail, setSelectedWorkflowRunDetail] = useState(null);
  const [dagEditorError, setDagEditorError] = useState('');
  const [uiNotice, setUiNotice] = useState('');

  useEffect(() => {
    saveStoredList(WORKFLOWS_STORAGE_KEY, workflows);
  }, [workflows]);

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
      setDetailTab('dag');
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
  const selectedWorkflowRunSummary = runs.find((run) => run.id === selectedWorkflowRunId) || null;
  const selectedWorkflowRun =
    selectedWorkflowRunDetail && selectedWorkflowRunDetail.id === selectedWorkflowRunId
      ? selectedWorkflowRunDetail
      : selectedWorkflowRunSummary;

  const refreshWorkflowRunList = async ({ silent = false } = {}) => {
    if (!silent) {
      setRunsLoading(true);
    }
    try {
      const nextRuns = sortByNewest(await listWorkflowRunsApi(150), 'startedAt');
      setRuns(nextRuns);
      setRunsError('');
      setSelectedWorkflowRunId((prev) => {
        if (prev && nextRuns.some((run) => run.id === prev)) return prev;
        return nextRuns[0]?.id || null;
      });
      return nextRuns;
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : 'Failed to load workflow runs');
      return null;
    } finally {
      if (!silent) {
        setRunsLoading(false);
      }
    }
  };

  const refreshWorkflowRunDetail = async (runId, { silent = true } = {}) => {
    if (!runId) return null;
    if (!silent) {
      setRunsLoading(true);
    }
    try {
      const detail = await getWorkflowRunApi(runId);
      setSelectedWorkflowRunDetail(detail);
      setRuns((prev) => {
        const merged = prev.some((run) => run.id === detail.id)
          ? prev.map((run) => (run.id === detail.id ? { ...run, ...detail, logs: run.logs, nodeRuns: run.nodeRuns } : run))
          : [detail, ...prev];
        return sortByNewest(
          merged.map((run) =>
            run.id === detail.id
              ? {
                  ...run,
                  workflowId: detail.workflowId,
                  workflowName: detail.workflowName,
                  status: detail.status,
                  startedAt: detail.startedAt,
                  finishedAt: detail.finishedAt,
                  durationMs: detail.durationMs,
                  activeNodeId: detail.activeNodeId,
                  progress: detail.progress,
                  outputSummary: detail.outputSummary,
                  error: detail.error,
                  nodeRuns: detail.nodeRuns,
                }
              : run
          ),
          'startedAt'
        );
      });
      setRunsError('');
      return detail;
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : 'Failed to load workflow run');
      return null;
    } finally {
      if (!silent) {
        setRunsLoading(false);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    let fetching = false;

    const tick = async (silent) => {
      if (fetching) return;
      fetching = true;
      try {
        await refreshWorkflowRunList({ silent });
        if (cancelled) return;
      } finally {
        fetching = false;
      }
    };

    tick(false);
    const intervalMs = activeSection === 'workflowRuns' ? 1000 : 2500;
    const timer = window.setInterval(() => {
      tick(true);
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSection]);

  useEffect(() => {
    if (!selectedWorkflowRunId) {
      setSelectedWorkflowRunDetail(null);
      return undefined;
    }

    let disposed = false;
    let fetching = false;
    const tick = async (silent) => {
      if (fetching) return;
      fetching = true;
      try {
        const detail = await refreshWorkflowRunDetail(selectedWorkflowRunId, { silent });
        if (disposed || !detail) return;
      } finally {
        fetching = false;
      }
    };

    const currentStatus = selectedWorkflowRun?.status || '';
    tick(false);
    const intervalMs = isActiveRunStatus(currentStatus) || activeSection === 'workflowRuns' ? 900 : 3000;
    const timer = window.setInterval(() => {
      tick(true);
    }, intervalMs);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [selectedWorkflowRunId, selectedWorkflowRun?.status, activeSection]);

  useEffect(() => {
    if (!selectedWorkflow) {
      setSelectedNodeId(null);
      setSelectedEdgeIndex(null);
      return;
    }

    const nodes = Array.isArray(selectedWorkflow.nodes) ? selectedWorkflow.nodes : [];
    const nextNodeId = nodes.some((node) => node.id === selectedNodeId)
      ? selectedNodeId
      : nodes[0]?.id || null;

    if (nextNodeId !== selectedNodeId) {
      setSelectedNodeId(nextNodeId);
    }
    const edgeCount = Array.isArray(selectedWorkflow.edges) ? selectedWorkflow.edges.length : 0;
    if (!Number.isInteger(selectedEdgeIndex) || selectedEdgeIndex < 0 || selectedEdgeIndex >= edgeCount) {
      if (selectedEdgeIndex !== null) {
        setSelectedEdgeIndex(null);
      }
    }
  }, [selectedWorkflow, selectedNodeId, selectedEdgeIndex]);

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
            inputs: Array.isArray(workflow.inputs) ? [...workflow.inputs] : [],
            deliverables: Array.isArray(workflow.deliverables) ? [...workflow.deliverables] : [],
            inputModules: Array.isArray(workflow.inputModules)
              ? workflow.inputModules.map((item) => ({ ...(item || {}) }))
              : [],
            outputSpecs: Array.isArray(workflow.outputSpecs)
              ? workflow.outputSpecs.map((item) => ({ ...(item || {}) }))
              : [],
            nodePositions: normalizeNodePositionsMap(workflow.nodePositions),
          };
          const next = updater(cloned) || cloned;
          return {
            ...next,
            nodePositions: normalizeNodePositionsMap(next.nodePositions),
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
    setSelectedNodeId(null);
    setSelectedEdgeIndex(null);
    setDetailTab('dag');
    setDagEditorError('');
  };

  const handleDeleteWorkflow = (workflowId) => {
    const workflow = workflows.find((candidate) => candidate.id === workflowId);
    if (!workflow) return;

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(`Delete workflow template "${workflow.name}"? This removes it from local templates only.`);
    if (!confirmed) return;

    setWorkflows((prev) => prev.filter((item) => item.id !== workflowId));
    setDagEditorError('');
    setSelectedEdgeIndex(null);
    setSelectedNodeId(null);
    setRunWorkflowTargetId((prev) => (prev === workflowId ? null : prev));
    setUiNotice(`Deleted ${workflow.name}`);
  };

  const handleSelectWorkflowRun = (runId) => {
    setSelectedWorkflowRunId(runId);
    setActiveSection('workflowRuns');
    setWorkflowRunsTab('runs');
  };

  const handleOpenWorkflowsMonitor = () => {
    setActiveSection('workflowRuns');
    setWorkflowRunsTab('runs');
    if (!selectedWorkflowRunId && runs[0]?.id) {
      setSelectedWorkflowRunId(runs[0].id);
    }
  };

  const handleSelectWorkflowForLive = (workflowId) => {
    if (!workflowId) {
      setRunWorkflowTargetId(null);
      return;
    }
    setRunWorkflowTargetId(workflowId);
    setSelectedWorkflowId(workflowId);
  };

  const handleSelectNode = (nodeId) => {
    setSelectedEdgeIndex(null);
    setSelectedNodeId(nodeId);
  };

  const handleSelectEdge = (edgeIndex) => {
    setSelectedEdgeIndex(edgeIndex);
    if (edgeIndex !== null) {
      setSelectedNodeId(null);
    }
  };

  const handleCreateWorkflow = (task, draftPlan, contract = {}) => {
    const normalized = normalizePlannerPlan(draftPlan, task);
    const validation = graphValidationError(normalized.nodes, normalized.edges);
    if (validation) {
      normalized.warnings = [...(normalized.warnings || []), validation];
    }

    const now = new Date().toISOString();
    const inputModules = normalizeInputModuleSpecs(
      contract.inputModules || draftPlan.input_modules || [],
      task
    );
    const outputSpecs = normalizeOutputSpecs(
      contract.outputSpecs || draftPlan.deliverable_specs || [],
      task
    );
    const workflow = {
      id: generateId('wf'),
      name: inferWorkflowName(task, normalized),
      prompt: task,
      summary: normalized.summary,
      generatedBy: normalized.generated_by,
      warnings: normalized.warnings || [],
      inputs:
        Array.isArray(contract.inputs) && contract.inputs.length > 0
          ? contract.inputs
          : inputModules.map((item) => item.name),
      deliverables:
        Array.isArray(contract.deliverables) && contract.deliverables.length > 0
          ? contract.deliverables
          : outputSpecs.map((item) => item.name),
      inputModules,
      outputSpecs,
      nodes: normalized.nodes,
      edges: normalized.edges,
      nodePositions: buildAutoNodePositions(normalized.nodes, normalized.edges),
      version: 1,
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: 'draft',
    };

    setWorkflows((prev) => sortByNewest([workflow, ...prev], 'updatedAt'));
    setSelectedWorkflowId(workflow.id);
    setSelectedNodeId(workflow.nodes[0]?.id || null);
    setSelectedEdgeIndex(null);
    setActiveSection('workflows');
    setDetailTab('dag');
    setDagEditorError('');
    setUiNotice(`Created ${workflow.name}`);
  };

  const handleUpdateWorkflowContract = (contractPatch) => {
    if (!selectedWorkflow) return;
    setWorkflowFields(selectedWorkflow.id, (workflow) => ({
      ...workflow,
      inputs: Array.isArray(contractPatch?.inputs) ? contractPatch.inputs : Array.isArray(workflow.inputs) ? workflow.inputs : [],
      deliverables: Array.isArray(contractPatch?.deliverables)
        ? contractPatch.deliverables
        : Array.isArray(workflow.deliverables)
          ? workflow.deliverables
          : [],
      inputModules: Array.isArray(contractPatch?.inputs)
        ? normalizeInputModuleSpecs(
            contractPatch.inputs.map((name, index) => {
              const existing = Array.isArray(workflow.inputModules) ? workflow.inputModules[index] : null;
              return {
                ...(existing || {}),
                name,
              };
            }),
            workflow.prompt || workflow.summary || ''
          )
        : Array.isArray(workflow.inputModules)
          ? workflow.inputModules
          : [],
      outputSpecs: Array.isArray(contractPatch?.deliverables)
        ? normalizeOutputSpecs(
            contractPatch.deliverables.map((name, index) => {
              const existing = Array.isArray(workflow.outputSpecs) ? workflow.outputSpecs[index] : null;
              return {
                ...(existing || {}),
                name,
              };
            }),
            workflow.prompt || workflow.summary || ''
          )
        : Array.isArray(workflow.outputSpecs)
          ? workflow.outputSpecs
          : [],
    }));
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

    const nextEdges = [...(selectedWorkflow.edges || []), coerceWorkflowEdge({ source, target, handoff: edge?.handoff })];
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
        ...coerceWorkflowEdge(edge, { preserveEmptyHandoffFields: true }),
      })),
      'DAG updated'
    );
  };

  const handleDeleteEdge = (edgeIndex) => {
    if (!selectedWorkflow) return;
    const nextEdges = (selectedWorkflow.edges || []).filter((_, index) => index !== edgeIndex);
    setSelectedEdgeIndex((prev) => {
      if (!Number.isInteger(prev)) return null;
      if (prev === edgeIndex) return null;
      if (prev > edgeIndex) return prev - 1;
      return prev;
    });
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

    const existingPositions = normalizeNodePositionsMap(selectedWorkflow.nodePositions);
    const existingCoords = Object.values(existingPositions);
    const nextX =
      existingCoords.length > 0
        ? Math.max(...existingCoords.map((position) => Number(position.x) || 0)) + 340
        : 80;
    const nextY =
      existingCoords.length > 0
        ? 80 + ((selectedWorkflow.nodes?.length || 0) % 3) * 160
        : 80;

    setWorkflowFields(selectedWorkflow.id, (workflow) => ({
      ...workflow,
      nodes: [...(workflow.nodes || []), newNode],
      nodePositions: {
        ...normalizeNodePositionsMap(workflow.nodePositions),
        [id]: { x: Math.round(nextX), y: Math.round(nextY) },
      },
    }));
    setSelectedNodeId(id);
    setSelectedEdgeIndex(null);
    setDetailTab('dag');
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
      nodePositions: Object.fromEntries(
        Object.entries(normalizeNodePositionsMap(workflow.nodePositions)).filter(([id]) => id !== nodeId)
      ),
    }));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(nextNodes[0]?.id || null);
    }
    setSelectedEdgeIndex(null);
    setUiNotice('Agent removed');
  };

  const handleUpdateAgentField = (nodeId, field, value) => {
    if (!selectedWorkflow) return;
    setSelectedEdgeIndex(null);
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

  const handleSetNodePosition = (nodeId, position) => {
    if (!selectedWorkflow || !nodeId || !position) return;
    setWorkflowFields(selectedWorkflow.id, (workflow) => ({
      ...workflow,
      nodePositions: {
        ...normalizeNodePositionsMap(workflow.nodePositions),
        [nodeId]: {
          x: Math.max(12, Math.round(Number(position.x) || 0)),
          y: Math.max(12, Math.round(Number(position.y) || 0)),
        },
      },
    }));
  };

  const handleAutoLayout = () => {
    if (!selectedWorkflow) return;
    setSelectedEdgeIndex(null);
    setWorkflowFields(selectedWorkflow.id, (workflow) => ({
      ...workflow,
      nodePositions: buildAutoNodePositions(workflow.nodes || [], workflow.edges || []),
    }));
    setDagEditorError('');
    setUiNotice('Auto layout applied');
  };

  useEffect(() => {
    if (!selectedWorkflow || selectedEdgeIndex === null || activeSection !== 'workflows' || detailTab !== 'dag') {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.defaultPrevented) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          target.isContentEditable ||
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT'
        ) {
          return;
        }
      }

      event.preventDefault();
      handleDeleteEdge(selectedEdgeIndex);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedWorkflow, selectedEdgeIndex, activeSection, detailTab, handleDeleteEdge]);

  const handleRunWorkflow = (workflowId) => {
    const workflow = workflows.find((candidate) => candidate.id === workflowId);
    if (!workflow) return;

    const validation = graphValidationError(workflow.nodes, workflow.edges || []);
    if (validation) {
      setDagEditorError(validation);
      setActiveSection('workflows');
      setSelectedWorkflowId(workflowId);
      setSelectedEdgeIndex(null);
      setDetailTab('dag');
      return;
    }
    setRunWorkflowTargetId(workflowId);
    setRunModalError('');
    setActiveSection('workflowRuns');
    setWorkflowRunsTab('live');
    setSelectedWorkflowId(workflowId);
    if (selectedWorkflowId === workflowId) {
      setDetailTab('dag');
    }
  };

  const handleSubmitRunWorkflow = async (runConfig) => {
    const targetWorkflowId =
      ensureString(runConfig?.workflowId, '').trim() || ensureString(runWorkflowTargetId, '').trim();
    if (!targetWorkflowId || runModalLoading) return null;

    const workflow = workflows.find((candidate) => candidate.id === targetWorkflowId);
    if (!workflow) {
      setRunModalError('Workflow template not found.');
      return null;
    }

    const requestedDeliverables = Array.isArray(runConfig?.requestedDeliverables) ? runConfig.requestedDeliverables : [];
    const workflowDeliverables = Array.isArray(workflow.deliverables) ? workflow.deliverables.filter(Boolean) : [];
    const mergedDeliverables = [...requestedDeliverables];
    for (const item of workflowDeliverables) {
      if (!mergedDeliverables.includes(item)) {
        mergedDeliverables.push(item);
      }
    }

    const baseInputs = runConfig?.inputs && typeof runConfig.inputs === 'object' ? runConfig.inputs : {};
    const workflowInputModules = normalizeInputModuleSpecs(
      workflow.inputModules || workflow.inputs || [],
      workflow.prompt || workflow.summary || ''
    );
    const missingRequired = listMissingRequiredInputs(workflowInputModules, baseInputs);
    if (missingRequired.length > 0) {
      setRunModalError(`Missing required inputs: ${missingRequired.map((item) => item.label || item.name).join(', ')}`);
      return null;
    }

    const workflowInputs = Array.isArray(workflow.inputs) && workflow.inputs.length > 0
      ? workflow.inputs
      : workflowInputModules.map((item) => item.name);
    const inputContract = Object.fromEntries(
      workflowInputs.map((name) => [
        name,
        Object.prototype.hasOwnProperty.call(baseInputs, name) ? baseInputs[name] : '',
      ])
    );

    setRunModalLoading(true);
    setRunModalError('');

    try {
      const startedRun = await createWorkflowRunApi({
        template: serializeWorkflowTemplateForRun(workflow),
        inputs: {
          ...inputContract,
          ...baseInputs,
          workflowTemplateInputs: workflowInputs,
        },
        requested_deliverables: mergedDeliverables,
      });

      setRuns((prev) => sortByNewest([startedRun, ...prev.filter((item) => item.id !== startedRun.id)], 'startedAt'));
      setSelectedWorkflowRunId(startedRun.id);
      setSelectedWorkflowRunDetail(startedRun);
      setActiveSection('workflowRuns');
      setWorkflowRunsTab(runConfig?.source === 'runs' ? 'runs' : 'live');
      setRunWorkflowTargetId(workflow.id);
      setSelectedWorkflowId(workflow.id);
      setUiNotice(`Started ${workflow.name}`);

      setWorkflows((prev) =>
        sortByNewest(
          prev.map((item) =>
            item.id === workflow.id
              ? {
                  ...item,
                  updatedAt: new Date().toISOString(),
                  lastRunAt: startedRun.startedAt || startedRun.createdAt || new Date().toISOString(),
                  lastRunStatus: startedRun.status || 'queued',
                  runCount: (item.runCount || 0) + 1,
                }
              : item
          ),
          'updatedAt'
        )
      );

      void refreshWorkflowRunList({ silent: true });
      return startedRun;
    } catch (err) {
      setRunModalError(err instanceof Error ? err.message : 'Failed to start workflow run');
      return null;
    } finally {
      setRunModalLoading(false);
    }
  };

  const handleCancelWorkflowRun = async (runId) => {
    if (!runId) return;
    try {
      const updated = await cancelWorkflowRunApi(runId);
      setSelectedWorkflowRunDetail((prev) => (prev?.id === runId ? updated : prev));
      setRuns((prev) => sortByNewest(prev.map((run) => (run.id === runId ? { ...run, ...updated } : run)), 'startedAt'));
      setUiNotice(`Cancellation requested for ${updated.workflowName || 'workflow run'}`);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : 'Failed to cancel workflow run');
    }
  };

  const handleDeleteWorkflowRun = async (runId) => {
    if (!runId) return;
    const run = runs.find((item) => item.id === runId) || (selectedWorkflowRunDetail?.id === runId ? selectedWorkflowRunDetail : null);
    if (!run) return;

    if (isActiveRunStatus(run.status)) {
      setRunsError('Cancel the workflow run before deleting it.');
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(`Delete workflow run "${run.workflowName || run.id}"? This removes it from backend run history.`);
    if (!confirmed) return;

    try {
      const deleted = await deleteWorkflowRunApi(runId);
      const remainingRuns = runs.filter((item) => item.id !== runId);
      setRuns(remainingRuns);
      setSelectedWorkflowRunDetail((prev) => (prev?.id === runId ? null : prev));
      setSelectedWorkflowRunId((prev) => (prev === runId ? remainingRuns[0]?.id || null : prev));
      setRunsError('');
      setUiNotice(`Deleted run ${deleted.run?.id || runId}`);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : 'Failed to delete workflow run');
    }
  };

  const handleResetDemoData = () => {
    saveStoredList(RUNS_STORAGE_KEY, []);
    setWorkflows([]);
    setSelectedWorkflowId(null);
    setSelectedNodeId(null);
    setSelectedEdgeIndex(null);
    setWorkflowRunsTab('live');
    setRunWorkflowTargetId(null);
    setRunModalError('');
    setSelectedWorkflowRunId(null);
    setSelectedWorkflowRunDetail(null);
    setDetailTab('dag');
    setDagEditorError('');
    setUiNotice('Cleared local workflow templates');
  };

  const pageTitle =
    activeSection === 'dashboard'
      ? 'Dashboard'
      : activeSection === 'workflows'
        ? selectedWorkflow?.name || 'Workflow Creator'
        : activeSection === 'workflowRuns'
          ? workflowRunsTab === 'live'
            ? workflows.find((workflow) => workflow.id === runWorkflowTargetId)?.name ||
              selectedWorkflow?.name ||
              'Workflows & Runs'
            : selectedWorkflowRun?.workflowName || 'Workflows & Runs'
          : activeSection === 'settings'
            ? 'Settings'
            : 'Workspace';

  const pageSubtitle =
    activeSection === 'dashboard'
      ? 'Create and manage agent workflows generated from natural language prompts.'
      : activeSection === 'workflows'
        ? 'Inspect and edit workflow templates, graphs, agents, and contracts directly on the canvas.'
        : activeSection === 'workflowRuns'
          ? workflowRunsTab === 'live'
            ? 'Gather inputs and documents before launch, then watch deliverables populate in a live file viewer.'
            : 'Monitor live backend workflow execution, agent status, and categorized logs.'
          : activeSection === 'settings'
            ? 'Configure local demo storage and frontend runtime behavior.'
            : 'Workspace';

  return (
    <section className="home-shell" aria-labelledby="home-title">
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
                {tab.id === 'workflowRuns' ? <small>{runs.length}</small> : null}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-session">
              <span className="chip subtle-chip">authenticated</span>
              <p className="sidebar-footnote">Templates are local. Workflow run execution/logs come from the backend runtime.</p>
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
            {uiNotice ? (
              <div className="workspace-actions">
                <p className="inline-toast">{uiNotice}</p>
              </div>
            ) : null}
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
                onDeleteWorkflow={handleDeleteWorkflow}
                onSelectRun={handleSelectWorkflowRun}
                onOpenWorkflowsMonitor={handleOpenWorkflowsMonitor}
                onSelectDetailTab={setDetailTab}
                selectedNodeId={selectedNodeId}
                selectedEdgeIndex={selectedEdgeIndex}
                onSelectNode={handleSelectNode}
                onSelectEdge={handleSelectEdge}
                onAddAgent={handleAddAgent}
                onDeleteAgent={handleDeleteAgent}
                onUpdateAgentField={handleUpdateAgentField}
                onUpdateWorkflowContract={handleUpdateWorkflowContract}
                onSetNodePosition={handleSetNodePosition}
                onAutoLayout={handleAutoLayout}
                dagEditorError={dagEditorError}
                onAddEdge={handleAddEdge}
                onUpdateEdge={handleUpdateEdge}
                onDeleteEdge={handleDeleteEdge}
              />
            ) : null}

            {activeSection === 'workflowRuns' ? (
              <WorkflowRunsWorkspaceView
                activeTab={workflowRunsTab}
                onSelectTab={setWorkflowRunsTab}
                workflows={workflows}
                preferredWorkflowId={runWorkflowTargetId || selectedWorkflowId}
                runs={runs}
                selectedRun={selectedWorkflowRun}
                selectedRunId={selectedWorkflowRunId}
                runsLoading={runsLoading}
                runsError={runsError}
                startLoading={runModalLoading}
                startError={runModalError}
                onStartRun={handleSubmitRunWorkflow}
                onSelectRun={handleSelectWorkflowRun}
                onRefreshRunList={() => refreshWorkflowRunList({ silent: false })}
                onRefreshRun={(runId) => refreshWorkflowRunDetail(runId, { silent: false })}
                onCancelRun={handleCancelWorkflowRun}
                onDeleteRun={handleDeleteWorkflowRun}
                onOpenTemplate={handleSelectWorkflow}
                onSelectWorkflowForLive={handleSelectWorkflowForLive}
                onClearStartError={() => setRunModalError('')}
              />
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
