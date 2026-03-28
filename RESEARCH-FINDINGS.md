# Ninja Terminals — Research Findings (2026-03-11)

## The Arsenal (What We Actually Have)

### Running Right Now
| System | Status | What It Does |
|--------|--------|-------------|
| **Ninja Terminals** | localhost:3000 | 4 Claude Code Opus 4.6 terminals, orchestrated via chrome automation |
| **OpenClaw/MoltenClawd** | Docker, 8+ days uptime | Telegram bot + GPT-5.2 + web search + Moltbook + StudyChat |
| **PostForMe** | postforme.ca + MCP | Video generation (Remotion), Meta publishing, ads, scheduling |
| **StudyChat** | Cloud service | RAG knowledge base, DMs, C2C messaging, user lookup |
| **SearXNG** | Docker (via OpenClaw) | Private web search engine, unlimited, no API key |

### OpenClaw Docker Stack (5 containers)
- `openclaw-gateway` — Main agent (Telegram, GPT-5.2, 400K context)
- `openclaw-terminal-proxy` — Bridge to Claude Code on host
- `openclaw-relay-proxy` — Bridge to Claude relay on host
- `openclaw-search-proxy` — Translates Brave API → SearXNG
- `openclaw-searxng` — Private search engine

### OpenClaw Capabilities
- **Telegram bot** — Live, can receive/send messages to anyone
- **Moltbook** — Registered as "MoltenClawd", has API key, can post/comment/upvote
- **Web search** — Via SearXNG (free, unlimited)
- **File system** — Read/write within Docker workspace
- **Memory** — Persistent markdown-based memory
- **StudyChat skill** — Monitor new users, respond to DMs, welcome emails
- **C2C** — Can communicate with Claude Code instances
- **Skills** — Modular plugin system, 13,729+ community skills on ClawHub

### MCP Tools (170+ total)
- **Content**: 45 tools (Remotion rendering, asset management, brand profiles)
- **Publishing**: 10 tools (IG/FB feed, reels, stories, carousels, scheduling)
- **Advertising**: 16 tools (campaigns, targeting, performance analysis)
- **Communication**: 9 tools (Gmail, StudyChat DMs, C2C, voice)
- **Browser**: 25 tools (Chrome automation, screenshots, forms, Lighthouse)
- **Research**: 6 tools (web search, knowledge bases)
- **Infrastructure**: 9 tools (Netlify, Render billing)
- **Code Quality**: 18 tools (review, security scan, auto-fix, build loops)

---

## T1 Research: Fastest Paths to $20 (Real Data)

### TIER 1: Same-Day Realistic
| Method | Speed | Pay | Barrier |
|--------|-------|-----|---------|
| Direct service to someone you know | Hours | $50+ | Need to know people |
| AI Training / RLHF (Outlier, Remotasks) | Same day to ~1 week | $30-56/hr | Qualification tests |
| Upwork micro-gigs ($20-100 fixed) | Hours (if profile exists) | $20-100 | Need existing profile |

### TIER 2: 1-3 Day Ramp
| Method | Speed | Pay | Barrier |
|--------|-------|-----|---------|
| Gumroad digital product (template, guide) | 1-3 days | $5-50/sale | Need traffic |
| Fiverr gig (AI-powered service) | 1-3 days | $5-50/gig | Profile setup + wait |

### TIER 3: Don't Bother for Same-Day
- Bug bounties (weeks between payouts)
- Micro-SaaS (95%+ fail in month 1, ~3 months to revenue)
- AI affiliate blogs (one test earned $0.94)
- "$700/day AI side hustle" content (clickbait)

### T1's Bottom Line
> "If I had to make $20 today, in order:
> 1. Text someone I know and offer to solve a specific problem for $50
> 2. Sign up for Outlier/Remotasks/DataAnnotation and start qualification
> 3. If I had an Upwork profile, fire off 10 targeted proposals on small fixed-price jobs"

---

## T2 Research: OpenClaw/Clawdbot Landscape

### Key Finding: ClawWork Paper
- GitHub: HKUDS/ClawWork — "OpenClaw as Your AI Coworker — $15K earned in 11 Hours"
- Someone gave their OpenClaw $1,000 to build its own business, it made $14,718

### Agent Market Tiers
- **Full-stack personal agents**: OpenClaw, Operator, Mariner
- **Browser-only agents**: MultiOn, Skyvern, Browser Use
- **Domain agents**: 11x (sales), Shopify Magic (commerce), Buffer AI (social)
- **Frameworks**: CrewAI, LangGraph, AutoGen, Claude Agent SDK

### The Trust Gap
"These tools CAN post on social media, send emails, list products, do outreach. But giving an AI your credentials + system access + permission to act requires trust that security auditors say isn't justified yet."

---

## Synthesis: What's Unique About Our Setup

Most people have ONE of these. We have ALL of them connected:

1. **OpenClaw on Telegram** — can reach anyone with a phone number
2. **Moltbook presence** — can participate in the AI social network (1.6M+ bots, Meta just acquired it)
3. **PostForMe** — can generate professional video content AND publish it to real IG/FB audiences
4. **StudyChat** — has an actual user base we can serve
5. **4 Claude Code terminals** — can build anything in parallel
6. **Chrome automation** — can drive any web interface
7. **Gmail access** — can read and act on email
8. **SearXNG** — unlimited free web search

The question: what can this SYSTEM do that individual pieces can't?

---

## Ideas Worth Exploring

### A. AI-as-a-Service via Telegram
MoltenClawd is already a Telegram bot. What if it offered paid services?
- "Send me your product photo, I'll make you a video ad" (PostForMe renders it)
- "Send me your business name, I'll research your competitors" (SearXNG + GPT-5.2)
- Payment via Stripe link in Telegram

### B. Moltbook Content Engine
MoltenClawd has Moltbook API access. Meta just acquired Moltbook. The platform has attention.
- Post valuable content on Moltbook to build agent reputation
- Use it as a distribution channel for anything we build
- The submolt ecosystem is early — can we become a notable agent?

### C. StudyChat Monetization
StudyChat has actual users. The skills are already built (chat-responder, new user monitoring).
- Premium features via the existing platform
- AI tutoring service (knowledge base + DMs)

### D. Automated Content Agency
Combine everything:
- OpenClaw receives client requests via Telegram
- PostForMe generates video content
- Chrome automation publishes it
- Analytics tracks performance
- Billing via Stripe
- 4 terminals handle custom work in parallel

### E. Build and Sell a Tool
Use the 4 terminals to build something fast, deploy it, use OpenClaw + Moltbook + PostForMe for distribution.
