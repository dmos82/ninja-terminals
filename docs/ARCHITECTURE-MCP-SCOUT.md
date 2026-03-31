# Ninja Terminals to MCP Server: Architecture Scout Report

**Date:** 2026-03-31
**Scope:** Understanding current architecture and requirements for MCP server version
**Location:** ~/Desktop/Projects/ninja-terminal/

---

## 1. CURRENT ARCHITECTURE OVERVIEW

### What Ninja Terminals Does Today

Ninja Terminals (v2.1.5) is a **multi-terminal orchestration system** that:
- Spawns 1-4+ concurrent Claude Code instances via `node-pty`
- Manages them via WebSocket (live terminal streaming) + REST API
- Tracks status, permissions, context window, task assignment via SSE
- Runs on **localhost:3300** (Express server, 1022 lines)
- Provides a web UI (xterm.js) and a REST/WebSocket API
- Injects learned guidance from prior sessions into new prompts
- Tracks metrics: tool ratings, hypothesis validation, playbook evolution

### Core Dependencies
```json
{
  "@anthropic-ai/sdk": "^0.80.0",  // For API calls to Claude
  "express": "^5.2.1",              // HTTP server
  "node-pty": "^1.2.0-beta.10",     // PTY spawning (Unix terminals)
  "ws": "^8.19.0",                  // WebSocket for terminal I/O
  "node-fetch": "^2.7.0",           // HTTP client
  "cheerio": "^1.2.0"               // HTML parsing
}
```

---

## 2. HOW TERMINALS ARE SPAWNED

### Spawn Flow (`server.js:110-218`)

```
CLI args (port, terminals, cwd, token)
  ↓
server.js reads env vars
  ↓
spawnTerminal(label, scope, cwd, tier)
  ↓
writeWorkerSettings(id, settingsDir, scope, {port, tier})
  ├─ Writes .claude/settings.local.json to TARGET project
  └─ Configures tier-based permissions (free/standard/pro)
  ↓
pty.spawn(SHELL, [], {cwd, env})
  ├─ name: 'xterm-256color'
  ├─ cols: 120, rows: 30
  └─ env: {NINJA_TERMINAL_ID: String(id), ...}
  ↓
After 500ms: write `cd "{cwd}" && ${CLAUDE_CMD}\r`
  └─ CLAUDE_CMD = 'claude --dangerously-skip-permissions' (configurable)
  ↓
Terminal object created, added to Map<id, terminal>
  ├─ id, label, pty, clients (WebSocket), status
  ├─ buffers: RawBuffer(65536), LineBuffer(1000), structuredLog[]
  ├─ scope: [], cwd, previousFiles, circuitBreaker
  └─ taskStartedAt, lastActivity, lastTaskCompletedAt
```

### Key Files Written to Target Project
- `.claude/settings.local.json` — Worker permissions, tier access, MCP tools
- `orchestrator/` files — Playbooks, tool ratings, evolution log, identity

---

## 3. ORCHESTRATOR SYSTEM

### How Terminals Communicate

**Status Detection (2s loop, `server.js:222-266`)**
```javascript
detectStatus(recentLines) → 'idle' | 'working' | 'done' | 'blocked' | 'error'
```
Parses terminal output: `STATUS: DONE —`, `PROGRESS:`, `BLOCKED —`, etc.

**Structured Events** (`status-detect.js`)
Extracts patterns:
- `STATUS: DONE — [summary]`
- `STATUS: BLOCKED — [reason]`
- `STATUS: ERROR — [details]`
- `PROGRESS: [X/Y] — [milestone]`
- `INSIGHT: [observation]`
- `NEED: [file path] — [request]`

**SSE Broadcasts** (real-time to frontend)
- `status_change`: {terminal, id, from, to, elapsed}
- `context_low`: {terminal, id, usage, threshold}
- `task_assigned`: {id, taskName, scope, description}
- `session_end`: {filesProcessed, toolsRated, ...}

