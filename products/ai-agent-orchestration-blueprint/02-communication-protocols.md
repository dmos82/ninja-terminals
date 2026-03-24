# Chapter 2: Communication Protocols

> The exact syntax agents use to report status, request help, and share interfaces. Copy these into your agent prompts verbatim.

---

## Why Structured Communication Matters

Free-form agent output is the #1 source of orchestration failures. When an agent says "I think I'm mostly done with the API," the orchestrator has no idea:
- Is it actually done?
- What was built?
- Were there errors?
- Can the next agent start?

Structured protocols eliminate ambiguity. The orchestrator can **parse** status lines programmatically, not guess from prose.

---

## The Core Protocol: STATUS Lines

Every worker agent must end its task with exactly one status line:

### DONE
```
STATUS: DONE — [what was accomplished] + [evidence]
```

**Good examples**:
```
STATUS: DONE — Built REST API with 6 endpoints, all tests pass (23/23), server running on port 3001
STATUS: DONE — Rendered 12 carousel slides, uploaded to R2, asset IDs: asset_abc123 through asset_abc134
STATUS: DONE — Research complete, findings in /tmp/research-output.md (2,400 words, 15 sources cited)
```

**Bad examples** (never do these):
```
STATUS: DONE — I think the API is working
STATUS: DONE — Built the feature
STATUS: DONE — Everything looks good
```

The difference: good status lines include **what** was done AND **proof** it works. Bad ones are vague assertions.

### BLOCKED
```
STATUS: BLOCKED — [exactly what you need to proceed]
```

**Good examples**:
```
STATUS: BLOCKED — Need the database schema from T3 before I can build the API routes
STATUS: BLOCKED — Gumroad API requires an access token, which I don't have. Need user to provide GUMROAD_ACCESS_TOKEN
STATUS: BLOCKED — Port 3000 is in use by another process. Need it freed or need a different port assignment
```

### ERROR
```
STATUS: ERROR — [what failed] + [what was tried] + [suggested fix]
```

**Good examples**:
```
STATUS: ERROR — npm install fails with ERESOLVE on react-dom@19. Tried --legacy-peer-deps (didn't help). Suggest: pin react-dom to 18.2.0
STATUS: ERROR — PostForMe render_video returns 500 consistently. Tried 3 different templates. Suggest: check if the PostForMe service is healthy
```

---

## Progress Reporting: PROGRESS Lines

For long-running tasks, report milestones so the orchestrator knows you're alive:

```
PROGRESS: [X/Y] — [what just completed]
```

**Examples**:
```
PROGRESS: 1/4 — Database schema created
PROGRESS: 2/4 — API routes built
PROGRESS: 3/4 — Tests written (18 test cases)
PROGRESS: 4/4 — Integration tests passing, moving to final verification
```

**When to use**: Any task that takes more than ~2 minutes. The orchestrator needs heartbeats.

---

## Build Status: BUILD Lines

After any code change that should compile/lint/pass:

```
BUILD: PASS
BUILD: FAIL — [error summary]
```

**Rule**: Never proceed past a BUILD: FAIL. Fix it first, then continue.

---

## Cross-Agent Communication

### Requesting Something From Another Agent

```
NEED: [file path or resource] — [what change is needed and why]
```

**Examples**:
```
NEED: /src/types/api.ts — Need the UserProfile type exported, I need it for the frontend components
NEED: T3 to run database migrations — My API tests depend on the users table existing
NEED: The Gumroad product URL — I need to embed it in the landing page
```

The orchestrator reads these and routes them to the appropriate worker.

### Publishing an Interface for Other Agents

When you create something that other agents will consume (API contract, type definitions, database schema), announce it:

```
CONTRACT: [description]
```

Then include the actual interface in a code block:

````
CONTRACT: REST API endpoints for user management

```typescript
// Base URL: http://localhost:3001/api

// GET /users — List all users
// Response: { users: User[], total: number }

// GET /users/:id — Get single user
// Response: User

// POST /users — Create user
// Body: { name: string, email: string }
// Response: User

// PUT /users/:id — Update user
// Body: Partial<User>
// Response: User

// DELETE /users/:id — Delete user
// Response: { success: boolean }

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}
```
````

The orchestrator copies contracts between terminals so agents stay in sync.

---

## The Complete Worker Prompt Template

Here's the full communication protocol section you should include in every worker agent's system prompt:

```markdown
## Communication Protocol

These status lines are CRITICAL — the orchestrator parses them to know your state.

**Always end your task with exactly one of:**
- `STATUS: DONE — [one-line summary of what you accomplished + evidence]`
- `STATUS: BLOCKED — [exactly what you need to proceed]`
- `STATUS: ERROR — [what failed, what you tried, suggested fix]`

**During work, report milestones:**
- `PROGRESS: [X/Y] — [what just completed]`
- `BUILD: PASS` or `BUILD: FAIL — [error summary]`

**Cross-terminal requests:**
- `NEED: [file path or resource] — [what change is needed and why]`
- `CONTRACT: [description]` followed by code block with the interface/types/schema

## Rules
- Do NOT report DONE for partial work
- Include evidence with DONE: test output, file path, URL, screenshot
- Fix BUILD: FAIL before proceeding — never skip a broken build
- If you're blocked for more than 30 seconds, report BLOCKED immediately
```

---

## Orchestrator-Side: Parsing Status

The orchestrator should scan worker output for these patterns:

```
Worker output contains "STATUS: DONE"   → Task complete, read evidence
Worker output contains "STATUS: BLOCKED" → Unblock or reassign
Worker output contains "STATUS: ERROR"  → Diagnose, retry, or escalate
Worker output contains "NEED:"          → Route request to appropriate worker
Worker output contains "CONTRACT:"      → Copy to dependent workers
Worker output contains "PROGRESS:"      → Update progress tracking
Worker output contains "BUILD: FAIL"    → Worker should self-fix; if repeated, intervene
```

### Orchestrator response to each status:

| Worker Says | Orchestrator Does |
|------------|-------------------|
| `STATUS: DONE` | Verify evidence, mark task complete, check if dependent tasks can start |
| `STATUS: BLOCKED` | Provide what's needed OR reassign to another worker |
| `STATUS: ERROR` | Read the suggested fix, decide whether to retry with guidance or reassign |
| `NEED: X from T3` | Copy the request to T3's next prompt |
| `CONTRACT: API schema` | Copy the contract to all dependent workers |
| `BUILD: FAIL` (2+ times) | Intervene directly — the worker is stuck in a loop |

---

## Anti-Patterns

| Don't Do This | Do This Instead |
|--------------|-----------------|
| Long prose explaining what you did | One-line STATUS with evidence |
| "I think it's working" | "Tests pass (14/14)" or "Server responds 200 on all endpoints" |
| Silently struggling for 5 minutes | PROGRESS report every major milestone |
| Modifying another agent's files | NEED: request to the owning agent |
| Assuming another agent's work is done | Wait for their STATUS: DONE |
| Ignoring BUILD: FAIL | Fix immediately, then continue |

---

*Next: [Prompt Templates](03-prompt-templates.md) — 25+ ready-to-use prompts for orchestrators and workers.*
