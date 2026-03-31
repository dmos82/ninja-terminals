# MCP Usage Guide

Ninja Terminals is an MCP (Model Context Protocol) server that enables Claude Code to orchestrate multiple parallel terminal instances.

## Setup

### 1. Install the Package

```bash
npm install -g ninja-terminals
```

### 2. Configure MCP

Add to your project's `.mcp.json` or global `~/.claude/.mcp.json`:

```json
{
  "mcpServers": {
    "ninjaterminal": {
      "command": "npx",
      "args": ["ninja-terminals-mcp"],
      "env": {
        "PORT": "3301",
        "HTTP_PORT": "3300",
        "NINJA_TIER": "pro",
        "NINJA_MAX_TERMINALS": "4"
      }
    }
  }
}
```

### 3. Restart Claude Code

After editing `.mcp.json`, restart Claude Code to load the MCP server.

## Using the /ninjaterminal Skill

The `/ninjaterminal` skill provides a high-level interface:

```
/ninjaterminal                          # Start with defaults
/ninjaterminal --terminals 4            # Specify terminal count
/ninjaterminal --cwd /path/to/project   # Set working directory
/ninjaterminal --headless               # Skip browser open
```

---

## MCP Tools Reference

### spawn_terminal

Create a new Claude Code terminal instance.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `label` | string | yes | Display name for the terminal |
| `scope` | string[] | no | File paths this terminal can modify |
| `cwd` | string | no | Working directory (defaults to current) |
| `tier` | string | no | Permission tier: free, standard, pro |

**Returns:**
```json
{
  "id": 1,
  "label": "Build",
  "status": "starting",
  "webUrl": "http://localhost:3300?terminalId=1",
  "wsUrl": "ws://localhost:3300/ws/1"
}
```

**Example:**
```
mcp__ninjaterminal__spawn_terminal
  label: "Research"
  scope: ["docs/", "research/"]
  cwd: "/Users/me/project"
```

---

### list_terminals

Get all active terminals with their current state.

**Parameters:** None

**Returns:**
```json
[
  {
    "id": 1,
    "label": "Build",
    "status": "working",
    "elapsed": 45000,
    "contextPct": 23,
    "taskName": "Build project"
  },
  {
    "id": 2,
    "label": "Test",
    "status": "idle",
    "elapsed": 0,
    "contextPct": 5
  }
]
```

**Status values:**
- `idle` — Waiting for input
- `starting` — Terminal spawning
- `working` — Actively processing
- `done` — Task completed (STATUS: DONE detected)
- `blocked` — Needs input (STATUS: BLOCKED detected)
- `error` — Error occurred (STATUS: ERROR detected)

---

### send_input

Send text or commands to a terminal.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | yes | Terminal ID |
| `text` | string | yes | Text to send (newline appended if missing) |

**Returns:**
```json
{
  "ok": true,
  "guidanceInjected": true
}
```

**Note:** When `guidanceInjected` is true, the system prepended learned guidance from prior sessions.

**Example:**
```
mcp__ninjaterminal__send_input
  id: 1
  text: "Fix the authentication bug in src/auth/login.ts"
```

---

### get_terminal_status

Get detailed status for a specific terminal.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | yes | Terminal ID |

**Returns:**
```json
{
  "id": 1,
  "label": "Build",
  "status": "working",
  "elapsed": 120000,
  "contextPct": 45,
  "taskName": "Implement feature X",
  "scope": ["src/features/"],
  "lastActivity": "2026-03-31T14:30:00Z"
}
```

---

### get_terminal_output

Read recent output lines from a terminal.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | yes | Terminal ID |
| `lines` | number | no | Number of lines to return (default: 50) |
| `offset` | number | no | Lines to skip from end (default: 0) |

**Returns:**
```json
{
  "lines": [
    "Running npm test...",
    "PASS src/auth/login.test.ts",
    "STATUS: DONE — All tests passing"
  ]
}
```

---

### get_terminal_log

Get structured event log with parsed status updates.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | yes | Terminal ID |

**Returns:**
```json
[
  {"ts": "2026-03-31T14:25:00Z", "type": "progress", "message": "[3/5] — Refactored auth module"},
  {"ts": "2026-03-31T14:28:00Z", "type": "insight", "message": "Using ultrathink helped catch edge case"},
  {"ts": "2026-03-31T14:30:00Z", "type": "done", "message": "All tests passing, PR ready"}
]
```

**Event types:**
- `done` — STATUS: DONE
- `blocked` — STATUS: BLOCKED
- `error` — STATUS: ERROR
- `progress` — PROGRESS: X/Y
- `insight` — INSIGHT: observation
- `need` — NEED: file/resource request

---

### assign_task

Assign a named task with scope constraints.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | yes | Terminal ID |
| `name` | string | yes | Task name |
| `description` | string | yes | Detailed task description |
| `scope` | string[] | no | Files/directories the terminal can modify |

**Returns:**
```json
{
  "ok": true,
  "taskName": "Fix auth bug",
  "scope": ["src/auth/"]
}
```