### Orchestrator Prompt

Workers receive **CLAUDE.md** (guidelines, not enforcement):
- Identity: "You are ONE of 4 terminals in a self-improving system"
- Protocol: Exact status lines required (DONE, BLOCKED, ERROR)
- MCP Tools: Works with any MCP tools available in `.claude/settings.json`
- Self-recovery: Don't wait for hand-holding, fix issues yourself

### Orchestrator Dashboard (`ORCHESTRATOR-PROMPT.md`)

The orchestrator (a Claude instance running separate) controls all 4 terminals via:
1. **ASSESS** — GET `/api/terminals` → read status of all terminals
2. **PLAN** — consult `orchestrator/playbooks.md` for best assignment pattern
3. **DISPATCH** — POST `/api/terminals/:id/input` with task description
4. **WATCH** — Open localhost:3000 in browser, read live output, use `read_page` to scan
5. **INTERVENE** — Redirect if terminal is drifting, stuck, or wrong
6. **VERIFY** — Check `/api/terminals/:id/output` for full transcript
7. **LEARN** — Update playbooks.md, tool-registry.md, evolution-log.md

---

## 4. REST API ENDPOINTS

### Session Management
- `POST /api/session` — Create session (validates JWT, spawns terminals on demand)
- `GET /api/session` — Get current session info
- `DELETE /api/session` — Kill all terminals
- `POST /api/session/end` — Trigger post-session automation (analysis, ratings, hypothesis validation)

### Terminal Operations
- `GET /api/terminals` — List all terminals with status, context%, elapsed time
- `POST /api/terminals` — Spawn new terminal (with label, scope, cwd)
- `DELETE /api/terminals/:id` — Kill terminal
- `POST /api/terminals/:id/restart` — Restart with same config
- `POST /api/terminals/:id/input` — Send text/command (with optional guidance injection)
- `POST /api/terminals/:id/label` — Rename terminal
- `GET /api/terminals/:id/status` — Get current status, context%, taskName
- `GET /api/terminals/:id/output` — Paginated output (lines, offset)
- `GET /api/terminals/:id/log` — Structured event log (DONE, BLOCKED, etc.)
- `POST /api/terminals/:id/kill` — Graceful SIGINT → SIGTERM → SIGKILL
- `POST /api/terminals/:id/task` — Assign task, update taskName and scope

### Worker Hooks (Called by Claude Code)
- `POST /api/terminals/:id/evaluate` — Permission evaluation (PreToolUse hook)
- `POST /api/terminals/:id/stopped` — Worker context compacted event
- `POST /api/terminals/:id/compacted` — Worker context full event

### Task DAG
- `GET /api/tasks` — List all tasks (topologically sorted, cycles detected)
- `POST /api/tasks` — Add task with dependencies
- `DELETE /api/tasks/:id` — Remove task

### Metrics & Self-Improvement
- `GET /api/metrics/tools` — Tool ratings (success_rate, failures, invocations)
- `GET /api/metrics/sessions` — NDJSON history of session summaries
- `GET /api/metrics/friction` — Aggregated failures across sessions
- `GET /api/learnings/latest` — Current guidance (tool hints, playbook insights)
- `POST /api/orchestrator/evolve` — Update playbooks.md or tool-registry.md (with evidence)
- `GET /api/metrics/playbooks` — Playbook usage, promotion status

### Events
- `GET /api/events` — Server-Sent Events stream (SSE)
- `GET /health` — Health check

---

## 5. BROWSER AUTOMATION INTEGRATION

### Current Setup
- **Not MCP-based** currently, but referenced in `tool-registry.md`:
  - `claude-in-chrome` (rating: A) — used by orchestrator for visual supervision
  - `chrome-devtools` MCP (rating: A) — alternative, in `.mcp.json`

### Orchestrator's Visual Supervision Pattern (`ORCHESTRATOR-PROMPT.md:33-97`)

