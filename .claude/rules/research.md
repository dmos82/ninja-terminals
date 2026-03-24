---
description: Rules for tool discovery and research tasks
paths:
  - "orchestrator/**"
---

# Research & Tool Discovery Rules

When researching new tools, MCP servers, or techniques:

1. **Check existing registry first** — read orchestrator/tool-registry.md before searching
2. **Prioritize official/well-maintained sources** — Anthropic, major companies, >100 GitHub stars
3. **Always verify security** — follow orchestrator/security-protocol.md before any installation
4. **Test in isolation** — never test new tools on production codebases
5. **Measure before adopting** — compare metrics with and without the tool
6. **Log everything** — add candidates to tool-registry.md, log adoption decisions in evolution-log.md
7. **One tool at a time** — don't adopt multiple new tools simultaneously (can't attribute improvements)

## Sources to Check (in order)
1. awesome-claude-code (github.com/hesreallyhim/awesome-claude-code)
2. MCP registries: mcp.so, smithery.ai
3. Claude Code official docs: code.claude.com/docs
4. Hacker News, Reddit (r/ClaudeAI), Twitter/X
5. Anthropic engineering blog
