---
description: Launch Ninja Terminals multi-terminal orchestrator
---

**Purpose**: Start and access Ninja Terminals for parallel Claude Code orchestration

---

## Command Execution
Execute: immediate
Purpose: "Start Ninja Terminals server and open web UI"

Launch Ninja Terminals orchestration system with 4 parallel Claude Code instances.

## Quick Start

1. **Check if server is running**
   ```bash
   curl -s http://localhost:3300/health && echo "Running" || echo "Not running"
   ```

2. **Start server if not running**
   ```bash
   cd ~/Desktop/Projects/ninja-terminal && node server.js &
   ```

3. **Open web UI**
   - Primary: http://localhost:3300
   - Fallback: https://ninjaterminals.com

4. **Verify terminals are ready**
   ```bash
   curl http://localhost:3300/api/terminals | jq
   ```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3300 | HTTP server port |
| `DEFAULT_TERMINALS` | 4 | Number of terminals to spawn |
| `DEFAULT_CWD` | null | Target project directory |
| `CLAUDE_CMD` | `claude --dangerously-skip-permissions` | Command to start Claude |

## The 12 MCP Tools

### Terminal Management

**1. list_terminals** - Get all terminals with status
```bash
curl http://localhost:3300/api/terminals
# Returns: [{id, label, status, elapsed, contextPct, taskName}]
```

**2. spawn_terminal** - Create new terminal
```bash
curl -X POST http://localhost:3300/api/terminals \
  -H "Content-Type: application/json" \
  -d '{"label": "builder", "scope": ["src/"], "cwd": "/path/to/project"}'
```

**3. kill_terminal** - Stop a terminal
```bash
curl -X POST http://localhost:3300/api/terminals/1/kill
```

**4. restart_terminal** - Restart with same config
```bash
curl -X POST http://localhost:3300/api/terminals/1/restart
```

### Input/Output

**5. send_input** - Send text to terminal
```bash
curl -X POST http://localhost:3300/api/terminals/1/input \
  -H "Content-Type: application/json" \
  -d '{"text": "Build the authentication module"}'
```

**6. get_output** - Read terminal output (paginated)
```bash
curl "http://localhost:3300/api/terminals/1/output?lines=100&offset=0"
```

**7. get_log** - Get structured event log
```bash
curl http://localhost:3300/api/terminals/1/log
# Returns: DONE, BLOCKED, ERROR, PROGRESS events
```

### Status & Tasks

**8. get_status** - Get terminal status
```bash
curl http://localhost:3300/api/terminals/1/status
# Returns: {status, elapsed, contextPct, taskName, label}
```

**9. set_label** - Rename terminal
```bash
curl -X POST http://localhost:3300/api/terminals/1/label \
  -H "Content-Type: application/json" \
  -d '{"label": "researcher"}'
```

**10. assign_task** - Assign task with scope
```bash
curl -X POST http://localhost:3300/api/terminals/1/task \
  -H "Content-Type: application/json" \
  -d '{"name": "auth-module", "description": "Build OAuth flow", "scope": ["src/auth/"]}'
```

### Session Management

**11. get_session_info** - Get session details
```bash
curl http://localhost:3300/api/session
# Returns: {tier, terminalsMax, createdAt, activeTerminals}
```

**12. end_session** - Trigger post-session analysis
```bash
curl -X POST http://localhost:3300/api/session/end
# Returns: {filesProcessed, toolsRated, hypothesesValidated}
```

## Orchestrator Pattern

For complex builds, use the orchestrator pattern:

1. **ASSESS** - `list_terminals` to check status
2. **PLAN** - Consult playbooks in `orchestrator/playbooks.md`
3. **DISPATCH** - `send_input` with task description
4. **WATCH** - Monitor via web UI or `get_output`
5. **INTERVENE** - Redirect if blocked/drifting
6. **VERIFY** - Check `get_log` for DONE status
7. **LEARN** - Update playbooks with insights

## Worker Status Protocol

Workers report status via terminal output:
- `STATUS: DONE - [summary]` - Task completed
- `STATUS: BLOCKED - [reason]` - Needs help
- `STATUS: ERROR - [details]` - Something failed
- `PROGRESS: [X/Y] - [milestone]` - Progress update
- `INSIGHT: [observation]` - Learning for playbook

## Examples

```bash
# Launch with defaults (4 terminals, port 3300)
/ninjaterminal

# Launch for specific project
DEFAULT_CWD=/path/to/project /ninjaterminal

# Launch with 2 terminals
DEFAULT_TERMINALS=2 /ninjaterminal

# Quick status check
/ninjaterminal status
```

## Integration

Works with:
- `claude-in-chrome` for visual supervision
- `chrome-devtools` for headless monitoring
- Any MCP tools configured in worker `.mcp.json`
