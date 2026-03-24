---
title: "How I Run 4 AI Agents in Parallel to Ship Software 3x Faster"
published: false
tags: ai, programming, productivity, tutorial
cover_image:
canonical_url:
---

I've been running multiple Claude Code instances in parallel for several months. Not as a novelty — as my primary development workflow. One orchestrator agent breaks a goal into scoped tasks, dispatches them to 4 worker agents running in separate pseudo-terminals, and coordinates their output until the project ships.

This post covers the architecture patterns, communication protocols, and failure recovery strategies I've developed. Everything here is based on production use, not theory.

## The Setup

The system is a Node.js app (~350 lines) that spawns N pseudo-terminals via `node-pty`, each running an independent Claude Code CLI session. A browser UI (xterm.js over WebSocket) lets you watch all terminals simultaneously. An orchestrating agent — a 5th Claude instance — drives the workers through browser automation and a REST API.

```
              +------------------+
              |   ORCHESTRATOR   |
              |  (5th instance)  |
              +--------+---------+
                       |
        +--------------+--------------+
        |              |              |
   +----+----+   +-----+----+   +----+-----+
   | Worker 1 |   | Worker 2 |   | Worker 3  |
   | (Backend)|   | (Frontend)|  | (Testing) |
   +-----------+  +----------+  +-----------+
```

Each worker runs in its own PTY with a clean environment — parent Claude env vars are stripped to prevent session conflicts. The orchestrator doesn't touch code directly; it delegates everything.

## Pattern 1: Hub-and-Spoke (Use This by Default)

The orchestrator receives a goal, breaks it into scoped tasks, and dispatches to workers in parallel. Workers report status. The orchestrator resolves conflicts and routes information between them.

This covers ~80% of use cases. A feature build with frontend + backend + tests? Hub-and-Spoke. A product launch with content + listing + distribution? Hub-and-Spoke.

**When it breaks down**: Workers need constant cross-communication. If every other message is a `NEED:` request between workers, you need a different pattern.

## Pattern 2: Pipeline (Assembly Line)

Sequential stages where each stage's output feeds the next:

```
+-----------+     +----------+     +----------+     +----------+
| Stage 1   | --> | Stage 2  | --> | Stage 3  | --> | Stage 4  |
| Research  |     | Plan     |     | Build    |     | Verify   |
+-----------+     +----------+     +----------+     +----------+
```

Each stage produces a defined artifact with a contract specifying format, location, and completeness criteria. The orchestrator validates the artifact before passing it downstream.

**Key insight**: Stages can have internal parallelism. Stage 3 (Build) might use Hub-and-Spoke internally with 3 workers, while the overall flow remains sequential.

## Pattern 3: Mesh (Rare, Use Carefully)

Agents communicate directly via shared state (files, JSON state files) with no central orchestrator. Each agent monitors shared state and reacts to changes.

```
/project/
  state/
    status.json          # Each agent updates its own entry
    contracts/
      api-schema.json    # Agent A writes, Agent B reads
    locks/
      api-routes.lock    # Prevents concurrent modification
```

**When to use**: Almost never. The coordination overhead and race conditions usually aren't worth it. Use Hub-and-Spoke with a responsive orchestrator instead.

## Pattern 4: Supervisor Chain (For Large Projects)

A meta-orchestrator delegates to team leads, who delegate to workers:

```
            +------------------+
            | META-ORCHESTRATOR|
            +--------+---------+
                     |
          +----------+----------+
          |                     |
 +--------+--------+  +--------+--------+
 | TEAM LEAD:      |  | TEAM LEAD:      |
 | Frontend        |  | Backend         |
 +----+-------+----+  +----+-------+----+
      |       |             |       |
   +--+--+ +--+--+      +--+--+ +--+--+
   |  W1 | |  W2 |      |  W3 | |  W4 |
   +-----+ +-----+      +-----+ +-----+
```

This solves context window bloat. A single orchestrator managing 8 agents will run out of context. The hierarchy keeps each node's scope manageable. Cross-team communication goes through team leads, never direct worker-to-worker.

## Pattern 5: Swarm (Self-Organizing)

A shared task board lists available work items. Agents self-assign based on capabilities and availability. When an agent finishes, it picks the next task.

```json
{
  "tasks": [
    {
      "id": "task-001",
      "status": "available",
      "description": "Research competitor pricing",
      "requires": ["web-search"],
      "assigned_to": null
    },
    {
      "id": "task-002",
      "status": "in-progress",
      "description": "Build landing page",
      "assigned_to": "agent-3"
    }
  ]
}
```

**Best for**: Unknown scope. "Find and fix all accessibility issues in the app" — you don't know how many issues exist or where they are, so let agents self-discover and self-assign.

### Choosing Your Pattern

| Scenario | Pattern |
|----------|---------|
| Build a feature (frontend + backend + tests) | Hub-and-Spoke |
| Research → plan → build → deploy | Pipeline |
| Tightly coupled API + client | Mesh (reluctantly) |
| Full product build, 8+ agents | Supervisor Chain |
| "Fix all the X in the codebase" | Swarm |

