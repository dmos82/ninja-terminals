# Chapter 6: Real-World Playbooks

> 6 complete orchestration workflows you can run today. Each includes the architecture, agent assignments, prompts, and expected timeline.

---

## Playbook 1: Build and Launch a Digital Product (90 Minutes)

**Goal**: Create a digital product, set up a sales page, create marketing content, and publish — all in parallel.

### Architecture: Pipeline + Hub-and-Spoke

```
Phase 1 (Parallel):    T1: Build Product    |    T3: Draft Marketing Content
Phase 2 (After T1):    T2: Set Up Sales Listing (needs product files)
Phase 3 (After T2):    T3: Finalize Content (needs product URL)    |    T4: Publish & Distribute
```

### Agent Assignments

**T1 — Product Builder**
```markdown
Scope: /products/[product-name]/
Task: Create [PRODUCT TYPE — e.g., "a markdown template bundle for prompt engineering"]
Requirements:
- [N] files, professionally formatted
- Table of contents / index file
- Clear value proposition in every section
- Ready to package as a zip/download
Tools: Filesystem, code editor
Definition of done: All files created, reviewed for quality, packaged
```

**T2 — Sales Listing Agent**
```markdown
Scope: Gumroad / sales platform
Task: Create product listing
Requirements:
- Compelling title (under 60 chars)
- Description with bullet points highlighting value
- Price: $[X]
- Upload product files from T1's output
- Cover image (create or source)
Tools: Browser automation, filesystem
Depends on: T1 STATUS: DONE
Definition of done: Product live on platform, URL captured
```

**T3 — Content Creator**
```markdown
Scope: /marketing/
Task: Create launch content
Phase 1 (start immediately):
- 3 social media posts (Twitter, LinkedIn, Instagram caption)
- Email announcement draft
- Blog post / landing page copy
Phase 2 (after T2 provides URL):
- Insert product URL into all content
- Finalize CTAs
Tools: Filesystem
Definition of done: All content files created with product URL embedded
```

**T4 — Distribution Agent**
```markdown
Scope: Social media platforms, email
Task: Publish all launch content
Requirements:
- Post to [PLATFORMS]
- Send email announcement to [LIST]
- Share in [COMMUNITIES]
Tools: Social media MCP, email MCP, browser automation
Depends on: T3 STATUS: DONE (Phase 2)
Definition of done: All posts live, links verified working
```

### Timeline
| Time | Action |
|------|--------|
| 0:00 | Dispatch T1 + T3 (Phase 1) |
| 0:30 | T1 done → Dispatch T2 |
| 0:40 | T3 Phase 1 done → Hold for T2 |
| 0:50 | T2 done → Give T3 the product URL → T3 Phase 2 |
| 0:55 | T3 Phase 2 done → Dispatch T4 |
| 1:10 | T4 done → All published |
| 1:15 | Orchestrator verifies all links work |

---

## Playbook 2: Full-Stack Feature Build (2-3 Hours)

**Goal**: Build a complete feature with backend API, frontend UI, tests, and documentation.

### Architecture: Hub-and-Spoke

```
              +------------------+
              |   ORCHESTRATOR   |
              +--------+---------+
                       |
        +--------------+--------------+
        |              |              |
   +----+----+   +-----+----+   +----+-----+
   |   T1    |   |   T2     |   |   T3     |
   | Backend |   | Frontend |   | Tests &  |
   |  API    |   |   UI     |   | QA       |
   +---------+   +----------+   +----------+
```

### Agent Assignments

**T1 — Backend**
```markdown
Scope: /src/api/, /src/models/, /src/middleware/
Task: Build REST API for [FEATURE]
Requirements:
- [N] endpoints (list them with method + path + payload)
- Database schema/migration
- Input validation
- Error handling
- Publish CONTRACT with endpoint specs for T2
Tools: Filesystem, database, code editor
Build command: npm run build && npm test
```

**T2 — Frontend**
```markdown
Scope: /src/components/, /src/pages/, /src/hooks/
Task: Build UI for [FEATURE]
Requirements:
- [N] components (list them)
- Integration with T1's API (use CONTRACT when available)
- Loading states, error states, empty states
- Responsive layout
Tools: Filesystem, code editor
Build command: npm run build
Depends on: T1's CONTRACT (but can start with mock data)
```

**T3 — Tests & QA**
```markdown
Scope: /tests/, /e2e/
Task: Write comprehensive tests for [FEATURE]
Requirements:
- Unit tests for API endpoints (use T1's CONTRACT)
- Component tests for UI (use T2's file list)
- E2E test for the happy path
- Edge case coverage: [list specific edge cases]
Tools: Filesystem, test runner, code editor
Build command: npm test
Depends on: T1 and T2 both STATUS: DONE
```

