const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const path = require('path');

// ── Lib imports ─────────────────────────────────────────────
const { LineBuffer, RawBuffer } = require('./lib/ring-buffer');
const { stripAnsi, detectStatus, extractContextPct, extractStructuredEvents } = require('./lib/status-detect');
const { SSEManager } = require('./lib/sse');
const { evaluatePermission, getDefaultRules, createEvaluateMiddleware } = require('./lib/permissions');
const { TaskDAG } = require('./lib/task-dag');
const { selectTerminal } = require('./lib/scheduler');
const { CircuitBreaker, RetryBudget, Supervisor, classifyError } = require('./lib/resilience');
const { writeWorkerSettings } = require('./lib/settings-gen');
const { rateTools } = require('./lib/tool-rater');
const { parsePlaybooks, getPlaybookUsage, promotePlaybooks } = require('./lib/playbook-tracker');
const { isImmutable, safeWrite, safeAppend } = require('./lib/safe-file-writer');
const { logEvolution } = require('./lib/evolution-writer');

// ── Config ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3300;
const DEFAULT_TERMINALS = parseInt(process.env.DEFAULT_TERMINALS || '4', 10);
const CLAUDE_CMD = process.env.CLAUDE_CMD || 'claude --dangerously-skip-permissions';
const SHELL = process.env.SHELL || '/bin/zsh';
const PROJECT_DIR = __dirname;
const DEFAULT_CWD = process.env.DEFAULT_CWD || null;  // Set to target project path to avoid cross-project prompts

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Express + WS ────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Global State ────────────────────────────────────────────
let nextId = 1;
const terminals = new Map();

const sse = new SSEManager();
const taskDag = new TaskDAG();
const retryBudget = new RetryBudget();
const supervisor = new Supervisor();

// ── Helpers ─────────────────────────────────────────────────

