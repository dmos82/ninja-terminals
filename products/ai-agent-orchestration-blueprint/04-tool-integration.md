# Chapter 4: Tool Integration

> MCP servers, browser automation, APIs, and the tools that give your AI agents hands. What to connect, how to configure, and when to use each.

---

## The Tool Hierarchy

Not all tools are equal. Use the most direct, reliable option:

```
Priority 1: Native MCP tools     (fastest, most reliable, structured data)
Priority 2: API calls via code    (reliable, but requires auth setup)
Priority 3: Browser automation    (flexible, but brittle and slow)
Priority 4: Manual workarounds    (last resort)
```

**Rule**: If an MCP tool exists for the task, use it. Don't browser-automate something that has a direct integration.

---

## MCP (Model Context Protocol) — The Standard

MCP is the emerging standard for connecting AI agents to external tools and services. Think of it as USB-C for AI — a universal connector.

### How MCP Works

```
+------------+       MCP Protocol       +-------------+
|  AI Agent  | <-------- JSON-RPC --------> | MCP Server  |
|  (Client)  |                           | (Tool)      |
+------------+                           +-------------+
                                               |
                                         +-----+-----+
                                         | External  |
                                         | Service   |
                                         +-----------+
```

The agent sends structured requests to MCP servers. Each server exposes **tools** (functions the agent can call) and **resources** (data the agent can read).

### Configuration

MCP servers are typically configured in a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@anthropic/gmail-mcp"],
      "env": {
        "GMAIL_CREDENTIALS": "/path/to/credentials.json"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
    }
  }
}
```

### Essential MCP Servers for Agent Orchestration

| MCP Server | What It Does | Use When |
|------------|-------------|----------|
| **Filesystem** | Read/write files in specified directories | Agents need to share files |
| **GitHub** | Create repos, PRs, issues, manage code | Code collaboration |
| **Gmail** | Read/send emails, manage inbox | Email automation |
| **Google Calendar** | Schedule, modify, query events | Calendar management |
| **Slack** | Send/read messages in channels | Team communication |
| **PostgreSQL/SQLite** | Query and modify databases | Data operations |
| **Puppeteer/Playwright** | Browser automation via MCP | Web interaction |
| **Fetch** | HTTP requests to any API | Custom API integration |

### Building Custom MCP Servers

If your tool doesn't have an MCP server, build one. The minimum viable server:

```typescript
// my-tool-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const server = new Server({
  name: "my-tool",
  version: "1.0.0",
});

// Define a tool
server.setRequestHandler("tools/list", async () => ({
  tools: [{
    name: "do_thing",
    description: "Does the thing",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "What to process" }
      },
      required: ["input"]
    }
  }]
}));

// Implement the tool
server.setRequestHandler("tools/call", async (request) => {
  if (request.params.name === "do_thing") {
    const result = await myFunction(request.params.arguments.input);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
});

server.connect(new StdioServerTransport());
```

---

## Browser Automation

When there's no API or MCP server, browser automation is your fallback. Your agent can navigate websites, fill forms, click buttons, and extract data.

### Available Approaches

| Approach | Strengths | Weaknesses |
|----------|-----------|------------|
| **Claude Computer Use** | Sees the screen like a human; works on any UI | Slower, uses more tokens, can misclick |
| **Playwright/Puppeteer MCP** | Fast, precise DOM interaction | Breaks when UI changes |
| **Chrome DevTools Protocol** | Direct browser control, network monitoring | Complex setup |
| **Skyvern** | Computer vision-based, resilient to layout changes | External service dependency |

### Browser Automation Best Practices

1. **Screenshot after every action** — Evidence trail + helps the agent self-correct
2. **Wait for page loads** — Don't click before the page is ready
3. **Handle auth carefully** — Never hardcode credentials in prompts; use environment variables
4. **Expect failure** — Pages change, elements move, CAPTCHAs appear. Build retry logic
5. **Avoid triggering alerts/dialogs** — JavaScript `alert()` and `confirm()` block the browser event loop

### Example: Listing a Product on a Marketplace

```markdown
## Browser Task: List product on [PLATFORM]

Steps:
1. Navigate to [PLATFORM URL]
2. Screenshot the page (evidence of starting state)
3. Click "Create New Listing" (or equivalent)
4. Fill form fields:
   - Title: [PRODUCT TITLE]
   - Description: [PRODUCT DESCRIPTION]
   - Price: [PRICE]
   - Category: [CATEGORY]
5. Upload cover image from [FILE PATH]
6. Screenshot the completed form (evidence before submission)
7. Click "Publish" / "Submit"
8. Screenshot the confirmation page (evidence of success)
9. Copy the product URL

Output: STATUS: DONE — Listed on [PLATFORM], URL: [URL], screenshots at [PATHS]
```

---

## API Integration

For services with REST APIs but no MCP server, agents can make HTTP requests directly.

### Pattern: API Wrapper in Agent Instructions

```markdown
## API Access: [SERVICE NAME]

Base URL: [BASE_URL]
Auth: Bearer token in Authorization header
Token: Available in environment variable [ENV_VAR_NAME]

### Available Endpoints:
- GET /items — List all items
- POST /items — Create item (body: { name, description, price })
- PUT /items/:id — Update item
- DELETE /items/:id — Delete item

### Usage:
Use curl or the fetch tool to interact with this API.
Always check response status codes:
- 200/201: Success
- 401: Auth failed — check token
- 429: Rate limited — wait 60 seconds
- 500: Server error — retry once, then report ERROR
```

---

## Tool Assignment Strategy

Not every agent needs every tool. Assign tools based on scope:

### Example: 4-Terminal Product Launch

```
T1 (Product Builder):
  Tools: filesystem, code editor
  Why: Needs to create/edit files, nothing else

T2 (Sales Page):
  Tools: browser automation, filesystem
  Why: Needs to interact with Gumroad/Stripe, upload files

T3 (Content Creator):
  Tools: filesystem, image generation (if available)
  Why: Writes content files, may need to create visuals

T4 (Distribution):
  Tools: social media MCP, email MCP, browser automation
  Why: Posts to social platforms, sends emails
```

### Anti-Patterns

| Don't | Why |
|-------|-----|
| Give every agent every tool | Agents get confused by tool overload; increases risk surface |
| Let agents install packages without review | Supply chain risk; one bad `npm install` can compromise everything |
| Share API tokens across agents | If one agent is compromised, others are protected |
| Use browser automation for things with APIs | Slower, more fragile, more expensive (more tokens) |
| Let agents manage their own credentials | Credentials should be injected via env vars, never generated/stored by agents |

---

## Shared State Between Agents

When agents need to share data, use the filesystem as the coordination layer:

```
/project/
  shared/
    contracts/           # Published API contracts, schemas
      api-schema.json
      db-schema.sql
    artifacts/           # Produced files
      product.pdf
      cover-image.png
    state/
      progress.json      # Each agent updates its own key
```

### Progress File Pattern

```json
{
  "t1": {
    "status": "done",
    "task": "Build product PDF",
    "output": "/project/shared/artifacts/product.pdf",
    "timestamp": "2026-03-11T10:30:00Z"
  },
  "t2": {
    "status": "in-progress",
    "task": "Set up Gumroad listing",
    "progress": "3/5",
    "timestamp": "2026-03-11T10:32:00Z"
  },
  "t3": {
    "status": "waiting",
    "task": "Create social media content",
    "blocked_by": "t2 — need product URL",
    "timestamp": "2026-03-11T10:28:00Z"
  }
}
```

---

*Next: [Failure Recovery](05-failure-recovery.md) — When things go wrong (and they will).*
