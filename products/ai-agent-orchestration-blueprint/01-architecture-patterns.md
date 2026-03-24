# Chapter 1: Architecture Patterns

> 5 proven patterns for multi-agent orchestration, from simple to advanced. Pick the one that matches your task complexity.

---

## Pattern 1: Hub-and-Spoke (The Workhorse)

**Best for**: Most tasks. 2-6 agents, clear scope boundaries.

```
                    +------------------+
                    |   ORCHESTRATOR   |
                    |  (Hub / Director)|
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
        +-----+----+  +-----+----+  +------+-----+
        | Worker 1  |  | Worker 2  |  | Worker 3   |
        | (Backend) |  | (Frontend)|  | (Testing)  |
        +-----------+  +----------+  +------------+
```

**How it works**:
- Orchestrator receives the goal
- Breaks it into scoped tasks
- Dispatches to workers in parallel
- Workers report status back to hub
- Hub resolves conflicts, routes information between workers
- Hub declares completion when all workers report DONE

**Orchestrator prompt structure**:
```
You are the orchestrator for a [PROJECT TYPE] project.
You have [N] worker terminals available:
- T1: [scope and tools]
- T2: [scope and tools]
- T3: [scope and tools]

Your job:
1. Break the goal into parallel tasks
2. Dispatch to workers with clear scope boundaries
3. Monitor status reports
4. Route information between workers when needed
5. Declare done only when ALL workers report DONE with evidence
```

**When to use**: This is your default. Start here unless you have a reason not to.

**Failure mode to watch for**: Orchestrator becomes a bottleneck if workers need constant cross-communication. If agents keep saying `NEED:` to request info from each other, consider Pattern 3.

---

## Pattern 2: Pipeline (The Assembly Line)

**Best for**: Sequential workflows where each stage's output feeds the next.

```
+-----------+     +----------+     +----------+     +----------+
| Stage 1   | --> | Stage 2  | --> | Stage 3  | --> | Stage 4  |
| Research  |     | Plan     |     | Build    |     | Verify   |
+-----------+     +----------+     +----------+     +----------+
```

**How it works**:
- Each stage produces a defined artifact
- The artifact is passed to the next stage as input
- Stages can have internal parallelism (e.g., Stage 3 might use Hub-and-Spoke)
- An orchestrator manages handoffs between stages

**Artifact contract**:
```markdown
## Stage 1 Output Contract
- File: /tmp/research-output.md
- Contains: Market analysis, competitor list, key findings
- Format: Markdown with H2 sections
- Completeness check: Must include at least 5 competitors with URLs

## Stage 2 Input Requirement
- Reads: /tmp/research-output.md
- Expects: Markdown with H2 sections containing competitor data
```

**When to use**: Research-then-build workflows, content pipelines, CI/CD-style processes.

**Failure mode**: If Stage 2 fails, everything downstream is blocked. Add validation between stages.

---

## Pattern 3: Mesh (The Democracy)

**Best for**: Highly interdependent tasks where agents need to communicate directly.

```
        +----------+
        | Agent A  |<--------+
        +----+-----+         |
             |                |
             v                |
        +----------+    +----+-----+
        | Agent B  |<-->| Agent C  |
        +----------+    +----------+
```

**How it works**:
- Agents communicate directly via shared state (files, message queues, databases)
- No central orchestrator — agents self-coordinate
- Each agent monitors shared state and reacts to changes
- Conflict resolution via conventions (e.g., file locking, ownership rules)

**Shared state example**:
```
/project/
  state/
    status.json          # Each agent updates its own entry
    contracts/
      api-schema.json    # Agent A writes, Agent B reads
      db-schema.json     # Agent B writes, Agent C reads
    locks/
      api-routes.lock    # Prevents concurrent modification
```

**When to use**: Rare. Only when agents are tightly coupled AND you need maximum speed. The coordination overhead usually isn't worth it.

**Failure mode**: Race conditions, inconsistent state, no single source of truth. Use Hub-and-Spoke instead unless you have a specific reason.

---

## Pattern 4: Supervisor Chain (The Hierarchy)

**Best for**: Large projects with 6+ agents, or projects with sub-teams.

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

**How it works**:
- Meta-orchestrator breaks project into team-level goals
- Team leads break team goals into individual tasks
- Workers report to their team lead
- Team leads report to meta-orchestrator
- Cross-team communication goes through team leads (never direct worker-to-worker)

**When to use**: Complex projects that would overwhelm a single orchestrator's context window. The hierarchy lets you manage more agents without context bloat.

**Failure mode**: Communication lag. Information takes 2 hops to move between workers on different teams. Mitigate with shared contract files.

---

## Pattern 5: Swarm (The Self-Organizing System)

**Best for**: Exploratory tasks where you don't know the structure upfront.

```
+-------+  +-------+  +-------+  +-------+
| Agent | <-> | Agent | <-> | Agent | <-> | Agent |
+-------+  +-------+  +-------+  +-------+
     ^                                  |
     +----------------------------------+
     All agents can see shared task board
```

**How it works**:
- A shared task board lists available work items
- Agents self-assign tasks based on their capabilities
- When an agent finishes, it picks the next available task
- Agents can spawn new tasks onto the board
- A lightweight coordinator monitors for stuck/failed tasks

**Task board format**:
```json
{
  "tasks": [
    {
      "id": "task-001",
      "status": "available",
      "description": "Research competitor pricing",
      "requires": ["web-search"],
      "assigned_to": null,
      "output": null
    },
    {
      "id": "task-002",
      "status": "in-progress",
      "description": "Build landing page",
      "requires": ["file-write", "html"],
      "assigned_to": "agent-3",
      "output": null
    }
  ]
}
```

**When to use**: Research tasks, content generation at scale, bug triage across a large codebase.

**Failure mode**: Without a clear coordinator, agents can duplicate work or miss dependencies. Always have at least one agent watching for conflicts.

---

## Choosing Your Pattern

| Scenario | Pattern | Why |
|----------|---------|-----|
| Build a feature with frontend + backend + tests | Hub-and-Spoke | Clear scope boundaries, parallel execution |
| Research → plan → build → deploy | Pipeline | Sequential dependencies |
| Two agents building tightly coupled API + client | Mesh | Need real-time coordination |
| Full product build with 8+ agents | Supervisor Chain | Too complex for single orchestrator |
| "Find and fix all accessibility issues in the app" | Swarm | Unknown scope, self-assigning work |
| Build a feature, then create content about it | Pipeline + Hub-and-Spoke | Stage 1 is a hub-spoke build, Stage 2 is content |

**The golden rule**: Start with Hub-and-Spoke. Upgrade to a more complex pattern only when you hit its limits.

---

*Next: [Communication Protocols](02-communication-protocols.md) — The exact syntax agents use to talk to each other.*