function getElapsed(terminal) {
  if (!terminal.taskStartedAt) return null;
  const ms = Date.now() - terminal.taskStartedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/**
 * Return permission rules for a terminal, used by the evaluate middleware.
 */
function getTerminalRules(terminalId) {
  const terminal = terminals.get(parseInt(terminalId, 10));
  if (!terminal) return null;

  // Build rules from the terminal's assigned scope
  if (terminal.scope && terminal.scope.length > 0) {
    // Merge default rules for each scope directory
    const combined = { allow: [], deny: [], ask: [] };
    for (const s of terminal.scope) {
      const rules = getDefaultRules(s);
      combined.allow.push(...rules.allow);
      combined.deny.push(...rules.deny);
      combined.ask.push(...rules.ask);
    }
    // Deduplicate
    combined.allow = [...new Set(combined.allow)];
    combined.deny = [...new Set(combined.deny)];
    combined.ask = [...new Set(combined.ask)];
    return combined;
  }

  // Unrestricted terminal — use broad defaults
  return getDefaultRules(PROJECT_DIR);
}

// ── Terminal Spawning ───────────────────────────────────────

function spawnTerminal(label, scope = [], cwd = null) {
  const id = nextId++;
  const cols = 120;
  const rows = 30;

  // Resolve working directory — custom cwd or default to PROJECT_DIR
  const workDir = cwd || PROJECT_DIR;
  const settingsDir = cwd || PROJECT_DIR;

  // Write worker settings to the TARGET project (not ninja-terminal)
  try {
    writeWorkerSettings(id, settingsDir, scope, { port: PORT });
  } catch (e) {
    console.error(`Failed to write worker settings for terminal ${id}:`, e.message);
  }

  // Clean env — strip any existing Claude vars to avoid conflicts
  const cleanEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'CLAUDECODE' && !k.startsWith('CLAUDE_')) {
      cleanEnv[k] = v;
    }
  }

  const ptyProcess = pty.spawn(SHELL, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: workDir,
    env: {
      ...cleanEnv,
      TERM: 'xterm-256color',
      HOME: require('os').homedir(),
      PATH: `${require('os').homedir()}/.local/bin:/opt/homebrew/bin:${process.env.PATH || ''}`,
      SHELL_SESSIONS_DISABLE: '1',
      NINJA_TERMINAL_ID: String(id),
    },
  });

  // After shell starts, cd to work dir and launch claude
  setTimeout(() => {
    ptyProcess.write(`cd "${workDir}" && ${CLAUDE_CMD}\r`);
  }, 500);

  const terminal = {
    id,
    label: label || `T${id}`,
    pty: ptyProcess,
    clients: new Set(),
    status: 'starting',
    startedAt: Date.now(),
    taskStartedAt: Date.now(),
    lastActivity: Date.now(),
    rawBuffer: new RawBuffer(65536),
    lineBuffer: new LineBuffer(1000),
    structuredLog: [],
    cols,
    rows,
    taskName: null,
    progress: null,
    scope: Array.isArray(scope) ? scope : (scope ? [scope] : []),
    cwd: workDir,
    previousFiles: [],
    lastTaskCompletedAt: null,
    circuitBreaker: new CircuitBreaker(id),
  };

  // ── PTY data handler ──────────────────────────────────────
  ptyProcess.onData((data) => {
    terminal.lastActivity = Date.now();
    terminal.rawBuffer.push(data);

    // Strip ANSI, split into lines, push to line buffer
    const stripped = stripAnsi(data);
    const lines = stripped.split('\n').filter(l => l.trim());
    for (const line of lines) {
      terminal.lineBuffer.push(line);
    }

    // Extract structured events
    const events = extractStructuredEvents(lines, terminal.label);
    for (const evt of events) {
      terminal.structuredLog.push(evt);
      if (terminal.structuredLog.length > 500) terminal.structuredLog.shift();
      sse.broadcast(evt.type, evt);
    }

    // Broadcast raw to WebSocket clients
    for (const ws of terminal.clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminal.status = 'exited';
    console.log(`Terminal ${id} exited with code ${exitCode}`);
    sse.broadcast('status_change', {
      terminal: terminal.label,
      id: terminal.id,
      from: terminal.status,
      to: 'exited',
      elapsed: getElapsed(terminal),
    });
  });

  terminals.set(id, terminal);
  console.log(`Spawned terminal ${id} (${terminal.label})${scope.length ? ` scope: ${scope}` : ''}`);
  return terminal;
}

// ── Status Detection Loop (2s) ──────────────────────────────

setInterval(() => {
  for (const [, terminal] of terminals) {
    if (terminal.status === 'exited') continue;
    const prev = terminal.status;
    const recentLines = terminal.lineBuffer.last(50);
    const newStatus = detectStatus(recentLines);

    if (newStatus !== prev) {
      terminal.status = newStatus;
      sse.broadcast('status_change', {
        terminal: terminal.label,
        id: terminal.id,
        from: prev,
        to: newStatus,
        elapsed: getElapsed(terminal),
      });

      // Track task timing
      if (newStatus === 'working' && prev !== 'working') {
        terminal.taskStartedAt = Date.now();
      }
      if (newStatus === 'done' || newStatus === 'idle') {
        terminal.taskStartedAt = null;
        if (newStatus === 'done') {
          terminal.lastTaskCompletedAt = Date.now();
          terminal.circuitBreaker.recordSuccess();
        }
      }
      if (newStatus === 'error') {
        terminal.circuitBreaker.recordFailure();
      }
    }

    // Context window check
    const ctx = extractContextPct(recentLines);
    if (ctx && ctx > 80) {
      sse.broadcast('context_low', {
        terminal: terminal.label,
        id: terminal.id,
        usage: ctx,
        threshold: 80,
      });
    }
  }
}, 2000);

// ── WebSocket Upgrade ───────────────────────────────────────