**The golden rule**: Start with Hub-and-Spoke. Upgrade only when you hit its limits.

---

## The Communication Protocol

This is the single most important part of the system. Free-form agent output kills orchestration. When an agent says "I think I'm mostly done with the API," the orchestrator has no idea whether it can start the next phase.

Structured protocols eliminate ambiguity. The orchestrator can parse status lines programmatically.

### Status Lines

Every worker ends its task with exactly one:

```
STATUS: DONE — [what was accomplished] + [evidence]
STATUS: BLOCKED — [exactly what you need to proceed]
STATUS: ERROR — [what failed, what you tried, suggested fix]
```

Good `DONE` examples:
```
STATUS: DONE — Built REST API with 6 endpoints, all tests pass (23/23), server running on port 3001
STATUS: DONE — Research complete, findings in /tmp/research-output.md (2,400 words, 15 sources cited)
```

Bad `DONE` examples:
```
STATUS: DONE — I think the API is working
STATUS: DONE — Everything looks good
```

The difference: good status lines include **what** was done AND **proof** it works.

### Progress Heartbeats

For tasks longer than ~2 minutes:

```
PROGRESS: [X/Y] — [what just completed]
```

Without these, the orchestrator can't distinguish "working" from "stuck."

### Build Status

After any code change:

```
BUILD: PASS
BUILD: FAIL — [error summary]
```

**Rule**: Never proceed past a `BUILD: FAIL`. Fix it first. This is non-negotiable — a broken build poisons everything downstream.

### Cross-Agent Communication

When an agent needs something from another agent's scope:

```
NEED: /src/types/api.ts — Need the UserProfile type exported for frontend components
```

When an agent produces an interface others will consume:

```
CONTRACT: REST API endpoints for user management
```
```typescript
// GET /users — Response: { users: User[], total: number }
// POST /users — Body: { name: string, email: string }

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}
```

The orchestrator copies `NEED` requests to the appropriate worker and broadcasts `CONTRACT` definitions to all dependent workers.

### Orchestrator-Side Parsing

| Worker Says | Orchestrator Does |
|------------|-------------------|
| `STATUS: DONE` | Verify evidence, mark complete, unblock dependents |
| `STATUS: BLOCKED` | Provide what's needed or reassign |
| `STATUS: ERROR` | Read suggested fix, retry with guidance or reassign |
| `NEED: X from T3` | Copy request to T3's next prompt |
| `CONTRACT: schema` | Copy to all dependent workers |
| `BUILD: FAIL` (2+ times) | Intervene — the worker is stuck in a loop |

---

## PTY Isolation and Status Detection

Each agent runs in its own pseudo-terminal with environment isolation:

```javascript
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  cwd: projectDir,
  env: {
    ...cleanEnv,  // Parent Claude vars stripped
    TERM: 'xterm-256color',
  },
});
```

The server buffers each terminal's output (rolling 10KB window) and runs status detection every 2 seconds by parsing ANSI-stripped output:

```javascript
function detectStatus(recentOutput) {
  const text = stripAnsi(recentOutput);
  const lines = text.split('\n').filter(Boolean);
  const last50 = lines.slice(-50).join('\n');

  // Idle: prompt visible, no active tool calls
  if (hasPrompt && !recentWork) return 'idle';

  // Waiting: permission prompts detected
  if (/accept edits|allow bash|\(y\/n\)/i.test(last50)) return 'waiting_approval';

  // Working: tool calls in progress
  if (/Bash\(|Read\(|Edit\(|Write\(/i.test(last50)) return 'working';

  // Done/Blocked: structured status lines
  if (/STATUS: DONE/i.test(last50)) return 'done';
  if (/STATUS: BLOCKED/i.test(last50)) return 'blocked';

  return 'working';
}
```

It's regex-based pattern matching against raw terminal output. Not elegant, but reliable. The main gotcha is Claude's status bar noise — spinner characters, MCP connection messages, effort indicators — which you need to filter out before checking for actual content.

---

## Failure Recovery

Things that **will** fail in multi-agent systems:

### Context Compaction

AI agents have finite context windows. During long tasks, the system compresses earlier conversation history. The agent literally forgets what it did.

**Symptoms**: Agent repeats completed work, asks answered questions, contradicts its earlier output.

**The protocol**:

Workers that detect disorientation emit:
```
STATUS: BLOCKED — context compacted, need task re-orientation
```

The orchestrator re-injects a summary:
```markdown
Your context was compacted. Here's your state:

**Original task**: Build the REST API
**Completed**: Schema created, 4/6 endpoints built, tests for first 4 passing
**Next step**: Build PUT /users/:id and DELETE /users/:id
**Files modified**: src/api/routes.ts, src/models/user.ts
**Build status**: PASS
```

