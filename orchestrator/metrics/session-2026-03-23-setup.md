# Session: 2026-03-23 — Self-Improving Orchestrator Setup

## Goal
Design and implement a self-improving orchestrator system for Ninja Terminal that evolves its own prompts, tools, and workflows over time.

## What Was Done

### Research Phase (3 parallel agents)
1. **Self-improving AI agents** — Found SICA (17-53% gains), Karpathy AutoResearch (700 experiments/2 days), Darwin Godel Machine, EvoAgentX, Superpowers framework
2. **Claude Code advanced features** — Hooks, LSP plugins, modular rules, git worktrees, extended thinking, headless mode, custom slash commands, Agent Teams
3. **Vibe coding ecosystem** — Earendel ($880 autonomous revenue), Boris Cherny self-improving CLAUDE.md, MCP security (43% have critical vulns), METR study (devs think 20% faster but are 19% slower)

### Monetization Research
- Donation buttons yield effectively $0 for most projects
- MCP marketplace (MCPize) top creators earn $3-10K/mo
- Sponsorware and paid tiers are what actually works

### Implementation
Created the layered self-improving system:

**New files (7):**
- `orchestrator/identity.md` — immutable core identity
- `orchestrator/security-protocol.md` — immutable security rules
- `orchestrator/playbooks.md` — self-evolving workflows (seeded from research)
- `orchestrator/tool-registry.md` — full tool inventory with ratings
- `orchestrator/evolution-log.md` — append-only audit trail
- `.claude/rules/security.md` — always-loaded worker security rules
- `.claude/rules/research.md` — path-scoped research protocol

**Updated files (3):**
- `ORCHESTRATOR-PROMPT.md` — added brain loading, self-improvement loop, Karpathy principle
- `CLAUDE.md` — added INSIGHT: protocol, ultrathink guidance, security awareness
- `SPEC.md` — updated file structure

### Verification
- Server starts fine (port 3300, 4 terminals, health OK)
- YAML frontmatter valid on both rules files
- No cross-file contradictions
- All referenced paths exist

## Status
- Files created and verified structurally
- NOT YET COMMITTED
- NOT YET TESTED in a live orchestration session
- Next: test with a real project build to validate the system works in practice

## Key Research Sources
- awesome-claude-code: github.com/hesreallyhim/awesome-claude-code
- Karpathy AutoResearch: github.com/karpathy/autoresearch
- Superpowers: github.com/obra/superpowers
- SICA paper: arxiv.org/abs/2504.15228
- Arize CLAUDE.md optimization: arize.com/blog/claude-md-best-practices
- MCP security: 43% critical vulns, use Mighty Security Suite for scanning
- CUA (computer-use-agent): github.com/trycua/cua — 13.2K stars, purpose-built for AI agent desktop control