The orchestrator:
1. Keeps localhost:3000 (Ninja Terminals UI) open in a Chrome tab
2. Uses `read_page` or `get_page_text` to read live terminal output
3. Takes `screenshot` every 60-90 seconds to see 2x2 terminal grid
4. Detects red flags (drift, loops, wrong work, destructive ops)
5. Intervenes immediately with corrective input

### Frontend Architecture (`public/app.js`, 1222 lines)

**Terminal UI:**
- 2x2 grid of terminals (xterm.js)
- Double-click pane header → maximize individual terminal
- WebSocket connection per terminal: `ws://{host}/ws/{id}?token={jwt}`
- Raw PTY output streamed to terminal

**Status Display:**
- State icon (dot): idle | working | done | blocked | error
- Elapsed time (timer)
- Progress bar (if available)
- Label (editable)
- Action buttons: close, kill, restart, pause

**SSE Listener:**
- Listens to `/api/events` for real-time updates
- Updates state, progress, notifications
- Shows feed of all status changes

---

## 6. MCP SDK PATTERNS

### How MCP Works (from current .mcp.json integration)

MCP servers are **long-running processes** that expose tools via stdio/WebSocket.

Current servers in use (`.mcp.json`):
- `postforme` — Node.js with env vars
- `studychat` — Node.js with MongoDB URI
- `gmail` — npx (via npm)
- `chrome-devtools` — Node.js server
- `netlify-billing` — Node.js server
- `render-billing` — Node.js server

Each server:
1. Starts as a subprocess (Claude Code manages lifecycle)
2. Exposes `tools` list via JSON-RPC over stdio
3. Claude calls tools, server processes, returns results
4. Long-lived connection (minutes to hours)

### MCP Tool Pattern

Example (from postforme):
```json
{
  "name": "create_smart_campaign",
  "description": "...",
  "inputSchema": {
    "type": "object",
    "properties": {
      "contentId": { "type": "string" },
      "description": { "type": "string" },
      "dailyBudget": { "type": "number" }
    },
    "required": ["contentId", "description", "dailyBudget"]
  }
}
```

Claude Code:
1. Sees tool in available list
2. Calls it with parameters
3. Gets result
4. Can call again, pass context to tool

---

## 7. WHAT NEEDS TO BE BUILT FOR MCP VERSION

### Architecture Diagram

```
Claude Code (user's terminal)
  ↓
  /ninjaterminal skill
  ↓
Invokes MCP server (TCP or stdio)
  ↓
MCP Server Process
  ├─ Spawns worker processes (PTY instances)
  ├─ Manages WebSocket connections (terminal I/O)
  ├─ Exposes tools: spawn_terminal, send_input, get_status, etc.
  ├─ Serves web UI on localhost:3300 (or configurable)
  └─ Manages session state (JWTs, tier limits, permissions)
```

### Required Components

#### 1. `/ninjaterminal` Skill
**File:** `~/.claude/skills/ninjaterminal.md` (or registered via settings)

