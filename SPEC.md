# Ninja Terminal — Spec

## What It Is
A localhost browser app for orchestrating multiple Claude Code terminal instances. One page, multiple terminals, status detection, minimal UI. The intelligence is in the orchestrator (Claude CLI driving it via chrome automation), not in the app.

## Core Principles
- Terminals ARE the product. Minimal chrome around them.
- Server-side status detection — parse PTY stdout, expose via API.
- Auto-launch Claude Code in each terminal on creation.
- Orchestrator (Claude CLI) drives everything via chrome automation + status API.

## Tech Stack
- **Server**: Node.js + Express
- **PTY**: node-pty (one per terminal)
- **WebSocket**: ws (one connection per terminal, browser ↔ PTY)
- **Frontend**: Single HTML page + xterm.js + vanilla JS (no framework)
- **Port**: 3000

## Default Behavior
- App starts → spawns 4 terminals → each runs `claude` automatically
- Terminals are arranged in a 2x2 grid (responsive)
- Each terminal has a label tab (T1, T2, T3, T4) with status indicator

## Terminal Lifecycle
- **Create**: `POST /api/terminals` → spawns PTY, runs `claude`, returns `{ id, status }`
- **Kill**: `DELETE /api/terminals/:id` → kills PTY process, removes from grid
- **Restart**: `POST /api/terminals/:id/restart` → kills and respawns
- **Resize**: Handled automatically via xterm.js fit addon + WebSocket resize events

## Status Detection (Server-Side)
Parse raw PTY output to determine state. Status per terminal:

| Status | Detection Pattern |
|--------|------------------|
| `idle` | `> ` or `❯` prompt visible, cursor blinking, no activity for 2s |
| `working` | Spinner chars, `Running...`, `Bash(`, `Read(`, `Edit(`, `Write(`, active output |
| `waiting_approval` | `accept edits`, `allow`, `Yes/No`, `(y/n)`, permission prompts |
| `error` | `Error:`, `FAIL`, red output sequences |
| `compacting` | `auto-compact`, `compressing` |

Context % detection: parse for patterns like `XX% of context remaining` or similar Claude Code status line indicators.

## API
```
GET  /api/terminals          → [{ id, label, status, elapsed, contextPct }]
POST /api/terminals          → { id } (spawn new terminal + claude)
DELETE /api/terminals/:id    → ok (kill terminal)
POST /api/terminals/:id/restart → { id } (kill + respawn)
POST /api/terminals/:id/input   → ok (send text to PTY stdin)
GET  /api/terminals/:id/output  → { lines: string[] } (last N lines of output)
GET  /api/terminals/:id/status  → { status, elapsed, contextPct }
GET  /health                 → { status: "ok", terminals: count }
```

## WebSocket Protocol
- Path: `/ws/:id` (one WebSocket per terminal)
- Client → Server: raw keystrokes (same as V1 terminal)
- Server → Client: raw PTY output (same as V1 terminal)
- Server → Client: status updates as JSON frames: `{"type":"status","data":{"status":"idle","elapsed":"0s"}}`

## Frontend Layout
```
┌──────────────────────────────────────────────────┐
│  ninja-terminal    [T1 ●] [T2 ○] [T3 ●] [T4 ○] [+] │
├───────────────────────┬──────────────────────────┤
│                       │                          │
│   Terminal 1          │   Terminal 2             │
│   ● working (3m 12s)  │   ○ idle                 │
│                       │                          │
│                       │                          │
├───────────────────────┼──────────────────────────┤
│                       │                          │
│   Terminal 3          │   Terminal 4             │
│   ● working (1m 45s)  │   ⏳ waiting approval    │
│                       │                          │
│                       │                          │
└───────────────────────┴──────────────────────────┘
```

- 2x2 grid default. Grows to accommodate more terminals.
- Click a terminal tab to maximize it (full width/height). Click again to return to grid.
- Status indicator: ● green = working, ○ gray = idle, ⏳ yellow = waiting, ✕ red = error
- Elapsed time shown when working.
- Minimal dark theme. No sidebar. No settings page. No menus.

## Terminal Features
- xterm.js with fit addon (auto-resize to container)
- Copy/paste support
- Scrollback buffer (5000 lines)
- Terminal bell disabled
- Font: system monospace, 13px

## [+] Button
- Spawns a new terminal (POST /api/terminals)
- Adds it to the grid
- Auto-launches `claude` in it
- Grid reflows (2x2 → 2x3 → 3x3 etc.)

## What We DON'T Build
- No chat panel (the orchestrator uses Claude CLI, not the app)
- No file browser (Claude Code has that)
- No project management
- No auth (it's localhost)
- No database (terminal state is in-memory)
- No configuration UI (sane defaults, env vars for overrides)

## MCP Tools (auto-loaded)
Each terminal runs `claude` from the ninja-terminal project directory, so it picks up:

**Global (~/.claude/settings.json)**: gkchatty-kb, gkchatty-production, builder-pro-mcp, ui-tester, ai-bridge, miro, atlas-architect, shopify-printify

**Project (.mcp.json)**: postforme, studychat, gmail, chrome-devtools, netlify-billing, render-billing

## Worker Rules (CLAUDE.md)
Each terminal auto-loads CLAUDE.md which defines:
- Status reporting protocol (STATUS: DONE/BLOCKED/ERROR)
- File ownership boundaries
- Coordination protocol (CONTRACT:, NEED:)
- Build discipline (verify after every change)
- Context management (lean reads, phased work)

## Environment Variables (optional)
```
PORT=3000              # Server port
DEFAULT_TERMINALS=4    # How many to spawn on startup
CLAUDE_CMD=claude      # Command to run in each terminal
SHELL=/bin/zsh         # Shell to spawn (claude runs inside this)
```

## File Structure
```
ninja-terminal/
├── package.json
├── server.js           # Express + WebSocket + PTY management + status detection
├── public/
│   ├── index.html      # Single page
│   ├── style.css       # Dark theme, grid layout
│   └── app.js          # xterm.js setup, WebSocket connections, grid management
├── orchestrator/       # Self-evolving orchestrator brain
│   ├── identity.md     # Immutable: who the orchestrator is, principles, guardrails
│   ├── security-protocol.md  # Immutable: security rules, MCP scanning, prompt injection defense
│   ├── playbooks.md    # Self-evolving: learned workflows, terminal patterns
│   ├── tool-registry.md    # Self-evolving: tools inventory with effectiveness ratings
│   ├── evolution-log.md    # Append-only: every self-modification with reasoning
│   └── metrics/        # Per-session build metrics (JSON)
├── .claude/
│   └── rules/          # Modular rules (auto-loaded, path-scoped)
│       ├── security.md # Always loaded: security rules for workers
│       └── research.md # Loaded for orchestrator/ files: research protocol
├── .mcp.json           # MCP server configs for all terminals
├── CLAUDE.md           # Worker rules for terminal Claude Code instances
├── ORCHESTRATOR-PROMPT.md  # Orchestrator system prompt (references orchestrator/)
└── SPEC.md
```

## Build Target
One `npm start` command. Opens browser. 4 terminals with Claude Code running. That's it.