server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/ws\/(\d+)$/);
  if (!match) {
    socket.destroy();
    return;
  }

  const id = parseInt(match[1], 10);
  const terminal = terminals.get(id);
  if (!terminal || terminal.status === 'exited') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    terminal.clients.add(ws);

    // Send buffered raw output so client catches up
    const buffered = terminal.rawBuffer.getAll();
    if (buffered) {
      ws.send(buffered);
    }

    ws.on('message', (msg) => {
      const data = msg.toString();
      // Check for resize message
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          const c = Math.max(1, Math.min(500, parsed.cols));
          const r = Math.max(1, Math.min(200, parsed.rows));
          terminal.pty.resize(c, r);
          terminal.cols = c;
          terminal.rows = r;
          return;
        }
      } catch { /* not JSON, treat as input */ }
      terminal.pty.write(data);
    });

    ws.on('close', () => {
      terminal.clients.delete(ws);
    });
  });
});

// ── API Routes ──────────────────────────────────────────────

// Health
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    terminals: terminals.size,
    sseClients: sse.clientCount,
    uptime: process.uptime(),
  });
});

// List terminals
app.get('/api/terminals', (req, res) => {
  const list = [];
  for (const [, t] of terminals) {
    const recentLines = t.lineBuffer.last(50);
    const entry = {
      id: t.id,
      label: t.label,
      status: t.status,
      elapsed: getElapsed(t),
      contextPct: extractContextPct(recentLines),
      cols: t.cols,
      rows: t.rows,
      taskName: t.taskName,
      progress: t.progress,
      scope: t.scope,
    };
    if (req.query.debug) {
      entry.lastLines = recentLines.slice(-10);
    }
    list.push(entry);
  }
  res.json(list);
});

// Spawn terminal
app.post('/api/terminals', (req, res) => {
  try {
    const label = req.body?.label;
    const scope = req.body?.scope || [];
    const cwd = req.body?.cwd || null;
    const terminal = spawnTerminal(label, scope, cwd);
    res.json({ id: terminal.id, label: terminal.label, status: terminal.status, scope: terminal.scope, cwd: terminal.cwd });
  } catch (err) {
    res.status(500).json({ error: 'Failed to spawn terminal', detail: err.message });
  }
});

// Delete terminal
app.delete('/api/terminals/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  terminal.pty.kill();
  for (const ws of terminal.clients) ws.close();
  terminals.delete(id);
  res.json({ ok: true });
});

// Restart terminal
app.post('/api/terminals/:id/restart', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  const label = terminal.label;
  const scope = terminal.scope;
  const termCwd = terminal.cwd;
  terminal.pty.kill();
  for (const ws of terminal.clients) ws.close();
  terminals.delete(id);

  const newTerminal = spawnTerminal(label, scope, termCwd);
  res.json({ id: newTerminal.id, label: newTerminal.label, status: newTerminal.status });
});

// Send input
app.post('/api/terminals/:id/input', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  const text = req.body?.text;
  if (!text) return res.status(400).json({ error: 'text required' });

  terminal.pty.write(text);
  res.json({ ok: true });
});

// Set label
app.post('/api/terminals/:id/label', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  terminal.label = req.body?.label || terminal.label;
  res.json({ ok: true, label: terminal.label });
});

// Get status
app.get('/api/terminals/:id/status', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  const recentLines = terminal.lineBuffer.last(50);
  res.json({
    id: terminal.id,
    label: terminal.label,
    status: terminal.status,
    elapsed: getElapsed(terminal),
    contextPct: extractContextPct(recentLines),
    taskName: terminal.taskName,
    progress: terminal.progress,
    scope: terminal.scope,
  });
});

// Paginated output
app.get('/api/terminals/:id/output', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  const lines = parseInt(req.query.lines) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const result = terminal.lineBuffer.slice(offset, lines);
  res.json(result);
});

// Structured log
app.get('/api/terminals/:id/log', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  res.json(terminal.structuredLog);
});