**Behavior:**
- Command: `/ninjaterminal [--port 3300] [--terminals 4] [--headless]`
- Invokes MCP server (validates it's running)
- Opens browser to UI (or returns endpoint URL in headless mode)
- Provides link to Ninja Terminals web interface
- Can be called from orchestrator's settings.json hook

#### 2. MCP Server (`mcp-server.js`)
**New file:** `/Users/davidmini/Desktop/Projects/ninja-terminal/mcp-server.js`

**Responsibilities:**
- Listen on TCP port (configurable, e.g., 3301 for MCP, 3300 for HTTP)
- Parse MCP requests (JSON-RPC 2.0 over stdio OR HTTP+WebSocket)
- Expose these tools:
  - `spawn_terminal(label, scope, cwd, tier)` → {id, status, url}
  - `send_input(id, text)` → {ok}
  - `get_status(id)` → {status, elapsed, contextPct, taskName}
  - `list_terminals()` → [{id, label, status, elapsed, ...}]
  - `kill_terminal(id)` → {ok}
  - `set_label(id, label)` → {ok}
  - `assign_task(id, name, description, scope)` → {ok}
  - `get_output(id, lines, offset)` → {lines: [...]}
  - `get_session_info()` → {tier, terminalsMax, createdAt}
  - `end_session()` → post-session metrics

**Architecture:**
- Reuse existing `server.js` logic (terminal spawning, PTY, buffers)
- Wrap in MCP interface
- Keep HTTP server running for browser UI
- Add MCP tool dispatch layer

#### 3. Browser Automation Integration
**Integration points:**
- If `--headless` flag, skip browser open
- If orchestrator calls MCP, orchestrator opens browser via `claude-in-chrome`
- URL returned by `spawn_terminal` tool includes session token
- Orchestrator's visual supervision works as-is (reads localhost:3300 in tab)

#### 4. Tier/Permission System
**No changes needed** (already in `settings-gen.js`):
- MCP server checks `tier` header/JWT on all operations
- Enforces terminal limits per tier
- Controls which MCP tools each worker can access

---

## 8. LONG-RUNNING MCP TOOL PATTERNS

### Async Tools Pattern
```javascript
{
  name: "spawn_terminal",
  description: "Spawn a terminal and return its URL",
  async execute(params) {
    const terminal = await spawnTerminal(params.label, params.scope);
    return {
      id: terminal.id,
      label: terminal.label,
      status: "starting",
      webUrl: `http://localhost:3300?token=...&terminalId=${terminal.id}`,
      wsUrl: `ws://localhost:3300/ws/${terminal.id}?token=...`
    };
  }
}
```

### Polling Pattern (Orchestrator's Pattern)
Orchestrator:
1. Calls `spawn_terminal(...)` — gets URL
2. Loops: `get_status(id)` every 2-5s
3. Reads output via `get_output(id)` when status changes
4. Detects DONE/BLOCKED/ERROR from output
5. Calls `send_input(id, new_task)` to dispatch next work
6. Repeats until goal complete

### Browser Monitoring Pattern
Instead of polling:
1. Orchestrator opens browser to MCP-returned URL
2. Browser loads UI (WebSocket already connected via frontend)
3. Orchestrator reads page periodically: `read_page(tab_id)`
4. SSE updates visible in page content
5. No extra polling needed

---

## 9. EXISTING CODE REUSE

### What Can Be Reused (95%+ of server.js)

1. **Terminal spawning** — `spawnTerminal()` function (lines 110-218)
2. **PTY management** — `terminal.pty`, `onData`, `onExit` handlers
3. **Status detection** — `detectStatus()` loop (lines 222-266)
4. **Buffers** — RawBuffer, LineBuffer, structuredLog
5. **Settings generation** — `writeWorkerSettings()` (tier-based permissions)
6. **Permissions** — `evaluatePermission()` middleware (refactor for MCP)
7. **Metrics** — tool-rater, playbook-tracker, evolution-writer
8. **Session management** — JWT validation, tier limits

### What Needs Refactoring

1. **Express routes** → MCP tool handlers
   - Map each route to a tool with same logic
   - Keep HTTP server separate (for UI) or merge if pure MCP

2. **WebSocket upgrade** → Keep as-is
   - WebSocket is compatible with MCP model
   - Frontend connects directly to HTTP+WS server on 3300
   - MCP is separate layer (3301 or stdio)

3. **Auth middleware** → MCP request validation
   - Extract JWT from MCP request metadata
   - Same validation logic

---

## 10. CURRENT MCP INTEGRATION (REFERENCE)

### How Orchestrator Currently Uses MCP

**In worker (.claude/settings.local.json):**
```json
{
  "tools": [...],
  "mcpServers": {
    "postforme": {
      "command": "node",
      "args": ["/path/to/index.js"],
      "env": { "API_KEY": "..." }
    }
  }
}
```

**Worker can call:**
```
LIST_RESOURCES: mcp__postforme__*
CALL_TOOL: mcp__postforme__create_smart_campaign
  input: { contentId: "...", dailyBudget: 500 }