**Prevention**: Have workers write checkpoint files after each major step. If context compacts, they can read the checkpoint to self-recover before reporting BLOCKED.

### Agent Loops

An agent gets stuck applying the same failing fix repeatedly.

**Detection**: `BUILD: FAIL` more than 2 times with the same error, or progress hasn't advanced in 3+ minutes.

**Recovery**: Stop the agent. Don't let it burn more tokens. Re-read what it was trying to do, diagnose the root cause yourself, and re-dispatch with a different approach.

The agent-side equivalent: if you've tried the same fix twice and it's still broken, **stop**. Report `STATUS: ERROR` with what you tried and a suggested alternative approach. Don't loop.

### Bad Output Propagation

The most dangerous failure: an agent produces incorrect output, and downstream agents build on it.

**Prevention**: Validation gates between stages.

```
+----------+     VALIDATE     +----------+     VALIDATE     +----------+
| Stage 1  | ----> GATE ----> | Stage 2  | ----> GATE ----> | Stage 3  |
+----------+                  +----------+                  +----------+
```

Before passing output downstream, check: Does the file exist? Is it non-empty? Is the format valid? Does the content match the contract? Does the agent's evidence check out?

If any check fails, re-run the stage. Do not proceed with bad input.

### Deadlocks

Agent A waits for Agent B, who waits for Agent A.

**Resolution**: The orchestrator detects the cycle and breaks it by having one agent produce a temporary stub. The other proceeds with the stub. Both update to final versions later.

### Coordination Failures

Two agents modify the same file simultaneously.

**Prevention**: File ownership tables in the orchestrator prompt.

```
| File/Directory | Owner |
|---------------|-------|
| /src/api/     | T1    |
| /src/frontend/| T2    |
| /src/shared/  | T1 (T2 reads only) |
| /tests/       | T3    |
```

If you need a change in another agent's files, use `NEED:`. Never modify files you don't own, even if it seems faster.

---

## Tool Integration Hierarchy

Not all tools are equal:

```
Priority 1: Native MCP tools     (fastest, most reliable)
Priority 2: API calls via code    (reliable, needs auth)
Priority 3: Browser automation    (flexible, but brittle)
Priority 4: Manual workarounds    (last resort)
```

If an MCP server exists for the task, use it. Don't browser-automate something that has a direct integration.

### MCP Configuration

MCP servers are configured in `.mcp.json` in your project root. Each agent in the project directory inherits these tools automatically:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

### Tool Scoping

Don't give every agent every tool. Assign tools based on scope:

- **Builder agent**: filesystem, code editor — nothing else
- **Browser agent**: browser automation, filesystem — for web interactions
- **Research agent**: web search, filesystem — for investigation
- **Deploy agent**: deployment CLI, health checks — for shipping

Agents get confused by tool overload. More tools = more ways to go wrong.

---

## Graceful Degradation

When you can't recover, degrade rather than fail completely:

1. Can another agent absorb the failed work? (merge scopes)
2. Can you ship a reduced version? (skip the failing component)
3. Can the orchestrator do it manually? (direct execution)

Priority: **Ship something > ship everything > ship nothing.**

Communicate clearly: "T3 failed on integration tests. Proceeding with unit test coverage only. Integration tests will need manual verification."

---

## What I Didn't Cover

This post covers the architecture, protocol, and failure modes — roughly 80% of what you need. What's missing:

- **25+ copy-paste prompt templates** for orchestrators, workers, research agents, testing agents, deployment agents, browser automation agents, context recovery, conflict resolution, and product launch coordination
- **6 complete end-to-end playbooks** with exact agent assignments, dependency graphs, and timelines for: digital product launch (90 min), full-stack feature build (2-3 hrs), research deep dive (45 min), content sprint (60 min), bug triage swarm (30 min), and competitive analysis (60 min)
- **Custom MCP server patterns** with TypeScript starter code
- **Orchestrator prompt internals** — the exact prompt structure I use for the conductor agent

I packaged all of this into the [AI Agent Orchestration Blueprint](https://melodavid4.gumroad.com/l/ai-agent-blueprint) — a 7-chapter markdown bundle ($12) that works in Obsidian, Notion, or any markdown viewer. It's the complete reference I wish existed when I started building this system.

---

## Core Principles (TL;DR)

1. **Scope isolation beats shared context.** Agents that own specific files produce better output than agents that touch everything.
2. **Structured communication beats prose.** `STATUS: DONE — tests pass (14/14)` > "I think I'm done."
3. **Autonomy with guardrails.** Workers self-recover from errors but escalate when truly blocked.
4. **Evidence over assertion.** Never accept "it should work." Require proof.
5. **Parallel by default.** If two tasks don't depend on each other, run them simultaneously.

The patterns here work with Claude Code, GPT, Gemini, or any LLM with tool access. The hard problems in agent orchestration aren't model-specific — they're about process isolation, state detection, and coordination. Those are engineering problems, and they have engineering solutions.
