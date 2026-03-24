# Playbooks

> This file is SELF-EVOLVING. The orchestrator updates it based on measured results.
> Every change must be logged in evolution-log.md with evidence.
> Last updated: 2026-03-23 (initial seed from research)

## Terminal Assignment Patterns

### Default: Role-Based Split (4 Terminals)
```
T1: Research / Scout    — reads code, searches web, gathers context
T2: Build (primary)     — main implementation work
T3: Build (secondary)   — parallel implementation or supporting work
T4: Verify / Test       — runs builds, tests, takes screenshots, validates
```
**Status:** Initial pattern, not yet measured. Evaluate after 5 sessions.

### For Frontend Features
```
T1: Build the feature
T2: Run dev server + validate in browser (persistent)
T3: Write/run tests
T4: Available for research or parallel work
```
**Status:** Hypothesis from incident.io worktree pattern. Test and measure.

### For Bug Fixes
```
T1: Reproduce the bug (get exact steps + evidence)
T2: Trace the code path (read every line that executes)
T3: Implement the fix (after T1+T2 report)
T4: Verify the fix (reproduce original steps, confirm fixed)
```
**Status:** Hypothesis from debugging methodology. Test and measure.

## Dispatch Best Practices

- **Always include in dispatch:** Goal (1-2 sentences), Context (what they need), Deliverable (what "done" looks like), Constraints (what NOT to touch)
- **The 30-Second Rule:** After dispatching, watch for 30 seconds. Bad starts snowball.
- **Never assume context survives compaction.** Re-orient fully after every compaction event.
- **One task per terminal.** Don't stack "do A then B" — dispatch A, wait for DONE, then dispatch B.

## Claude Code Features To Use

- **`ultrathink`** — Use for architectural decisions, complex debugging, multi-file refactors
- **`/compact`** — Use mid-feature when conversation gets long, not just at limit
- **`/clear`** — Use between completely unrelated tasks (not just compact)
- **Hooks** — PreToolUse/PostToolUse for auto-format, dangerous command blocking (NOT YET CONFIGURED — candidate for adoption)
- **LSP plugins** — Real-time type errors after every edit (NOT YET INSTALLED — candidate for adoption)
- **Git worktrees** — `claude --worktree branch-name` for isolated parallel work (NOT YET TESTED — candidate for adoption)

## Research Protocol

When looking for new tools or techniques:

1. Check awesome-claude-code (github.com/hesreallyhim/awesome-claude-code) first
2. Check MCP registries: mcp.so, smithery.ai
3. Search HN, Reddit (r/ClaudeAI), Twitter for real user experiences
4. Verify security before any installation (see security-protocol.md)
5. Test on a throwaway project first
6. Compare metrics before/after adoption
7. Only promote to "active" in tool-registry.md if measurably better

## Known Anti-Patterns (Learned)

- **Don't mock databases in integration tests** — prior incident where mocked tests passed but prod migration failed
- **Don't add `--experimental-https` to Next.js dev scripts** — memory leak causes system crashes
- **Don't use `PUT /env-vars` on Render with partial lists** — it's destructive, replaces ALL vars
- **Don't use GKChatty** unless David explicitly requests it
- **Don't use localhost:4002 for PostForMe testing** — wrong database, messages disappear