```

**For Ninja Terminals MCP, similar pattern:**
```json
{
  "mcpServers": {
    "ninjaterminal": {
      "command": "node",
      "args": ["/path/to/mcp-server.js"],
      "env": { "PORT": "3301", "HTTP_PORT": "3300" }
    }
  }
}
```

**Orchestrator can call:**
```
CALL_TOOL: mcp__ninjaterminal__spawn_terminal
  input: { label: "Build", scope: ["src/"], cwd: "/path/to/project" }

CALL_TOOL: mcp__ninjaterminal__send_input
  input: { id: 1, text: "npm test" }

CALL_TOOL: mcp__ninjaterminal__get_status
  input: { id: 1 }
```

---

## 11. KEY DESIGN DECISIONS

### Port Strategy
- **HTTP UI:** localhost:3300 (browser, WebSocket connections)
- **MCP Protocol:** stdio (Claude Code invokes directly, no separate port)
- **Alternative:** HTTP+WebSocket on 3300, MCP on 3301 (requires HTTP transport)

### Session/JWT
- Keep current JWT validation (works across HTTP + MCP)
- MCP client (Claude Code) passes token in MCP metadata
- Server validates tier limits

### Headless Mode
- `--headless` flag: Don't open browser automatically
- MCP tools return URLs/endpoints
- Orchestrator's visual supervision uses returned URLs
- Good for CI/automation

### Self-Improvement Loop
Keep intact:
- Post-session metrics collection
- Tool rating updates
- Hypothesis validation
- Playbook evolution
- All stored in `orchestrator/` directory

---

## 12. RESEARCH QUESTIONS

### MCP SDK
**Need to verify:**
1. `@modelcontextprotocol/sdk` exports for tool definition, server setup
2. How to define async tools that return URLs/endpoints
3. Error handling and retry patterns in MCP
4. Stdio vs HTTP transport comparison
5. Sample: github.com/anthropics/mcp-servers (official examples)

### Claude Code Integration
**Need to verify:**
1. How Claude Code loads MCP servers from .mcp.json
2. How to invoke MCP tools from another terminal (if it's orchestrator)
3. Whether skills can invoke MCP tools directly
4. Pre/post hook support for MCP invocations

### Browser Automation (Claude in Chrome)
**Need to verify:**
1. Can `claude-in-chrome` read localStorage (JWT storage)?
2. Can it call REST endpoints directly?
3. Best practice: orchestrator opens browser → reads page → calls MCP to dispatch work

---

## SUMMARY

**Ninja Terminals is ready for MCP conversion:**

✅ **Existing:** 1022-line server with all terminal orchestration logic
✅ **Reusable:** 95% of code can stay as-is (spawn, buffers, status detection)
✅ **Architecture:** Clear separation of concerns (PTY, WebSocket, REST, metrics)
✅ **Patterns:** SSE/polling already support long-running tasks
✅ **Integration:** `.mcp.json` exists, tool-rating and metrics systems in place

⚠️ **To Build:**
1. MCP server wrapper (`mcp-server.js`, ~200-300 lines) exposing 10-12 tools
2. `/ninjaterminal` skill registration (minimal, 20-30 lines)
3. Refactor Express routes → MCP tool handlers (mapping, no logic changes)
4. Browser integration: return URLs from tools, let orchestrator open tabs
5. Integration tests: verify MCP tools work with orchestrator's dispatch pattern

**Estimated effort:** 4-6 hours (light refactoring, mostly wrapper/integration)
**Risk:** Low (existing code battle-tested, changes are additive)
**Launch:** Can start with stdio transport, add HTTP transport later if needed


---

## APPENDIX: CODE MAPPING REFERENCE

### File Structure

```
/Users/davidmini/Desktop/Projects/ninja-terminal/
├── server.js (1022 lines) ..................... Core server (to be wrapped)
├── cli.js (150 lines) ......................... CLI entry point
├── package.json ............................... Dependencies (add MCP SDK)
├── public/app.js (1222 lines) ................. Frontend (no changes)
│   ├── auth.ts — JWT management
│   ├── Terminal UI — xterm.js 2x2 grid
│   ├── WebSocket connection per terminal
│   └── SSE listener for status updates
├── lib/ ....................................... 18 support modules
│   ├── task-dag.js ............................ Task dependency graph
│   ├── scheduler.js ........................... Terminal affinity scoring
│   ├── status-detect.js ....................... Pattern parsing (DONE, BLOCKED, etc.)
│   ├── ring-buffer.js ......................... RawBuffer, LineBuffer
│   ├── settings-gen.js ........................ Tier-based permissions
│   ├── permissions.js ......................... Permission evaluation
│   ├── auth.js ................................ JWT validation
│   ├── sse.js ................................. Server-Sent Events broadcaster
│   ├── playbook-tracker.js .................... Playbook metrics
│   ├── tool-rater.js .......................... Tool success rates
│   ├── post-session.js ........................ Metrics aggregation
│   ├── pre-dispatch.js ........................ Context loading for guidance
│   ├── evolution-writer.js .................... Evolution log
│   ├── hypothesis-validator.js ............... Hypothesis validation
│   ├── resilience.js .......................... Circuit breaker
│   ├── safe-file-writer.js ................... Atomic writes
│   └── prompt-delivery.js ..................... Prompt fetching
├── orchestrator/ .............................. Self-improvement system (unchanged)
│   ├── identity.md ............................ Who the orchestrator is
│   ├── playbooks.md ........................... Learned workflows (self-evolving)
│   ├── tool-registry.md ....................... Tool ratings (S/A/B/C)
│   ├── security-protocol.md .................. Non-negotiable rules
│   ├── evolution-log.md ....................... Change history
│   └── metrics/ ............................... Session summaries, raw data
├── docs/ ...................................... External docs and research
├── CLAUDE.md .................................. Worker guidelines
├── ORCHESTRATOR-PROMPT.md ..................... Orchestrator system prompt
└── .mcp.json .................................. MCP server configuration

