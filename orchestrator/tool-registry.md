# Tool Registry

> This file is SELF-EVOLVING. The orchestrator updates it based on measured results.
> Every change must be logged in evolution-log.md with evidence.
> Last updated: 2026-03-23 (initial inventory)

## Rating Scale
- **S** — Essential. Use every session. Proven high-value.
- **A** — Very useful. Use frequently. Measurably improves outcomes.
- **B** — Useful in specific contexts. Worth having.
- **C** — Marginal. Rarely needed. Consider removing.
- **?** — Not yet rated. Needs testing.

## Active Tools (Currently Installed & Working)

### MCP Servers (Project — .mcp.json)

| Tool | Purpose | Rating | Notes |
|------|---------|--------|-------|
| postforme | Video render, social publish, Meta ads | S | Core tool for PostForMe project |
| studychat | RAG KB, DMs, C2C messaging | A | Knowledge persistence, user comms |
| gmail | Email search, read, attachments | B | Occasional use for research |
| chrome-devtools | Browser automation, screenshots | A | Verification, web interaction |
| netlify-billing | Deploy status, billing | B | Monitoring only |
| render-billing | Deploy status, billing | B | Monitoring only |

### MCP Servers (Global — ~/.claude/settings.json)

| Tool | Purpose | Rating | Notes |
|------|---------|--------|-------|
| builder-pro-mcp | Code review, security scan, auto-fix | A | Quality gates |
| gkchatty-production | Knowledge base | C | DO NOT USE unless David requests |
| atlas-architect | Blender 3D automation | B | Niche — only for avatar project |
| claude-in-chrome | Browser automation (alternative) | A | Used by orchestrator for visual supervision |

### Claude Code Built-In Features

| Feature | Purpose | Rating | Notes |
|---------|---------|--------|-------|
| Agent tool (subagents) | Parallel research, isolated tasks | A | Use for research-heavy work |
| Glob/Grep/Read | File search and reading | S | Core workflow |
| Edit/Write | File modification | S | Core workflow |
| Bash | Shell commands | S | Builds, tests, git |
| WebSearch/WebFetch | Internet research | A | Tool discovery, docs |
| /compact | Context management | A | Use proactively, not just at limit |
| /clear | Session reset | B | Between unrelated tasks |
| Extended thinking (ultrathink) | Deep reasoning | ? | Need to test and measure impact |
| Git worktrees (--worktree) | Isolated parallel branches | ? | Need to test |
| Headless mode (-p) | Scripted automation | ? | Need to test for CI/metrics |
| Custom slash commands | Reusable workflows | ? | Need to evaluate |

### Skills (Available in Claude Code)

| Skill | Purpose | Rating | Notes |
|-------|---------|--------|-------|
| /scout-plan-build | Full feature workflow | ? | Need to test on a real feature |
| /review | Code review | ? | Need to compare vs builder-pro review |
| /test | Testing framework | ? | Need to evaluate |
| /scan | Security audit | ? | Need to compare vs builder-pro security_scan |
| /build | Project builder | ? | Need to evaluate |
| /bmad-pro-build | Full SDLC with RAG | B | For large features (1+ hour, 3+ files) |

## Candidates (Discovered, Not Yet Installed)

### High Priority (Test Soon)

| Tool | What It Does | Source | Security Status |
|------|-------------|--------|-----------------|
| Playwright MCP | Browser testing via accessibility tree, more token-efficient than screenshots | @playwright/mcp (official) | Trusted — Microsoft maintained |
| Sentry MCP | Query production errors, stack traces | Official | Trusted — if we use Sentry |
| LSP plugins | Real-time type errors after every edit | github.com/boostvolt/claude-code-lsps | Needs review |
| Hooks (PreToolUse) | Auto-format, block dangerous commands | Built into Claude Code | Native — no install needed |

### Medium Priority (Research More)

| Tool | What It Does | Source | Security Status |
|------|-------------|--------|-----------------|
| code-review-mcp | Multi-LLM code review | github.com/praneybehl/code-review-mcp | Needs scan |
| Mighty Security Suite | MCP server security scanning | github.com/NineSunsInc/mighty-security | Needs review |
| Superpowers framework | Composable skills, TDD, review subagent | github.com/obra/superpowers | Needs review |
| DSPy (prompt optimization) | Automatic prompt compilation | github.com/stanfordnlp/dspy | Academic — trusted |

### Low Priority (Interesting But Not Urgent)

| Tool | What It Does | Source |
|------|-------------|--------|
| Ruflo (Claude Flow) | 60+ agent swarm coordination | github.com/ruvnet/ruflo |
| OpenClaw | Self-writing skills, 10K+ community skills | github.com/openclaw/openclaw |
| AutoResearch skill | Overnight prompt optimization loop | github.com/uditgoenka/autoresearch |
| MCPSafe.org | CI/CD MCP security checks | mcpsafe.org |

## Retired Tools

| Tool | Why Retired | Date |
|------|------------|------|
| (none yet) | | |
