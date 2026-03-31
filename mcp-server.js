#!/usr/bin/env node
/**
 * Ninja Terminals MCP Server
 *
 * Wraps the terminal orchestration system in an MCP interface.
 * Runs on stdio protocol for Claude Code integration.
 * Also starts HTTP server on port 3300 for browser UI.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const path = require('path');
const os = require('os');

// ── Lib imports ─────────────────────────────────────────────
const { LineBuffer, RawBuffer } = require('./lib/ring-buffer');
const { stripAnsi, detectStatus, extractContextPct, extractStructuredEvents } = require('./lib/status-detect');
const { SSEManager } = require('./lib/sse');
const { writeWorkerSettings } = require('./lib/settings-gen');
const { getPreDispatchContext, formatContextForInjection } = require('./lib/pre-dispatch');
const { runPostSession } = require('./lib/post-session');

// ── Config ──────────────────────────────────────────────────
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3300', 10);
const CLAUDE_CMD = process.env.CLAUDE_CMD || 'claude --dangerously-skip-permissions';
const SHELL = process.env.SHELL || '/bin/zsh';
const PROJECT_DIR = __dirname;
const INJECT_GUIDANCE = process.env.INJECT_GUIDANCE !== 'false';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Global State ────────────────────────────────────────────
let nextId = 1;
const terminals = new Map();
let activeSession = {
  tier: 'pro',
  terminalsMax: 10,
  features: ['all'],
  terminalIds: [],
  createdAt: Date.now(),
};

// ── Express + WebSocket (for browser UI) ────────────────────
const app = express();
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const sse = new SSEManager();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helper Functions ────────────────────────────────────────

function getElapsed(terminal) {
  if (!terminal.taskStartedAt) return null;
  const ms = Date.now() - terminal.taskStartedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function getTerminalInfo(t) {
  const recentLines = t.lineBuffer.last(50);
  return {
    id: t.id,
    label: t.label,
    status: t.status,
    elapsed: getElapsed(t),
    contextPct: extractContextPct(recentLines),
    taskName: t.taskName,
    progress: t.progress,
    scope: t.scope,
    cwd: t.cwd,
  };
}

// ── Terminal Spawning ───────────────────────────────────────

function spawnTerminal(label, scope = [], cwd = null, tier = 'pro') {
  const id = nextId++;
  const cols = 120;
  const rows = 30;

  const workDir = cwd || PROJECT_DIR;
  const settingsDir = cwd || PROJECT_DIR;

  // Write worker settings
  try {
    writeWorkerSettings(id, settingsDir, scope, { port: HTTP_PORT, tier });
  } catch (e) {
    console.error(`Failed to write worker settings for terminal ${id}:`, e.message);
  }

  // Clean env
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
      HOME: os.homedir(),
      PATH: `${os.homedir()}/.local/bin:/opt/homebrew/bin:${process.env.PATH || ''}`,
      SHELL_SESSIONS_DISABLE: '1',
      NINJA_TERMINAL_ID: String(id),
    },
  });

  // Launch claude after shell starts
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
  };

  // PTY data handler
  ptyProcess.onData((data) => {
    terminal.lastActivity = Date.now();
    terminal.rawBuffer.push(data);

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

    // Broadcast to WebSocket clients
    for (const ws of terminal.clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminal.status = 'exited';
    console.error(`Terminal ${id} exited with code ${exitCode}`);
    sse.broadcast('status_change', {
      terminal: terminal.label,
      id: terminal.id,
      from: terminal.status,
      to: 'exited',
      elapsed: getElapsed(terminal),
    });
  });

  terminals.set(id, terminal);
  activeSession.terminalIds.push(id);
  console.error(`Spawned terminal ${id} (${terminal.label})${scope.length ? ` scope: ${scope}` : ''}`);
  return terminal;
}

// ── Status Detection Loop ───────────────────────────────────

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

      if (newStatus === 'working' && prev !== 'working') {
        terminal.taskStartedAt = Date.now();
      }
      if (newStatus === 'done' || newStatus === 'idle') {
        terminal.taskStartedAt = null;
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

// ── WebSocket Upgrade (for browser UI) ──────────────────────

httpServer.on('upgrade', (req, socket, head) => {
  const urlParts = new URL(req.url, `http://${req.headers.host}`);
  const match = urlParts.pathname.match(/^\/ws\/(\d+)$/);
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

    const buffered = terminal.rawBuffer.getAll();
    if (buffered) ws.send(buffered);

    ws.on('message', (msg) => {
      const data = msg.toString();
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          terminal.pty.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch { /* not JSON */ }
      terminal.pty.write(data);
    });

    ws.on('close', () => terminal.clients.delete(ws));
  });
});

