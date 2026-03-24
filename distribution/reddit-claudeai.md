# Reddit Post — r/ClaudeAI

**Title:** I built a system that runs 4 Claude Code terminals in parallel. Here's what actually works (and what doesn't).

**Body:**

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