```

### Function Reference: What Maps to MCP Tools

| Express Route | Logic Location | MCP Tool Name | Params → Return |
|---|---|---|---|
| `POST /api/session` | server.js:350 | `create_session` | {token} → {tier, terminalsMax, features} |
| `GET /api/session` | server.js:442 | `get_session_info` | {} → {tier, terminalsMax, createdAt} |
| `DELETE /api/session` | server.js:408 | `end_session` | {} → {ok} |
| `POST /api/session/end` | server.js:468 | `finalize_session` | {} → {filesProcessed, toolsRated, hypothesesPromoted, duration_ms} |
| `GET /api/terminals` | server.js:532 | `list_terminals` | {} → [{id, label, status, elapsed, contextPct}] |
| `POST /api/terminals` | server.js:557, spawnTerminal() | `spawn_terminal` | {label, scope, cwd} → {id, label, status, webUrl, wsUrl} |
| `DELETE /api/terminals/:id` | server.js:586 | `kill_terminal` | {id} → {ok} |
| `POST /api/terminals/:id/restart` | server.js:604 | `restart_terminal` | {id} → {id, label, status} |
| `POST /api/terminals/:id/input` | server.js:629 | `send_input` | {id, text} → {ok, guidanceInjected} |
| `POST /api/terminals/:id/label` | server.js:663 | `set_label` | {id, label} → {ok, label} |
| `GET /api/terminals/:id/status` | server.js:673 | `get_terminal_status` | {id} → {id, label, status, elapsed, contextPct, taskName} |
| `GET /api/terminals/:id/output` | server.js:692 | `get_terminal_output` | {id, lines, offset} → {lines: [...]} |
| `GET /api/terminals/:id/log` | server.js:704 | `get_terminal_log` | {id} → [{ts, type, message}] |
| `POST /api/terminals/:id/kill` | server.js:713 | `graceful_kill` | {id} → {ok} |
| `POST /api/terminals/:id/task` | server.js:771 | `assign_task` | {id, name, description, scope} → {ok, taskName, scope} |
| `GET /api/metrics/tools` | server.js:846 | `get_tool_metrics` | {} → {tool: {success_rate, failures, invocations}} |
| `GET /api/metrics/sessions` | server.js:857 | `get_session_history` | {limit} → [{summary}, ...] |
| `GET /api/learnings/latest` | server.js:495 | `get_current_guidance` | {} → {toolGuidance, playbookInsights, hypothesisStatus} |
| `POST /api/orchestrator/evolve` | server.js:906 | `evolve_system` | {target, action, content, reason, evidence} → {ok} |

### Key Classes/Functions to Reuse

```javascript
// From lib/
const { spawnTerminal } = require('./server'); // lines 110-218
const { detectStatus } = require('./lib/status-detect');
const { TaskDAG } = require('./lib/task-dag');
const { selectTerminal } = require('./lib/scheduler');
const { RawBuffer, LineBuffer } = require('./lib/ring-buffer');
const { writeWorkerSettings } = require('./lib/settings-gen');
const { evaluatePermission } = require('./lib/permissions');
const { createAuthMiddleware, validateWebSocketToken } = require('./lib/auth');
const { SSEManager } = require('./lib/sse');

