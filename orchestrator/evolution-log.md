# Evolution Log

> Append-only. Every self-modification to playbooks, tool-registry, or worker rules
> gets logged here with reasoning and evidence. This is David's audit trail.

## Format

```
### YYYY-MM-DD — [what changed]
**File:** [which file was modified]
**Change:** [what was added/removed/modified]
**Why:** [reasoning — what problem this solves]
**Evidence:** [metrics, test results, or observations that justify this change]
**Reversible:** [yes/no — can this be undone easily?]
```

---

### 2026-03-23 — Initial system creation
**File:** All orchestrator/ files
**Change:** Created identity.md, security-protocol.md, playbooks.md, tool-registry.md, evolution-log.md
**Why:** Establishing the self-improving orchestrator system based on deep research of existing frameworks (SICA, Karpathy AutoResearch, Boris Cherny self-improving CLAUDE.md, Anthropic long-running harness patterns)
**Evidence:** Research synthesis from 3 parallel research agents covering: self-improving AI agents, Claude Code advanced features, vibe coding ecosystem
**Reversible:** Yes — all new files, no existing files modified yet

### 2026-03-28 — ### Test Pattern
**Status:** hypothesis
**File:** orchestrator/playbooks.md
**Change:** ### Test Pattern
**Status:** hypothesis
**Why:** Testing evolve endpoint
**Evidence:** Manual test
**Reversible:** yes

### 2026-03-30 — Added Measured Insights section from Session 2026-03-29: Edit C-rating (use Writ
**File:** orchestrator/playbooks.md
**Change:** Added Measured Insights section from Session 2026-03-29: Edit C-rating (use Write instead), staggered dispatch, npm install sequencing
**Why:** First real metrics from self-improvement loop. Edit failures (0.42) vs Write (0.60) vs Bash (0.78) show clear tool preference hierarchy.
**Evidence:** 66 tool calls across 10 sessions. Edit: 6 invocations with failures. Bash: 29 invocations, high success.
**Reversible:** yes

### 2026-03-30 — Rejected hypothesis: For Bug Fixes
**File:** orchestrator/playbooks.md
**Change:** Rejected hypothesis: For Bug Fixes
**Why:** Metric worsened by >10% over 3+ sessions
**Evidence:** Target: Edit (success_rate) | Baseline: 0.313 (16 samples) | Test: 0.143 (7 samples) | Change: -54.3% | Test sessions: 5 | Worsened by 54.3% (>10% threshold)
**Reversible:** yes
