# Plan: True Self-Improvement Automation

## Goal
Make Ninja Terminals actually self-improving — no human in the loop between sessions.

## Current State
- Data capture works (PostToolUse hooks → NDJSON)
- Analysis works (analyze-session.js, tool-rater.js)
- Playbook promotion logic exists (promotePlaybooks())
- **BUT: Nothing is automated. Human must run scripts and update playbooks manually.**

## Target State
```
Session N ends
  → Auto-analyze all raw NDJSON files
  → Auto-compute tool ratings
  → Auto-compare to Session N-1
  → Auto-promote/reject playbook hypotheses
  → Auto-inject insights into next dispatch

Session N+1 starts
  → Pre-dispatch loader reads ratings + playbooks
  → Dispatch prompts include "prefer Write over Edit" etc.
  → Terminals work with updated guidance
  → Loop continues
```

---

## Phase 1: Pre-Dispatch Intelligence (T1)

### File: `lib/pre-dispatch.js`

**Inputs:**
- `orchestrator/metrics/summaries.ndjson`
- `orchestrator/metrics/tool-ratings.json` (to be created by tool-rater)
- `orchestrator/playbooks.md`

**Outputs:**
- Object with `{ toolGuidance: string[], playbookInsights: string[], terminalHints: {} }`

**Logic:**
1. Read tool-ratings.json
2. For tools with rating C or below → add guidance: "Avoid [tool] for [use case], prefer [alternative]"
3. For tools with rating A or S → add guidance: "Prefer [tool] for [use case]"
4. Read validated playbook entries → extract actionable rules
5. Read recent summaries → identify terminal performance patterns (e.g., "T2 was 30% faster than T1 last session")

**Integration point:**
- Export `getPreDispatchContext()` function
- Called by dispatch endpoint or orchestrator before sending input

---

## Phase 2: Post-Session Automation (T2)

### File: `lib/post-session.js`

**Trigger:** Called when session ends (all terminals idle for 5+ minutes, or manual `/api/session/end`)

**Steps:**
1. Find all unprocessed NDJSON files in `orchestrator/metrics/raw/`
2. Run `analyzeSession()` on each → append to summaries.ndjson
3. Run `rateTools()` → write to tool-ratings.json
4. Run `promotePlaybooks()` → get promotion recommendations
5. If promotions exist:
   - Update playbooks.md (change **Status:** from "hypothesis" to "validated")
   - Log to evolution-log.md with evidence
6. Compare this session's metrics to previous session:
   - If hypothesis was applied AND metrics improved → promote
   - If hypothesis was applied AND metrics worsened → reject (revert in playbooks.md)

**New endpoint:** `POST /api/session/end` — triggers post-session automation

---

## Phase 3: Dispatch Injection (T3)

### Modify: `server.js` dispatch/input endpoint

**Before sending input to a terminal:**
1. Call `getPreDispatchContext()`
2. If guidance exists, prepend to the user's prompt:
   ```
   [SYSTEM GUIDANCE from prior sessions]
   - Prefer Write over Edit for new files (Edit has C rating: 0.42)
   - Use staggered dispatch: T1 first, wait for DONE, then T2-T4
   - Glob is most reliable for directory scanning (A rating: 0.80)
   [END GUIDANCE]

   [User's actual task prompt here]
   ```
3. Log that guidance was injected (for metrics)

**Toggle:** Add config flag `INJECT_GUIDANCE=true` (default true, can disable for A/B testing)

---

## Phase 4: Hypothesis Validation (T4)

### File: `lib/hypothesis-validator.js`

**Data needed:**
- playbooks.md entries with **Status:** "hypothesis" or "testing"
- Session summaries before/after hypothesis was applied

**Logic:**
1. Parse playbooks.md for hypothesis entries
2. For each hypothesis, find:
   - Sessions BEFORE it was added (baseline)
   - Sessions AFTER it was added (test)
3. Compare relevant metrics:
   - If hypothesis says "prefer Write over Edit" → compare Edit failure rate before/after
   - If hypothesis says "staggered dispatch" → compare overall session time before/after
4. Decision rules:
   - 3+ test sessions AND metric improved by >10% → promote to "validated"
   - 3+ test sessions AND metric worsened by >10% → reject, revert guidance
   - Otherwise → keep as "testing", need more data

**Output:** List of { hypothesis, decision: 'promote'|'reject'|'continue', evidence }

---

## Terminal Assignment

| Terminal | Task | Files |
|----------|------|-------|
| T1 | Pre-dispatch intelligence | `lib/pre-dispatch.js` |
| T2 | Post-session automation | `lib/post-session.js`, modify endpoints |
| T3 | Dispatch injection | Modify `server.js` input endpoint |
| T4 | Hypothesis validation | `lib/hypothesis-validator.js` |

## Dependencies
- T3 depends on T1 (needs `getPreDispatchContext()`)
- T2 depends on T4 (needs `validateHypotheses()` for auto-promotion)
- T1 and T4 are independent

## Dispatch Order
1. First wave: T1 + T4 (parallel, no dependencies)
2. Second wave: T2 + T3 (after T1 + T4 complete)

## Success Criteria
After implementation, run 3 test sessions:
1. Session A: Baseline (no guidance injection)
2. Session B: With guidance injection enabled
3. Session C: After one hypothesis promotion cycle

Compare:
- Total session time
- Tool failure rates
- Number of terminal interventions needed

If Session C outperforms Session A by >15% on any metric → self-improvement is real.

---

## Verification Checklist
- [ ] `getPreDispatchContext()` returns structured guidance
- [ ] `POST /api/session/end` triggers full analysis pipeline
- [ ] Dispatch prompts include injected guidance when enabled
- [ ] Hypotheses auto-promote after 3+ successful sessions
- [ ] evolution-log.md gets automatic entries with evidence
- [ ] A/B toggle works (can disable for comparison)
