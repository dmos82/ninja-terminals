# Reddit Post — r/PromptEngineering

**Title:** The prompt engineering skill nobody's talking about: writing prompts that coordinate multiple agents

**Body:**

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