// ── HTTP Routes (for browser UI) ────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2.1.5-mcp',
    terminals: terminals.size,
    mode: 'mcp',
  });
});

app.get('/api/events', (req, res) => {
  sse.addClient(res);
  req.on('close', () => sse.removeClient(res));
});

app.get('/api/terminals', (_req, res) => {
  const list = [];
  for (const [, t] of terminals) {
    list.push(getTerminalInfo(t));
  }
  res.json(list);
});

// ── MCP Server Setup ────────────────────────────────────────

const mcpServer = new Server(
  { name: 'ninja-terminals', version: '2.1.5' },
  { capabilities: { tools: {} } }
);

// ── MCP Tool Definitions ────────────────────────────────────

const TOOLS = [
  {
    name: 'spawn_terminal',
    description: 'Spawn a new Claude Code terminal instance. Returns terminal ID and URLs for web/WebSocket access.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Terminal label (e.g., "Build", "Test", "Research")' },
        scope: { type: 'array', items: { type: 'string' }, description: 'File scope paths for permission restrictions' },
        cwd: { type: 'string', description: 'Working directory for the terminal' },
        tier: { type: 'string', enum: ['free', 'standard', 'pro'], description: 'Permission tier (default: pro)' },
      },
    },
  },
  {
    name: 'send_input',
    description: 'Send text input to a terminal. Automatically injects learned guidance from prior sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Terminal ID' },
        text: { type: 'string', description: 'Text to send to the terminal' },
      },
      required: ['id', 'text'],
    },
  },
  {
    name: 'list_terminals',
    description: 'List all active terminals with their status, elapsed time, and context window usage.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_terminal_status',
    description: 'Get detailed status of a specific terminal including context%, task name, and progress.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Terminal ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_terminal_output',
    description: 'Get paginated output lines from a terminal.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Terminal ID' },
        lines: { type: 'number', description: 'Number of lines to retrieve (default: 50)' },
        offset: { type: 'number', description: 'Offset from start (default: 0)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_terminal_log',
    description: 'Get structured event log from a terminal (DONE, BLOCKED, ERROR, PROGRESS events).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Terminal ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'kill_terminal',
    description: 'Gracefully kill a terminal (SIGINT -> SIGTERM -> SIGKILL).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Terminal ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'restart_terminal',
    description: 'Restart a terminal with the same configuration (label, scope, cwd).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Terminal ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'set_label',
    description: 'Set or change a terminal label.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Terminal ID' },
        label: { type: 'string', description: 'New label' },
      },
      required: ['id', 'label'],
    },
  },
  {
    name: 'assign_task',
    description: 'Assign a named task to a terminal. Updates task tracking and optionally sends task description as input.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Terminal ID' },
        name: { type: 'string', description: 'Task name' },
        description: { type: 'string', description: 'Task description (sent to terminal as input)' },
        scope: { type: 'array', items: { type: 'string' }, description: 'Updated file scope for this task' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'get_session_info',
    description: 'Get current session information including tier, terminal count, and active terminals.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'finalize_session',
    description: 'Trigger post-session automation: tool rating, hypothesis validation, playbook evolution.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── MCP Tool Handlers ───────────────────────────────────────

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'spawn_terminal': {
        const terminal = spawnTerminal(
          args.label || null,
          args.scope || [],
          args.cwd || null,
          args.tier || 'pro'
        );
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: terminal.id,
              label: terminal.label,
              status: terminal.status,
              cwd: terminal.cwd,
              webUrl: `http://localhost:${HTTP_PORT}`,
              wsUrl: `ws://localhost:${HTTP_PORT}/ws/${terminal.id}`,
            }, null, 2),
          }],
        };
      }

      case 'send_input': {
        const terminal = terminals.get(args.id);
        if (!terminal) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Terminal not found' }) }], isError: true };
        }

        let finalText = args.text;
        let guidanceInjected = false;

        if (INJECT_GUIDANCE) {
          try {
            const ctx = await getPreDispatchContext();
            const hasGuidance = ctx.toolGuidance.length > 0 || ctx.playbookInsights.length > 0;
            if (hasGuidance) {
              const guidanceBlock = formatContextForInjection(ctx);
              finalText = `${guidanceBlock}\n\n${args.text}`;
              guidanceInjected = true;
            }
          } catch { /* continue without guidance */ }
        }

        terminal.pty.write(finalText);
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, guidanceInjected }) }],
        };
      }

      case 'list_terminals': {
        const list = [];
        for (const [, t] of terminals) {
          list.push(getTerminalInfo(t));
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
        };
      }

      case 'get_terminal_status': {
        const terminal = terminals.get(args.id);
        if (!terminal) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Terminal not found' }) }], isError: true };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(getTerminalInfo(terminal), null, 2) }],
        };
      }

      case 'get_terminal_output': {
        const terminal = terminals.get(args.id);
        if (!terminal) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Terminal not found' }) }], isError: true };
        }
        const lines = args.lines || 50;
        const offset = args.offset || 0;
        const output = terminal.lineBuffer.slice(offset, lines);
        return {
          content: [{ type: 'text', text: JSON.stringify({ lines: output, offset, count: output.length }, null, 2) }],
        };
      }

      case 'get_terminal_log': {
        const terminal = terminals.get(args.id);
        if (!terminal) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Terminal not found' }) }], isError: true };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(terminal.structuredLog, null, 2) }],
        };
      }

      case 'kill_terminal': {
        const terminal = terminals.get(args.id);
        if (!terminal) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Terminal not found' }) }], isError: true };
        }

        if (terminal.status === 'exited') {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: 'Already exited' }) }] };
        }

        // Graceful kill: SIGINT -> SIGTERM -> SIGKILL
        terminal.pty.kill('SIGINT');
        await sleep(5000);
        if (terminal.status !== 'exited') {
          terminal.pty.kill('SIGTERM');
          await sleep(3000);
          if (terminal.status !== 'exited') {
            terminal.pty.kill('SIGKILL');
          }
        }

        for (const ws of terminal.clients) ws.close();
        terminals.delete(args.id);
        activeSession.terminalIds = activeSession.terminalIds.filter(id => id !== args.id);

        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      }

      case 'restart_terminal': {
        const terminal = terminals.get(args.id);
        if (!terminal) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Terminal not found' }) }], isError: true };
        }

        const label = terminal.label;
        const scope = terminal.scope;
        const cwd = terminal.cwd;

        // Kill old terminal
        terminal.pty.kill();
        for (const ws of terminal.clients) ws.close();
        terminals.delete(args.id);
        activeSession.terminalIds = activeSession.terminalIds.filter(id => id !== args.id);

        // Spawn new
        const newTerminal = spawnTerminal(label, scope, cwd, 'pro');

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: newTerminal.id,
              label: newTerminal.label,
              status: newTerminal.status,
              previousId: args.id,
            }, null, 2),
          }],
        };
      }

      case 'set_label': {
        const terminal = terminals.get(args.id);
        if (!terminal) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Terminal not found' }) }], isError: true };
        }
        terminal.label = args.label;
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, label: terminal.label }) }] };
      }

      case 'assign_task': {
        const terminal = terminals.get(args.id);
        if (!terminal) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Terminal not found' }) }], isError: true };
        }

        terminal.taskName = args.name;
        terminal.progress = null;
        terminal.taskStartedAt = Date.now();

        if (args.scope) {
          terminal.scope = Array.isArray(args.scope) ? args.scope : [args.scope];
        }

        sse.broadcast('task_assigned', {
          terminal: terminal.label,
          id: terminal.id,
          taskName: args.name,
          description: args.description || null,
          scope: terminal.scope,
          ts: new Date().toISOString(),
        });

        // Send task description as input
        if (args.description) {
          terminal.pty.write(`${args.description}\r`);
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, taskName: args.name, scope: terminal.scope }) }],
        };
      }

      case 'get_session_info': {
        const sessionTerminals = activeSession.terminalIds
          .map(id => terminals.get(id))
          .filter(Boolean)
          .map(t => getTerminalInfo(t));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              tier: activeSession.tier,
              terminalsMax: activeSession.terminalsMax,
              features: activeSession.features,
              terminals: sessionTerminals,
              createdAt: activeSession.createdAt,
            }, null, 2),
          }],
        };
      }

      case 'finalize_session': {
        try {
          const result = await runPostSession();
          sse.broadcast('session_end', {
            filesProcessed: result.filesProcessed,
            toolsRated: Object.keys(result.toolRatings).length,
            hypothesesPromoted: result.hypothesisValidation.promoted,
            hypothesesRejected: result.hypothesisValidation.rejected,
            duration_ms: result.duration_ms,
            ts: result.ts,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Post-session failed', detail: err.message }) }],
            isError: true,
          };
        }
      }

      default:
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
});

// ── Start Servers ───────────────────────────────────────────

async function main() {
  // Start HTTP server for browser UI
  httpServer.listen(HTTP_PORT, () => {
    console.error(`Ninja Terminals HTTP server running on http://localhost:${HTTP_PORT}`);
  });

  // Start MCP server on stdio
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('Ninja Terminals MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