// Graceful kill
app.post('/api/terminals/:id/kill', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  if (terminal.status === 'exited') {
    return res.json({ ok: true, message: 'Already exited' });
  }

  // Graduated: SIGINT -> wait 5s -> SIGTERM -> wait 3s -> SIGKILL
  terminal.pty.kill('SIGINT');
  await sleep(5000);
  if (terminal.status !== 'exited') {
    terminal.pty.kill('SIGTERM');
    await sleep(3000);
    if (terminal.status !== 'exited') {
      terminal.pty.kill('SIGKILL');
    }
  }
  res.json({ ok: true });
});

// Permission evaluation hook endpoint
app.post('/api/terminals/:id/evaluate', createEvaluateMiddleware(getTerminalRules));

// Worker stopped hook endpoint
app.post('/api/terminals/:id/stopped', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  console.log(`Terminal ${id} (${terminal.label}) stopped via hook`);
  sse.broadcast('worker_stopped', {
    terminal: terminal.label,
    id: terminal.id,
    ts: new Date().toISOString(),
  });

  res.json({ ok: true });
});

// Context compacted hook endpoint
app.post('/api/terminals/:id/compacted', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  console.log(`Terminal ${id} (${terminal.label}) context compacted`);
  sse.broadcast('context_compacted', {
    terminal: terminal.label,
    id: terminal.id,
    ts: new Date().toISOString(),
  });

  res.json({ ok: true });
});

// Assign task to terminal
app.post('/api/terminals/:id/task', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const terminal = terminals.get(id);
  if (!terminal) return res.status(404).json({ error: 'Not found' });

  const { name, description, scope } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });

  terminal.taskName = name;
  terminal.progress = null;
  terminal.taskStartedAt = Date.now();

  if (scope) {
    terminal.scope = Array.isArray(scope) ? scope : [scope];
  }

  sse.broadcast('task_assigned', {
    terminal: terminal.label,
    id: terminal.id,
    taskName: name,
    description: description || null,
    scope: terminal.scope,
    ts: new Date().toISOString(),
  });

  // Send the task as input to the terminal
  if (description) {
    terminal.pty.write(`${description}\r`);
  }

  res.json({ ok: true, taskName: name, scope: terminal.scope });
});

// ── SSE Events ──────────────────────────────────────────────

app.get('/api/events', (req, res) => {
  sse.addClient(res);
  req.on('close', () => sse.removeClient(res));
});

// ── Task DAG ────────────────────────────────────────────────