### Orchestrator Coordination Sequence

```
1. Dispatch T1 and T2 simultaneously
2. When T1 publishes CONTRACT: Copy it to T2
3. When T1 reports DONE: Note it, wait for T2
4. When T2 reports DONE: Dispatch T3
5. When T3 reports DONE: Run full integration test
6. If all pass: STATUS: DONE
7. If T3 finds bugs: Route NEED requests to T1 or T2
```

---

## Playbook 3: Research Deep Dive (45 Minutes)

**Goal**: Comprehensive research on a topic from multiple angles, synthesized into one report.

### Architecture: Hub-and-Spoke with Synthesis

```
              +------------------+
              |  ORCHESTRATOR    |
              | (Synthesizer)    |
              +--------+---------+
                       |
     +-----------------+------------------+
     |                 |                  |
+----+----+      +-----+----+      +-----+-----+
|   T1    |      |   T2     |      |   T3      |
| Official|      | Community|      | Market &  |
| Sources |      | & Forums |      | Pricing   |
+---------+      +----------+      +-----------+
```

### Agent Assignments

**T1 — Official Sources**
```markdown
Task: Research [TOPIC] from authoritative sources
Search: Official documentation, academic papers, company announcements,
        press releases, government reports
Output: /research/official-sources.md
Format: Findings with full citations (URL + date accessed)
Rule: Only cite primary sources, not blog summaries of primary sources
```

**T2 — Community & Practitioner Sources**
```markdown
Task: Research [TOPIC] from community perspective
Search: Reddit, Hacker News, Stack Overflow, Discord servers,
        Twitter/X threads, YouTube tutorials, blog posts by practitioners
Output: /research/community-sources.md
Format: Sentiment analysis + specific claims with citations
Focus: What do real users say? Common complaints? Unexpected use cases?
```

**T3 — Market & Business Analysis**
```markdown
Task: Research [TOPIC] business viability
Search: Pricing models, competitor landscape, market size,
        growth trends, funding rounds, job postings
Output: /research/market-analysis.md
Format: Structured analysis with data tables
Focus: Who's making money? What's the TAM? Where are the gaps?
```

**Orchestrator Synthesis** (after all three report DONE):
```markdown
Read all three output files. Synthesize into:
/research/final-report.md

Structure:
1. Executive Summary (3 bullet points)
2. Key Findings (merged and deduplicated)
3. Contradictions (where sources disagree — these are the insights)
4. Market Opportunity Assessment
5. Risks and Concerns
6. Recommendations
7. Full Source List

Flag anything where T1 (official) contradicts T2 (community).
That gap usually reveals where the real story is.
```

---

## Playbook 4: Content Sprint (60 Minutes)

**Goal**: Produce a week's worth of social media content from a single source.

### Architecture: Pipeline

```
Stage 1: Research/Input → Stage 2: Content Generation → Stage 3: Review → Stage 4: Schedule
```

### Stages

**Stage 1 — Input Gathering (T1)**
```markdown
Task: Gather source material for content creation
Sources:
- Recent blog posts at [URL]
- Product updates from [CHANGELOG]
- Industry news related to [TOPIC]
- Customer testimonials from [SOURCE]
Output: /content/source-material.md
Format: Bullet points organized by theme, with source links
```

**Stage 2 — Content Generation (T1, reused)**
```markdown
Input: /content/source-material.md
Task: Generate 7 days of social media content
Output per day:
- 1 Twitter/X post (under 280 chars, hook + insight + CTA)
- 1 LinkedIn post (3-5 paragraphs, professional tone, with a takeaway)
- 1 Instagram caption (conversational, with hashtags)
Output: /content/week-[DATE]/day-[1-7].md
Format: Markdown with headers for each platform
```

**Stage 3 — Review (T2)**
```markdown
Input: /content/week-[DATE]/
Task: Review all content for quality
Checklist:
- No factual errors or unsupported claims
- Consistent brand voice
- CTAs are clear and actionable
- No duplicate ideas across days
- Platform-appropriate formatting (Twitter length, LinkedIn formatting, etc.)
Output: /content/review-notes.md (list of changes needed per file)
If changes needed: NEED: T1 to revise [specific files]
```

**Stage 4 — Schedule/Publish (T3)**
```markdown
Input: Reviewed content from /content/week-[DATE]/
Task: Schedule all posts using [PLATFORM — e.g., PostForMe, Buffer, Hootsuite]
Schedule:
- Twitter: 9 AM EST daily
- LinkedIn: 11 AM EST daily
- Instagram: 2 PM EST daily
Output: Screenshot of scheduled queue + confirmation of dates/times
```

