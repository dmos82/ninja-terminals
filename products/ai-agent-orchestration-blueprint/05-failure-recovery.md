# Chapter 5: Failure Recovery

> When things go wrong — and they will. Self-healing agents, context compaction, graceful degradation, and the patterns that keep your orchestration running.

---

## The Reality of Multi-Agent Systems

Things that will fail:
- An agent's context window fills up and compacts (loses memory of earlier work)
- An MCP server crashes or becomes unresponsive
- An API returns errors or rate-limits
- An agent produces incorrect output that poisons downstream work
- Two agents modify the same file simultaneously
- A browser automation step fails because the page changed
- An agent gets stuck in a retry loop

You don't prevent these — you plan for them.

---

## Failure Category 1: Context Compaction

### What happens
AI agents have finite context windows (100K-200K tokens). During long tasks, the system compresses earlier conversation history to make room. The agent literally **forgets** what it did earlier.

### Symptoms
- Agent repeats work it already did
- Agent asks questions it already answered
- Agent loses track of which step it's on
- Agent's output contradicts its earlier output

### Prevention
Build compaction resilience into worker prompts:

```markdown
## Context Compaction Resilience

Your context WILL compact during long tasks. To survive this:

1. After completing each major step, write a checkpoint file:
   File: /project/state/t[N]-checkpoint.md
   Contents: What's done, what's next, key decisions made

2. If you feel disoriented (don't remember earlier work), read your checkpoint file first

3. Critical information goes in files, not just in conversation:
   - Decisions → /project/state/decisions.md
   - Contracts → /project/shared/contracts/
   - Progress → /project/state/progress.json
```

### Recovery (Orchestrator-Side)

When you detect a compacted agent:

```markdown
## Context Recovery for T[N]

Your context was compacted. Here's your current state:

**Original task**: [FULL TASK DESCRIPTION]
**Completed steps**:
1. [STEP 1 — with evidence/output reference]
2. [STEP 2 — with evidence/output reference]
3. [STEP 3 — with evidence/output reference]

**Next step**: [EXACTLY WHAT TO DO NEXT]

**Files you've modified**: [LIST]
**Current build status**: [PASS/FAIL]
**Checkpoint file**: Read /project/state/t[N]-checkpoint.md for full context

Continue from step [N]. All previous protocols still apply.
```

---

## Failure Category 2: Tool Failures

### Self-Recovery Protocol

Build this into every worker prompt:

```markdown
## Self-Recovery

When a tool call fails:
1. Read the error message carefully — it often tells you exactly what's wrong
2. Try ONE alternative approach (different tool, different parameters, different method)
3. If the alternative works, continue normally
4. If the alternative also fails, report ERROR with both attempts

When an MCP server is unresponsive:
1. Try the call again (once)
2. If still unresponsive, check if you can accomplish the same thing via browser automation or API
3. If no alternative exists, report BLOCKED

Do NOT:
- Retry the same failing call more than twice
- Silently skip a failed step and pretend it worked
- Spend more than 2 minutes on self-recovery before reporting
```

### Common Failures and Fixes

| Failure | Likely Cause | Recovery |
|---------|-------------|----------|
| MCP tool returns empty result | Service is down or auth expired | Try alternative tool or browser automation |
| `npm install` fails | Dependency conflict | Try `--legacy-peer-deps` or pin versions |
| API returns 401 | Token expired | Report BLOCKED — need fresh credentials |
| API returns 429 | Rate limited | Wait specified duration, then retry once |
| Browser element not found | Page structure changed | Try finding element by text content instead of selector |
| File write permission denied | Wrong directory or sandbox | Check path, try an allowed directory |
| Build fails with type error | Missing or wrong type definition | Read the error, fix the type, rebuild |
| Git conflict | Another agent modified same file | Report NEED — orchestrator resolves ownership |

---

## Failure Category 3: Bad Output Propagation

The most dangerous failure: an agent produces incorrect output, and downstream agents build on it.

### Prevention: Validation Gates

```
+----------+     VALIDATE     +----------+     VALIDATE     +----------+
| Stage 1  | ----> GATE ----> | Stage 2  | ----> GATE ----> | Stage 3  |
+----------+                  +----------+                  +----------+
```

Between each stage, the orchestrator (or a validation agent) checks:

```markdown
## Validation Checklist

Before passing Stage [N] output to Stage [N+1]:

1. Does the output file exist at the expected path?
2. Is the file non-empty?
3. Does the format match the contract? (JSON is valid JSON, schema matches, etc.)
4. Does the content make sense? (Not truncated, not placeholder text)
5. Does the agent's STATUS: DONE evidence check out?

If ANY check fails: Do not proceed. Re-run Stage [N] with clarified instructions.
```

