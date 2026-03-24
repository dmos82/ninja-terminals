# READY TO POST — Copy-Paste Package

> Tonight's posting run. Each section has the exact text to paste.
> Do them in order. Total time: ~15 minutes.

---

# HOW TO POST (Step-by-Step)

## Reddit (all 3 subreddits)

1. Go to reddit.com, make sure you're logged in
2. For each subreddit below:
   - Click **"Create Post"** (or go to `reddit.com/r/SUBREDDIT/submit`)
   - Select **"Text"** post type
   - Paste the **TITLE** into the title field
   - Paste the **BODY** into the body field
   - The Gumroad link will auto-format — no special formatting needed
   - Click **"Post"**
3. **Timing tip:** Space them 10-15 minutes apart to avoid spam filters
4. **Order:** r/ClaudeAI first (most relevant), r/PromptEngineering second, r/ChatGPT third

## Hacker News

1. Go to news.ycombinator.com
2. Click **"submit"** in the top nav
3. Paste the **TITLE** into the title field
4. Paste the **URL** into the url field
5. Leave the text field **BLANK** — HN Show posts with a URL don't use the text field (the text goes in the first comment instead)
6. Click **"submit"**
7. Immediately go to your post and **add the TEXT as the first comment**
8. **Timing:** Post between 8-10am EST for best visibility (if tonight, post and it'll get morning traction)

---
---

# 1. REDDIT — r/ClaudeAI

**Go to:** reddit.com/r/ClaudeAI/submit

---

### TITLE (copy this):

```
I built a system that runs 4 Claude Code terminals in parallel. Here's what actually works (and what doesn't).
```

### BODY (copy this):

```
I've been running a setup where a single Claude Code instance orchestrates 4 other Claude Code instances — each in its own terminal, working on different parts of a project simultaneously. One handles research, one builds the backend, one does the frontend, another writes tests. All at the same time.

It sounds cool in theory. In practice, it took a lot of trial and error to make it reliable. I wanted to share what I actually learned because I see a lot of "multi-agent" hype but not much about the unglamorous details.

**The setup**

Each terminal is a real PTY process running `claude` via node-pty. The orchestrator sends instructions through stdin, reads output via WebSocket, and parses structured status lines to know what each terminal is doing. Nothing fancy — Express server, xterm.js frontend, a 2x2 grid so you can watch all four at once.

**What actually works**

**Strict status protocols.** This was the single biggest improvement. Every terminal must end its task with one of three lines:

    STATUS: DONE — deployed API to staging, all 12 tests pass
    STATUS: BLOCKED — need the database schema from T2 before I can write migrations
    STATUS: ERROR — npm install fails, node-gyp can't find Python

Without this, you're reading four streams of terminal output trying to figure out who's done, who's stuck, and who wandered off to refactor something nobody asked for.

**File ownership boundaries.** Each terminal owns a directory. T1 owns `src/api/`, T2 owns `src/frontend/`, etc. If T2 needs a type exported from T1's code, it doesn't just edit T1's file — it sends a request through the orchestrator. This completely eliminated the "two agents editing the same file" problem that was destroying my builds early on.

**The 30-second rule.** After dispatching a task, I watch the terminal's output for 30 seconds. Just 30 seconds. This catches misunderstood instructions immediately instead of discovering 10 minutes later that an agent went in the wrong direction. Biggest ROI habit I developed.

**What doesn't work**

**Vague prompts.** Telling an agent "set up the database" gets you chaos. Telling it "create a PostgreSQL schema in `prisma/schema.prisma` with User and Session models, run `prisma migrate`, seed 3 test users, report STATUS: DONE with migrate output" gets you exactly what you want. The specificity tax is 2 minutes of prompt writing that saves 20 minutes of rework.

**Ignoring context compaction.** Claude Code auto-compacts when the context fills up. After 45+ minutes of work, a terminal will forget earlier decisions. If you don't plan for this — by re-orienting the agent with a summary of what it already did — it starts contradicting its own work. I treat compaction as an expected event, not an error. When it happens, I send a brief "you were doing X, you finished Y, next step is Z" message and the agent picks right back up.

**More than 4 terminals.** I tried 6. The coordination overhead (tracking who's doing what, relaying information between them, catching drift) ate all the time savings from parallelism. 4 is the sweet spot for one orchestrator. Beyond that you need sub-orchestrators, which is a whole other complexity layer.

**Fire-and-forget dispatching.** Dispatching all four tasks and coming back 10 minutes later sounds efficient. It isn't. One terminal will misread the instructions, another will hit a dependency it didn't expect, and by the time you check, half your agents have been spinning their wheels. Active supervision beats batch-and-pray every time.

**Actual results**

A task that would take me 2-3 hours in a single Claude Code terminal takes about 45 minutes with 4 terminals. Not 4x faster — coordination has overhead. But the real win is that I can run research and implementation simultaneously, get test coverage written alongside the main code, and catch integration issues earlier because the API and frontend are being built at the same time.

The orchestrator itself is about 400 lines of JavaScript. The hard part was never the code — it was figuring out the coordination patterns that actually work reliably.

**If anyone's curious**

I wrote up everything I learned — the architecture patterns, status protocols, prompt templates, context management strategies, the failure modes and how to handle them — into a guide. It's $12 on Gumroad if you want the whole thing: https://melodavid4.gumroad.com/l/ai-agent-blueprint

Happy to answer questions about the setup in the comments.
```

---
---

# 2. REDDIT — r/ChatGPT

**Go to:** reddit.com/r/ChatGPT/submit

---

### TITLE (copy this):

```
I've been running 4 AI agents in parallel instead of using one chat window. Here's what I learned.
```

### BODY (copy this):

```
I spent the last few months building a system where multiple Claude/GPT instances work on different parts of a project simultaneously — one handles backend code, another does frontend, a third writes tests, and an orchestrator coordinates them all.

It's a completely different experience from single-prompt usage. Instead of one agent context-switching between tasks (and forgetting things), each agent stays focused in its lane. A 3-hour project becomes 45 minutes.

Here are the 3 things that made the biggest difference:

**1. Structured status reporting changes everything**

Free-form agent output is why orchestration fails. When an agent says "I think I'm mostly done," you have no idea what actually happened.

Instead, I force every agent to end with exactly one of:

- `STATUS: DONE — built auth API, all 14 tests pass`
- `STATUS: BLOCKED — need database schema from the backend agent`
- `STATUS: ERROR — npm install fails on react-dom@19, tried --legacy-peer-deps, suggest pinning to 18.2`

The orchestrator can parse these instantly. No ambiguity, no guessing. The difference between "it should work" and "tests pass 14/14" is the difference between a system that works and one that wastes your time.

**2. Scope isolation beats shared context**

The #1 mistake: giving every agent access to everything. They step on each other's work, modify files they shouldn't, and create merge conflicts.

Instead, each agent owns specific files/directories. If Agent A needs something changed in Agent B's territory, it sends a structured request: `NEED: /src/types/api.ts — export the UserProfile type, I need it for frontend components`

The orchestrator routes these requests. No agent touches files it doesn't own. This alone eliminated 80% of the coordination problems I was hitting.

**3. Plan for context compaction or your agents will go in circles**

Here's something nobody talks about: during long tasks, the AI's context window fills up and older conversation gets compressed. The agent literally forgets what it did 20 minutes ago. It'll redo work, contradict itself, or ask questions it already answered.

The fix: after every major step, make agents write a checkpoint file to disk. If they get disoriented, they read their own checkpoint before continuing. The orchestrator also keeps a state summary ready to re-inject if an agent goes blank.

This turned context compaction from a project-killer into a minor hiccup.

---

I ended up writing all of this up properly — the 5 architecture patterns (hub-and-spoke, pipeline, mesh, supervisor chain, swarm), 13 prompt templates you can copy-paste, failure recovery playbooks, and 6 real-world workflows.

It's a markdown bundle called the AI Agent Orchestration Blueprint: https://melodavid4.gumroad.com/l/ai-agent-blueprint ($12 CAD)

Happy to answer questions about multi-agent setups in the comments.
```

---
---

# 3. REDDIT — r/PromptEngineering

**Go to:** reddit.com/r/PromptEngineering/submit

---

### TITLE (copy this):

```
The prompt engineering skill nobody's talking about: writing prompts that coordinate multiple agents
```

### BODY (copy this):

```
Most prompt engineering advice focuses on getting better output from a single model. That's important, but there's a higher-leverage skill emerging: writing prompts that let multiple AI agents work together on the same project without stepping on each other.

I've been building multi-agent orchestration systems — 4 AI instances running in parallel, each with a specialized role, coordinated by prompts. Here are the 3 prompting patterns that made it actually work:

**1. The Scoped Worker Prompt**

Every worker agent needs three things baked into its system prompt: what it owns, how to communicate, and when to stop.

```
You are T2 — FRONTEND. Your scope: /src/components/, /src/pages/

Task: Build the dashboard UI using the API contract from T1.

Constraints:
- Only modify files in /src/components/ and /src/pages/
- If you need changes outside your scope: NEED: [path] — [what and why]
- Run `npm run build` after every change
- Do NOT proceed past a broken build

End with exactly one of:
- STATUS: DONE — [what you built + evidence it works]
- STATUS: BLOCKED — [what you need to continue]
- STATUS: ERROR — [what failed, what you tried, suggested fix]
```

The key insight: "exactly one of" with a structured format. Agents naturally ramble. This forces a parseable output the orchestrator can act on programmatically.

**2. The Contract Publication Prompt**

When one agent produces something other agents consume (API schema, type definitions, database tables), you need a contract announcement pattern:

```
When you create interfaces that other agents will consume, announce them:

CONTRACT: REST API for user management
[code block with the full interface/types/schema]
```

The orchestrator copies these contracts between terminals. Without this, Agent B is guessing what Agent A built. With it, they're working from the same spec.

This single pattern eliminated the most common failure mode: agents building to different assumptions.

**3. The Self-Recovery Prompt**

Agents fail. Tools return errors. APIs time out. Most agent prompts don't account for this, so the agent either retries infinitely or gives up silently.

This block goes into every worker prompt:

```
When a tool call fails:
1. Read the error message — it usually tells you what's wrong
2. Try ONE alternative approach
3. If the alternative works, continue normally
4. If it also fails, report STATUS: ERROR with both attempts

Do NOT:
- Retry the same failing call more than twice
- Silently skip a failed step
- Spend more than 2 minutes on self-recovery before reporting
```

The "do NOT" section is critical. Without it, agents burn tokens in retry loops or — worse — quietly skip steps and report DONE for incomplete work.

---

**Bonus insight: prompt architecture > prompt wording**

In single-agent usage, the exact wording of your prompt matters a lot. In multi-agent orchestration, the *architecture* of your prompts matters more — which agent gets which scope, how they communicate, what happens when things fail.

The difference between a good single prompt and a great one might be 20% better output. The difference between running one agent vs. four coordinated agents is a 4x speed improvement with better quality (because each agent stays focused).

I wrote up the complete system: 5 architecture patterns, 13 ready-to-use prompt templates, communication protocols, failure recovery, and 6 end-to-end playbooks.

It's called the AI Agent Orchestration Blueprint — a markdown bundle you can use in Obsidian, Notion, or any editor: https://melodavid4.gumroad.com/l/ai-agent-blueprint ($12 CAD)

Open to questions about multi-agent prompt design.
```

---
---

# 4. HACKER NEWS — Show HN

**Go to:** news.ycombinator.com/submit

---

### TITLE (copy this):

```
Show HN: AI Agent Orchestration Blueprint – patterns for running multiple LLM agents in parallel
```

### URL (paste in the url field):

```
https://melodavid4.gumroad.com/l/ai-agent-blueprint
```

### FIRST COMMENT (post this immediately after submitting):

```
I've been running 4 Claude Code agents in parallel for the past few months to build software faster. Along the way I solved a set of problems that don't have much written about them yet, so I documented the patterns in a blueprint.

The core system is a Node.js app that spawns N pseudo-terminals via node-pty, each running an independent Claude Code CLI session. The terminals are exposed to a browser via xterm.js over WebSocket, and an orchestrating agent (a 5th Claude instance) drives them all through a combination of browser automation and a REST API.

Here are the engineering problems I ran into and the patterns that solved them:

**PTY isolation.** Each agent runs in its own pseudo-terminal with a clean environment (stripped of parent Claude env vars to prevent session conflicts). The PTY output is buffered server-side (rolling 10KB window) and used for status detection. The shell, working directory, and environment are isolated per-terminal so agents don't interfere with each other.

**Status detection from raw PTY output.** The server parses ANSI-stripped terminal output every 2 seconds to determine each agent's state: idle (prompt visible), working (tool calls like `Bash(`, `Read(`, `Edit(` detected), waiting_approval (permission prompts), compacting (context window compression), done, blocked, or error. This is regex-based pattern matching against the last 50 lines of output, with special handling for Claude's status bar noise. It's not elegant but it's reliable.

**Structured communication protocol.** Agents don't know about each other directly. Instead, each terminal loads a CLAUDE.md file that defines a text-based protocol: `STATUS: DONE — [summary]`, `STATUS: BLOCKED — [what's needed]`, `PROGRESS: [X/Y]`, `NEED: [filepath] — [request]`, `CONTRACT: [interface definition]`. The orchestrator polls the status API and parses these from each terminal's output buffer. It's basically structured logging for LLM agents.

**Context compaction recovery.** Claude Code compresses conversation history when approaching context limits. When this happens, agents lose memory of earlier work. The protocol handles this explicitly — agents that detect they're disoriented emit `STATUS: BLOCKED — context compacted, need task re-orientation`, and the orchestrator re-injects a summary of what was accomplished and what remains. This is the hardest problem in long-running agent tasks and there's no magic solution — you just need a protocol for it.

**WebSocket bridge architecture.** Each terminal gets its own WebSocket at `/ws/:id`. The connection is bidirectional: browser sends keystrokes, server sends raw PTY output. Resize events are sent as JSON frames inline with the raw data stream (the client-side parser tries JSON first, falls back to treating it as terminal input). New connections receive the full output buffer so they catch up to current state.

**Orchestrator pattern.** The 5th agent (the orchestrator) runs outside the app and drives it via browser automation + the REST API. It assigns scoped tasks to terminals (e.g., "T1: backend", "T2: frontend", "T3: tests"), monitors status, relays cross-terminal dependencies via the `NEED:` / `CONTRACT:` protocol, and handles compaction recovery. The orchestrator itself can compact, which is why the protocol is text-based and stateless — any new orchestrator instance can pick up by reading the status API.

The blueprint covers the full architecture: PTY management, status detection regexes, the communication protocol spec, WebSocket bridge design, orchestrator patterns, and failure modes I encountered (race conditions in status detection, context compaction cascades, file ownership conflicts between agents).

This isn't a framework or a library — it's a documented set of patterns. The actual implementation is ~350 lines of Node.js. I'm sharing it because most "AI agent" content focuses on prompt engineering or tool use, while the hard problems are in process isolation, state detection, and coordination.

Happy to answer questions about the architecture or specific failure modes.
```

---
---

# POSTING CHECKLIST

```
[ ] r/ClaudeAI        — paste title + body, submit
     (wait 10 min)
[ ] r/PromptEngineering — paste title + body, submit
     (wait 10 min)
[ ] r/ChatGPT          — paste title + body, submit
     (wait 10 min)
[ ] Hacker News         — paste title + URL, submit, then immediately comment with the text
[ ] Go back to each Reddit post after 30 min and reply to any early comments
```

> NOTE: Reddit's r/PromptEngineering body contains nested code blocks.
> If Reddit's editor mangles them, switch to **Markdown Mode** (not Fancy Pants)
> before pasting. All posts are formatted for Reddit markdown.