// From server.js (core logic)
const terminals = new Map(); // Global terminal registry
const activeSession = null;  // Current session state
const sessionCache = new Map(); // JWT cache

// Core loop (keep as-is, just wrap)
setInterval(() => {
  for (const [, terminal] of terminals) {
    const newStatus = detectStatus(terminal.lineBuffer.last(50));
    if (newStatus !== terminal.status) {
      sse.broadcast('status_change', {...});
    }
  }
}, 2000);
```

### Express Routes to Keep (UI Untouched)

```javascript
// These remain HTTP-only (for browser UI)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', ...);
app.get('/api/events', ...);  // SSE stream
server.on('upgrade', ...);     // WebSocket upgrade for terminal I/O
```

### MCP SDK Usage Pattern

```javascript
// New file: mcp-server.js
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const server = new Server({
  name: 'ninja-terminals',
  version: '2.1.5',
});

server.tool(
  'spawn_terminal',
  'Spawn a new Claude Code terminal instance',
  {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Terminal label (e.g., "Build", "Test")' },
      scope: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'File scope paths for permission restrictions'
      },
      cwd: { type: 'string', description: 'Working directory' },
    },
    required: ['label'],
  },
  async (params) => {
    // Reuse spawnTerminal() from server.js
    const terminal = spawnTerminal(params.label, params.scope, params.cwd);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: terminal.id,
            label: terminal.label,
            status: terminal.status,
            webUrl: `http://localhost:3300?token=${sessionToken}&terminalId=${terminal.id}`,
            wsUrl: `ws://localhost:3300/ws/${terminal.id}?token=${sessionToken}`,
          }, null, 2),
        },
      ],
    };
  },
);

// ... more tools ...

const transport = new StdioServerTransport();
server.connect(transport);
```

### `.mcp.json` Configuration

```json
{
  "mcpServers": {
    "ninjaterminal": {
      "command": "node",
      "args": ["/Users/davidmini/Desktop/Projects/ninja-terminal/mcp-server.js"],
      "env": {
        "PORT": "3301",
        "HTTP_PORT": "3300",
        "NINJA_BACKEND_URL": "https://emtchat-backend.onrender.com"
      }
    }
  }
}
```

### Orchestrator Invocation Pattern

**From orchestrator's Claude Code session:**
```
/ninjaterminal spawn_terminal label="Research" scope=["src/"] cwd="/path/to/project"