---

## Playbook 5: Bug Triage Swarm (30 Minutes)

**Goal**: Rapidly triage, categorize, and fix a batch of bug reports.

### Architecture: Swarm

```
Shared task board: /bugs/triage-board.json
All agents self-assign from the board
```

### Setup

```json
{
  "bugs": [
    {"id": "BUG-001", "title": "Login fails on Safari", "status": "open", "assigned": null},
    {"id": "BUG-002", "title": "Price shows NaN", "status": "open", "assigned": null},
    {"id": "BUG-003", "title": "Dark mode toggle broken", "status": "open", "assigned": null},
    {"id": "BUG-004", "title": "Email notifications delayed", "status": "open", "assigned": null},
    {"id": "BUG-005", "title": "CSV export missing columns", "status": "open", "assigned": null}
  ]
}
```

### Agent Prompt (Same for All Agents)

```markdown
You are a bug triage agent. Self-assign bugs from /bugs/triage-board.json.

For each bug:
1. Update the board: set status to "in-progress" and assigned to your ID
2. Reproduce the bug (read code, trace the logic)
3. Categorize: Critical / High / Medium / Low
4. Root cause analysis (2-3 sentences)
5. Fix if possible (under 15 minutes), otherwise document the fix approach
6. Update the board: set status to "fixed" or "documented"
7. Pick the next available bug

Output per bug:
## BUG-[ID]: [title]
- Severity: [Critical/High/Medium/Low]
- Root cause: [description]
- Fix: [what was changed] or [recommended approach]
- Evidence: [test result or reproduction steps]

When no bugs remain: STATUS: DONE — Triaged [N] bugs, fixed [M], documented [K]
```

---

## Playbook 6: Competitive Analysis (60 Minutes)

**Goal**: Deep competitive analysis of your product vs. 3-5 competitors.

### Architecture: Hub-and-Spoke (1 Agent Per Competitor)

### Agent Assignment Template

```markdown
You are T[N] — analyzing [COMPETITOR NAME].

Research the following about [COMPETITOR]:

## Product
- Core features (list top 10)
- Unique differentiators (what do they do that nobody else does?)
- Known weaknesses (from user reviews, not your opinion)

## Pricing
- Plans and prices (screenshot the pricing page)
- Free tier? Trial period?
- Price per user? Per usage? Flat fee?

## Market Position
- Target customer (who are they selling to?)
- Estimated user base (from any available data)
- Recent funding or acquisitions
- Key partnerships

## Technology
- Tech stack (from job postings, blog posts, or documentation)
- API availability
- Integration ecosystem

## User Sentiment
- G2/Capterra rating
- Common praise (top 3 themes from reviews)
- Common complaints (top 3 themes from reviews)
- Reddit/HN sentiment

Output: /research/competitors/[competitor-name].md
Format: Structured markdown with data tables where possible
Evidence: Every claim needs a source URL
```

### Orchestrator Synthesis

```markdown
After all agents report DONE, create:
/research/competitive-matrix.md

Include:
1. Feature comparison matrix (our product vs. all competitors)
2. Pricing comparison table
3. Positioning map (2x2 matrix: [axis 1] vs [axis 2])
4. Our advantages (where we clearly win)
5. Our gaps (where competitors are ahead)
6. Opportunities (features no competitor offers yet)
7. Threats (competitors with momentum in our direction)
```

---

## Quick Reference: Playbook Selection

| I want to... | Use Playbook |
|--------------|-------------|
| Ship a product from scratch | #1 (Digital Product Launch) |
| Build a software feature | #2 (Full-Stack Feature) |
| Understand a topic deeply | #3 (Research Deep Dive) |
| Create content at scale | #4 (Content Sprint) |
| Fix a pile of bugs fast | #5 (Bug Triage Swarm) |
| Know my competitive landscape | #6 (Competitive Analysis) |

---

## Final Notes

These playbooks are starting points. Every project will require adaptation. The key principles that stay constant:

1. **Scope isolation** — Every agent owns specific files/domains
2. **Structured communication** — STATUS, PROGRESS, NEED, CONTRACT
3. **Evidence over assertion** — Prove it works, don't just say it works
4. **Parallel by default** — If tasks are independent, run them simultaneously
5. **Fail gracefully** — Plan for failures, build recovery into the system

You now have the architecture, protocols, prompts, tools, failure recovery, and playbooks. The only thing left is to run it.

---

*End of AI Agent Orchestration Blueprint. Build something amazing.*