### The "Garbage In, Garbage Out" Rule

```markdown
## Input Validation (Worker Prompt Addition)

Before starting your task, validate your inputs:
1. Read any input files you depend on
2. Verify they contain what you expect (not empty, not placeholder, correct format)
3. If inputs are invalid, report BLOCKED immediately:
   `STATUS: BLOCKED — Input file [PATH] is [empty/malformed/missing]. Cannot proceed.`

Do NOT attempt to work with bad inputs. Bad inputs produce bad outputs.
```

---

## Failure Category 4: Coordination Failures

### Race Conditions

Two agents trying to modify the same file simultaneously:

**Prevention**:
```markdown
## File Ownership Rules

Each file has exactly one owner. Only the owner modifies it.

| File/Directory | Owner |
|---------------|-------|
| /src/api/     | T1    |
| /src/frontend/| T2    |
| /src/shared/  | T1 (T2 reads only) |
| /tests/       | T3    |
| /docs/        | T4    |

If you need a change in another agent's files, use NEED: to request it.
NEVER modify files you don't own, even if it seems faster.
```

### Deadlocks

Agent A waits for Agent B, who waits for Agent A:

**Prevention**:
- The orchestrator tracks all NEED requests
- If it detects a cycle (A needs B, B needs A), it breaks the deadlock by:
  1. Having one agent produce a temporary/stub version
  2. Letting the other agent proceed with the stub
  3. Replacing the stub with the real version later

```markdown
## Deadlock Detection (Orchestrator)

If two workers are both BLOCKED waiting for each other:
1. Identify which dependency is simpler to stub
2. Tell that worker: "Produce a temporary version of [X] with [these assumptions].
   T[other] will use this to unblock. You'll update it later."
3. After both are unblocked, coordinate the final integration
```

---

## Failure Category 5: Agent Loops

An agent gets stuck doing the same thing over and over.

### Detection
```markdown
## Loop Detection (Orchestrator)

Watch for these signs:
- Agent reports BUILD: FAIL more than 2 times in a row with the same error
- Agent's PROGRESS hasn't advanced in 3+ minutes
- Agent is making the same tool call repeatedly with same parameters
- Agent's output repeats similar phrases/approaches

If detected:
1. STOP the agent (don't let it burn more tokens)
2. Re-read what the agent was trying to do
3. Diagnose the root cause yourself (don't ask the stuck agent — it's in a loop)
4. Re-dispatch with a DIFFERENT approach or more specific instructions
```

### Agent-Side Loop Prevention

```markdown
## Self-Monitoring

If you notice:
- You've tried the same fix twice and it's still failing: STOP
- You're about to retry something that already failed with the same approach: STOP
- Your build has failed 3+ times on the same error: STOP

Instead:
1. Re-read the entire error chain
2. Ask: "Am I fixing the symptom or the root cause?"
3. If unsure, report:
   `STATUS: ERROR — Stuck in a loop on [issue]. Tried: [approach 1], [approach 2]. Root cause unclear. Suggest: [fresh approach or need more context]`
```

---

## The Recovery Playbook

Quick reference for the orchestrator:

| Situation | Action |
|-----------|--------|
| Agent context compacted | Send context recovery prompt with state summary |
| Agent stuck in loop | Stop, diagnose root cause, re-dispatch with new approach |
| MCP server down | Tell agent to use alternative tool or browser automation |
| Two agents need same file | Establish clear ownership, use NEED protocol |
| Deadlock between agents | Break cycle with temporary stub |
| Bad output propagating | Catch at validation gate, re-run failed stage |
| Agent reports ERROR | Read their suggested fix, decide to retry or reassign |
| Agent goes silent | Check if context compacted; if so, re-orient |
| Build won't pass | Read the actual error; dispatch targeted fix |
| Agent produces garbage | Likely bad input — trace upstream to find the source |

---

## Graceful Degradation

When you can't recover, degrade gracefully rather than failing completely:

```markdown
## Degradation Strategy

If [CRITICAL AGENT] fails completely:
1. Can another agent absorb its work? (merge scopes)
2. Can we ship a reduced version? (skip the failing component)
3. Can we switch to a manual fallback? (orchestrator does it directly)

Priority: Ship something > ship everything > ship nothing.

Communicate the degradation:
"T[N] failed on [task]. Proceeding without [component].
The delivered product will lack [feature] but is otherwise complete."
```

---

*Next: [Real-World Playbooks](06-real-world-playbooks.md) — 6 complete workflows you can run today.*