→ Returns:
{
  "id": 1,
  "label": "Research",
  "status": "starting",
  "webUrl": "http://localhost:3300?token=eyJ...",
  "wsUrl": "ws://localhost:3300/ws/1?token=eyJ..."
}

Then:
1. Open webUrl in browser (claude-in-chrome): read_page → see terminal output
2. Poll: /ninjaterminal get_terminal_status id=1
3. When status="idle": /ninjaterminal send_input id=1 text="[task]"
4. Repeat until status="done"
```

---

## INTEGRATION CHECKLIST

### Phase 1: MCP Server Wrapper (2-3 hours)
- [ ] Add `@modelcontextprotocol/sdk` to package.json
- [ ] Create `mcp-server.js` (stdio transport)
- [ ] Wrap 12 tools (spawn_terminal, send_input, list_terminals, etc.)
- [ ] Keep HTTP server (3300) running for UI
- [ ] Test: `node mcp-server.js` → stdio mode
- [ ] Update `.mcp.json` with new MCP server config

### Phase 2: Skill Registration (30 mins)
- [ ] Create `/ninjaterminal` skill (or macro)
- [ ] Skill wraps MCP invocation with convenience args (--port, --headless, --terminals)
- [ ] Skill opens browser if not headless
- [ ] Test: `claude` → `/ninjaterminal spawn_terminal label="Test"`

### Phase 3: Browser Integration (30 mins)
- [ ] Add `?token=...&sessionId=...` to returned URLs from MCP tools
- [ ] Verify WebSocket auth still works with token
- [ ] Test orchestrator opening browser tab via `claude-in-chrome`

### Phase 4: Testing & Validation (1 hour)
- [ ] Spawn terminal via MCP tool
- [ ] Send input via MCP tool
- [ ] Check terminal appears in UI
- [ ] Check status detection works
- [ ] Test guidance injection
- [ ] Test post-session metrics

### Phase 5: Documentation (30 mins)
- [ ] Update README: MCP server invocation
- [ ] Add tool descriptions to MCP server
- [ ] Document headless mode
- [ ] Add orchestrator setup guide

---

## DEPLOYMENT NOTES

### Local Development
```bash
# Terminal 1: Start MCP server + HTTP UI
node mcp-server.js

# Terminal 2: Start Claude Code with orchestrator
claude --orchestrator

# Terminal 3: Monitor metrics
curl http://localhost:3300/api/health
curl http://localhost:3300/api/metrics/tools
```

### Production (Headless)
```bash
# CI/automation: no browser needed
node mcp-server.js --headless --port 3301

# Then: Claude orchestrator calls MCP tools programmatically
# No UI, just metrics collection and logging
```

### Self-Improvement Loop (Automated)
```
Session starts
  ↓ (via MCP: spawn_terminal, send_input)
Orchestrator dispatches work to 4 terminals
  ↓
Terminal 1-4 work in parallel (status updates via SSE)
  ↓
Orchestrator reads output, intervenes as needed
  ↓
Session ends (via MCP: end_session)
  ↓
Post-session automation runs:
  ├─ Rate tools (tool-rater.js) → tool-ratings.json
  ├─ Validate hypotheses (hypothesis-validator.js) → promote/reject
  ├─ Log evolution (evolution-writer.js) → evolution-log.md
  ├─ Update playbooks (playbook-tracker.js) → playbooks.md
  └─ Save metrics (post-session.js) → orchestrator/metrics/summaries.ndjson
  ↓
Next session loads guidance: pre-dispatch.js → formatContextForInjection()
```

