# Show HN Post

**Title:** Show HN: AI Agent Orchestration Blueprint – patterns for running multiple LLM agents in parallel

**URL:** https://melodavid4.gumroad.com/l/ai-agent-blueprint

**Text:**

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