**Example:**
```
mcp__ninjaterminal__assign_task
  id: 1
  name: "Implement OAuth"
  description: "Add Google OAuth support to the login flow"
  scope: ["src/auth/", "src/config/oauth.ts"]
```

---

### set_label

Update a terminal's display label.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | yes | Terminal ID |
| `label` | string | yes | New label |

**Returns:**
```json
{
  "ok": true,
  "label": "Auth Worker"
}
```

---

### kill_terminal

Stop and remove a terminal.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | yes | Terminal ID |

**Returns:**
```json
{
  "ok": true
}
```

---

### restart_terminal

Restart a terminal, preserving its label and scope.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | yes | Terminal ID |

**Returns:**
```json
{
  "id": 1,
  "label": "Build",
  "status": "starting"
}
```

---

### get_session_info

Get session metadata.

**Parameters:** None

**Returns:**
```json
{
  "tier": "pro",
  "terminalsMax": 4,
  "terminalsActive": 2,
  "createdAt": "2026-03-31T14:00:00Z",
  "features": ["dag_tasks", "self_improvement", "browser_supervision"]
}
```

---

### end_session

Finalize session and collect metrics.

**Parameters:** None

**Returns:**
```json
{
  "ok": true,
  "filesProcessed": 47,
  "toolsRated": 12,
  "hypothesesPromoted": 3,
  "duration_ms": 3600000
}
```

---

## Orchestration Patterns

### Basic Parallel Execution

```javascript
// Spawn 4 terminals
const build = await spawn_terminal({label: "Build", scope: ["src/"]});
const test = await spawn_terminal({label: "Test", scope: ["test/"]});
const docs = await spawn_terminal({label: "Docs", scope: ["docs/"]});
const lint = await spawn_terminal({label: "Lint", scope: ["src/"]});

// Assign tasks
await send_input({id: build.id, text: "Build the project"});
await send_input({id: test.id, text: "Run all tests"});
await send_input({id: docs.id, text: "Update API documentation"});
await send_input({id: lint.id, text: "Fix all lint errors"});

// Poll for completion
while (true) {
  const terminals = await list_terminals();
  const allDone = terminals.every(t => t.status === 'done');
  if (allDone) break;
  await sleep(2000);
}
```

### Sequential with Dependencies

```javascript
// Phase 1: Research
await send_input({id: 1, text: "Research best practices for OAuth"});
await waitForDone(1);

// Phase 2: Build (depends on research)
const guidance = await get_terminal_output({id: 1, lines: 50});
await send_input({id: 2, text: `Using this research:\n${guidance}\nImplement OAuth`});
```

### Status-Driven Dispatch

```javascript
while (tasksRemaining > 0) {
  const terminals = await list_terminals();

  for (const t of terminals) {
    if (t.status === 'done') {
      const nextTask = taskQueue.pop();
      await assign_task({id: t.id, ...nextTask});
    }
    if (t.status === 'blocked') {
      const log = await get_terminal_log({id: t.id});
      const blockReason = log.find(e => e.type === 'blocked')?.message;
      // Handle blocked terminal
    }
  }

  await sleep(2000);
}
```

---

## Browser Supervision

The web UI at `http://localhost:3300` provides:
- Real-time terminal grid (2x2 default)
- Live output streaming via WebSocket
- Status indicators (idle/working/done/blocked/error)
- Context window usage percentage
- Task assignment UI

### Visual Monitoring with Claude in Chrome

```javascript
// Get terminal URL
const terminal = await spawn_terminal({label: "Build"});

// Open in browser via claude-in-chrome
await mcp__claude_in_chrome__navigate({url: terminal.webUrl});

// Read page periodically to monitor
const pageContent = await mcp__claude_in_chrome__read_page({tabId: tab});
```

---

## Self-Improvement System

Ninja Terminals learns from each session:

1. **Tool Ratings**: Tracks success/failure rates for tools
2. **Playbook Evolution**: Learns effective workflows
3. **Hypothesis Validation**: Tests and promotes working patterns
4. **Guidance Injection**: Applies learnings to future sessions

Files in `orchestrator/`:
- `playbooks.md` — Learned workflows
- `tool-registry.md` — Tool ratings (S/A/B/C tiers)
- `evolution-log.md` — Change history
- `metrics/` — Session summaries

---

## Error Handling

### Terminal Not Found
```json
{"error": "Terminal not found", "id": 5}
```

### Session Limit Reached
```json
{"error": "Terminal limit reached", "max": 4, "tier": "pro"}
```

### Context Window Full
The system detects context window usage and emits SSE events:
```json
{"event": "context_low", "terminal": 1, "usage": 85, "threshold": 80}
```

Handle by restarting the terminal:
```
mcp__ninjaterminal__restart_terminal
  id: 1
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3301 | MCP server port |
| `HTTP_PORT` | 3300 | Web UI port |
| `NINJA_TIER` | pro | Permission tier |
| `NINJA_MAX_TERMINALS` | 4 | Max concurrent terminals |
| `NINJA_CWD` | current | Default working directory |
| `NINJA_HEADLESS` | false | Skip browser open |
