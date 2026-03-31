# Ninja Terminals

**MCP server for multi-terminal Claude Code orchestration** — spawn, manage, and coordinate 1-4+ parallel Claude Code instances with DAG task management and self-improvement.

## Installation

```bash
npm install -g ninja-terminals
```

## Quick Start

### As MCP Server (Recommended)

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "ninjaterminal": {
      "command": "npx",
      "args": ["ninja-terminals-mcp"],
      "env": {
        "PORT": "3301",
        "HTTP_PORT": "3300"
      }
    }
  }
}
```

Then use the `/ninjaterminal` skill in Claude Code:

```
/ninjaterminal --terminals 4 --cwd /path/to/project
```

### Standalone Server

```bash
ninja-terminals --port 3300 --terminals 4 --cwd /path/to/project
```

Open http://localhost:3300 for the web UI.

## MCP Tools

Ninja Terminals exposes 12 MCP tools for terminal orchestration:

| Tool | Description |
|------|-------------|
| `spawn_terminal` | Create a new Claude Code terminal instance |
| `list_terminals` | Get all terminals with status, elapsed time, context % |
| `send_input` | Send text/commands to a terminal |
| `get_terminal_status` | Get detailed status for a specific terminal |
| `get_terminal_output` | Read recent output lines from a terminal |
| `get_terminal_log` | Get structured event log (DONE, BLOCKED, ERROR) |
| `assign_task` | Assign a named task with scope to a terminal |
| `set_label` | Update a terminal's display label |
| `kill_terminal` | Stop and remove a terminal |
| `restart_terminal` | Restart a terminal preserving its label |
| `get_session_info` | Get session metadata (tier, limits, created) |
| `end_session` | Finalize session and collect metrics |

## Example Invocations

### Spawn a terminal for building
```
mcp__ninjaterminal__spawn_terminal
  label: "Build"
  scope: ["src/", "lib/"]
  cwd: "/Users/me/project"
```

### Send a command
```
mcp__ninjaterminal__send_input
  id: 1
  text: "npm run build && npm test"
```

### Check status
```
mcp__ninjaterminal__get_terminal_status
  id: 1
```
Returns: `{id: 1, label: "Build", status: "working", elapsed: 45000, contextPct: 23, taskName: "Build project"}`

### Assign a task
```
mcp__ninjaterminal__assign_task
  id: 1
  name: "Fix auth bug"
  description: "Debug login flow in src/auth/"
  scope: ["src/auth/"]
```

### Get output
```
mcp__ninjaterminal__get_terminal_output
  id: 1
  lines: 50
  offset: 0
```

### List all terminals
```
mcp__ninjaterminal__list_terminals
```
Returns: `[{id: 1, label: "Build", status: "done"}, {id: 2, label: "Test", status: "working"}]`

## Architecture

```
Claude Code (your terminal)
  |
  v
/ninjaterminal skill
  |
  v
MCP Server (stdio/TCP)
  |
  +-- Spawns PTY instances (node-pty)
  +-- Manages WebSocket connections
  +-- Tracks status via pattern detection
  +-- Serves web UI on localhost:3300
  +-- Self-improves via playbooks/metrics
```

## Features

- **Parallel Execution**: Run 1-4+ Claude Code instances simultaneously
- **DAG Task Management**: Define task dependencies, auto-schedule
- **Status Detection**: Parses `STATUS: DONE/BLOCKED/ERROR` patterns
- **Self-Improvement**: Tracks tool success rates, evolves playbooks
- **Web UI**: Real-time terminal grid with xterm.js
- **Permission Tiers**: Free/Standard/Pro with different limits
- **Resilience**: Circuit breakers, context compaction handling

## Configuration

Environment variables:
- `PORT` — MCP server port (default: 3301)
- `HTTP_PORT` — Web UI port (default: 3300)
- `NINJA_TIER` — Permission tier: free, standard, pro (default: pro)
- `NINJA_MAX_TERMINALS` — Max concurrent terminals (default: 4)

## Documentation

- [MCP Usage Guide](docs/MCP-USAGE.md) — Detailed MCP integration docs
- [Architecture](docs/ARCHITECTURE-MCP-SCOUT.md) — Technical architecture
- [CLAUDE.md](CLAUDE.md) — Worker instance guidelines

## License

MIT