app.get('/api/tasks', (_req, res) => {
  try {
    res.json(taskDag.toJSON());
  } catch (err) {
    res.status(500).json({ error: 'Failed to serialize task DAG', detail: err.message });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const { id, name, description, dependencies, scope } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });

    taskDag.addTask({ id, name, description, dependencies, scope });
    sse.broadcast('task_added', { id, name, description, dependencies, scope, ts: new Date().toISOString() });
    res.json({ ok: true, task: { id, name } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  try {
    taskDag.removeTask(req.params.id);
    sse.broadcast('task_removed', { id: req.params.id, ts: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Self-Improvement Metrics API ────────────────────────────

app.get('/api/metrics/tools', async (_req, res) => {
  try {
    const ratings = await rateTools();
    const result = {};
    for (const [tool, data] of ratings) result[tool] = data;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute tool ratings', detail: err.message });
  }
});

app.get('/api/metrics/sessions', (req, res) => {
  try {
    const summariesPath = path.join(__dirname, 'orchestrator', 'metrics', 'summaries.ndjson');
    const fs = require('fs');
    if (!fs.existsSync(summariesPath)) return res.json([]);
    const lines = fs.readFileSync(summariesPath, 'utf8').trim().split('\n').filter(Boolean);
    const limit = parseInt(req.query?.limit) || 50;
    const summaries = lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json(summaries);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read sessions', detail: err.message });
  }
});

app.get('/api/metrics/friction', (_req, res) => {
  try {
    const summariesPath = path.join(__dirname, 'orchestrator', 'metrics', 'summaries.ndjson');
    const fs = require('fs');
    if (!fs.existsSync(summariesPath)) return res.json({ friction_points: [], total_sessions: 0 });
    const lines = fs.readFileSync(summariesPath, 'utf8').trim().split('\n').filter(Boolean);
    const sessions = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    const toolAgg = {};
    for (const s of sessions) {
      if (!s.tools) continue;
      for (const [tool, stats] of Object.entries(s.tools)) {
        if (!toolAgg[tool]) toolAgg[tool] = { failures: 0, invocations: 0, sessions: 0 };
        toolAgg[tool].failures += stats.failures || 0;
        toolAgg[tool].invocations += stats.invocations || 0;
        toolAgg[tool].sessions++;
      }
    }

    const friction = Object.entries(toolAgg)
      .filter(([, v]) => v.failures > 0 && v.sessions >= 2)
      .map(([tool, v]) => ({
        tool,
        failure_rate: v.invocations > 0 ? +(v.failures / v.invocations).toFixed(3) : 0,
        total_failures: v.failures,
        across_sessions: v.sessions,
      }))
      .sort((a, b) => b.failure_rate - a.failure_rate);

    res.json({ friction_points: friction, total_sessions: sessions.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute friction', detail: err.message });
  }
});

app.post('/api/orchestrator/evolve', (req, res) => {
  try {
    const { action, target, content, reason, evidence } = req.body || {};
    if (!action || !target) return res.status(400).json({ error: 'action and target required' });

    const allowedTargets = ['playbooks.md', 'tool-registry.md'];
    const targetBase = path.basename(target);
    if (!allowedTargets.includes(targetBase)) {
      return res.status(403).json({ error: `Can only evolve: ${allowedTargets.join(', ')}` });
    }
    if (isImmutable(target)) {
      return res.status(403).json({ error: `${targetBase} is immutable` });
    }

    const targetPath = path.join(__dirname, 'orchestrator', targetBase);

    if (action === 'append') safeAppend(targetPath, '\n' + content);
    else if (action === 'replace') safeWrite(targetPath, content);
    else return res.status(400).json({ error: 'action must be "append" or "replace"' });

    logEvolution({
      file: `orchestrator/${targetBase}`,
      change: (content || '').substring(0, 200),
      why: reason || 'No reason provided',
      evidence: evidence || 'No evidence provided',
      reversible: 'yes',
    });

    sse.broadcast('evolution', { action, target: targetBase, reason, ts: new Date().toISOString() });
    res.json({ ok: true, action, target: targetBase });
  } catch (err) {
    res.status(500).json({ error: 'Evolution failed', detail: err.message });
  }
});

app.get('/api/metrics/playbooks', (_req, res) => {
  try {
    const playbooksPath = path.join(__dirname, 'orchestrator', 'playbooks.md');
    const summariesPath = path.join(__dirname, 'orchestrator', 'metrics', 'summaries.ndjson');
    const parsed = parsePlaybooks(playbooksPath);
    const usage = getPlaybookUsage(summariesPath);
    const promotions = promotePlaybooks(playbooksPath, summariesPath);
    res.json({ playbooks: parsed, usage: Object.fromEntries(usage), promotions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to analyze playbooks', detail: err.message });
  }
});

// ── Start ───────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Ninja Terminals v2 running on http://localhost:${PORT}`);

  // Start SSE heartbeat
  sse.startHeartbeat(15000);

  // Spawn default terminals
  for (let i = 0; i < DEFAULT_TERMINALS; i++) {
    spawnTerminal(`T${i + 1}`, [], DEFAULT_CWD);
  }

  console.log(`Spawned ${DEFAULT_TERMINALS} terminals with Claude Code`);
});
