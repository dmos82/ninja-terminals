# Implementation Plan: Ninja Terminals Product Tiers

## Overview
Build the tiered product (Starter $12 / Pro $29 / Add-ons $7) targeting vibe coders who don't know how to prompt effectively.

**Core insight**: Free tools give you 4 terminals. Ninja Terminals gives them a brain.

---

## Phase 1: License Key Gating (~2 hrs)

### 1.1 License key infrastructure
**File**: `lib/license.js` (NEW)
- Read license key from `~/.ninja-terminals/license` or `NINJA_LICENSE` env var
- Validate against Gumroad API: `POST https://api.gumroad.com/v2/licenses/verify`
- Cache validation result locally for 24hrs (don't hit API every startup)
- Return tier: `free | starter | pro`
- Graceful degradation: if API unreachable, use cached result

### 1.2 Gate features in cli.js
**File**: `cli.js` (MODIFY)
- Free: max 2 terminals, no orchestrator files loaded
- Starter: max 4 terminals, orchestrator prompt loaded
- Pro: unlimited terminals, full system (metrics, Builder Pro, LocalRag)
- On startup, print tier: `[STARTER] Ninja Terminals v2.0.0 — 4 terminals`
- If no license: print `[FREE] 2 terminals — upgrade at ninjaterminals.com`

### 1.3 Gate features in server.js
**File**: `server.js` (MODIFY)
- `DEFAULT_TERMINALS` capped by tier
- Self-improvement API endpoints return 403 for free/starter tier
- `/api/orchestrator/evolve` requires pro license

---

## Phase 2: Starter Tier Content ($12) (~3 hrs)

### 2.1 CLAUDE.md starter template
**File**: `tiers/starter/CLAUDE.md` (NEW)
- Battle-tested, beginner-friendly
- Comments explaining each rule (educational)
- Not over-specified (the #1 beginner mistake)
- Includes the worker communication protocol (STATUS/PROGRESS/NEED)
- Git safety rules built in

### 2.2 Git safety hooks
**File**: `tiers/starter/.claude/hooks/pre-edit-commit.sh` (NEW)
- Auto-commit before large changes (the #1 beginner mistake that causes lost work)
- Runs as PreToolUse hook for Edit/Write tools
- Creates checkpoint commits: `[checkpoint] before edit to {file}`

### 2.3 Prompt templates
**File**: `tiers/starter/prompts/` (NEW directory)
- `landing-page.md` — "Build me a landing page for..."
- `api-endpoint.md` — "Create an API that..."
- `database.md` — "Set up a database with..."
- `auth.md` — "Add authentication to..."
- `deploy.md` — "Deploy this to..."
- Each template teaches good prompting by example

### 2.4 Quick-start guide
**File**: `tiers/starter/QUICKSTART.md` (NEW)
- "Your First 30 Minutes with Claude Code + Ninja Terminals"
- Step-by-step with screenshots
- Common mistakes and how to avoid them
- Links to resources

### 2.5 Orchestrator prompt (starter version)
**File**: `tiers/starter/ORCHESTRATOR.md` (NEW)
- Simplified orchestrator that decomposes and dispatches
- No self-improvement, no metrics
- Clear, educational prompting style
- 4-terminal role-based split (Research, Build, Test, Verify)

---

## Phase 3: Pro Tier Content ($29) (~4 hrs)

### 3.1 Full orchestrator system
**Files**: `tiers/pro/` (NEW directory)
- `ORCHESTRATOR-PROMPT.md` — Full self-improving orchestrator
- `CLAUDE.md` — Advanced worker protocol with INSIGHT/PLAYBOOK markers
- `orchestrator/` — playbooks, tool-registry, evolution-log, metrics setup
- All self-improvement hooks pre-configured

### 3.2 Builder Pro integration with LocalRag
**File**: `tiers/pro/builder-pro/` (NEW directory)
- Pre-configured `.mcp.json` snippet for builder-pro-mcp
- LocalRag setup script: `setup-localrag.sh`
  - Checks for Ollama, installs if missing
  - Creates `~/.localrag/` namespace for the project
  - Configures MCP connection
- BMAD workflow skills pre-wired
- Post-build cleanup: auto-delete plans from LocalRag namespace

### 3.3 Auto-delete RAG plans after build
**File**: `tiers/pro/hooks/post-build-cleanup.sh` (NEW)
- Triggered after Builder Pro completes a build
- Deletes the uploaded plan from LocalRag namespace
- Keeps session metrics but removes the raw plan documents
- Prevents RAG accumulation / abuse

### 3.4 Security scan integration
**File**: `tiers/pro/hooks/pre-deploy-scan.sh` (NEW)
- Runs `mcp__builder-pro-mcp__security_scan` before deploy
- Blocks deploy if critical issues found
- Prints report with fixes

### 3.5 Domain CLAUDE.md configs (5 variants)
**Files**: `tiers/pro/templates/`
- `saas-app.md` — SaaS application (Next.js + API + DB)
- `mobile-app.md` — React Native / Expo
- `api-service.md` — Backend API (Express/FastAPI)
- `ecommerce.md` — E-commerce (Shopify/custom)
- `portfolio.md` — Portfolio / personal site

### 3.6 Ralph Loop configuration
**File**: `tiers/pro/ralph-loop-config.json` (NEW)
- Pre-configured settings for autonomous iteration
- Max iterations: 5
- Test commands per stack
- Failure escalation rules

---

## Phase 4: Add-on System (~2 hrs)

### 4.1 Add-on packaging format
Each add-on is a directory with:
```
addons/{name}/
├── README.md          # What this add-on does
├── CLAUDE.md          # Stack-specific worker rules (merged with base)
├── .mcp.json          # MCP server configs to add
├── templates/         # Prompt templates
├── hooks/             # Claude Code hooks
└── install.sh         # Auto-installer that merges configs
```

### 4.2 Add-on installer in CLI
**File**: `lib/addon-installer.js` (NEW)
- `npx ninja-terminals install nextjs` — installs the Next.js add-on
- Merges CLAUDE.md rules (appends, doesn't replace)
- Merges .mcp.json servers
- Copies hooks
- Validates no conflicts

### 4.3 Initial add-ons
1. **Next.js/React Pack** (`addons/nextjs/`)
   - Next.js-specific CLAUDE.md rules
   - Tailwind, shadcn/ui, Zustand configs
   - Common component prompt templates

2. **Python/FastAPI Pack** (`addons/python/`)
   - Python-specific CLAUDE.md rules
   - FastAPI, SQLAlchemy, Alembic configs
   - API design prompt templates

3. **"Fix My Vibe Code" Rescue Kit** (`addons/rescue/`)
   - Debugging skills
   - Dependency audit
   - Tech debt scanner
   - Migration helpers

---

## Phase 5: Landing Page & Store Update (~2 hrs)

### 5.1 Update landing page pricing
**File**: `site/index.html` (MODIFY)
- Three-tier pricing: Starter $12 / Pro $29 / Add-ons $7
- Bundle: Pro + 3 add-ons = $39
- Each tier card lists specific features
- Buy buttons link to Gumroad products

### 5.2 Create Gumroad products
- Ninja Terminals Starter — $12 USD
- Ninja Terminals Pro — $29 USD
- Add-on: Next.js Pack — $7 USD
- Add-on: Python Pack — $7 USD
- Add-on: Rescue Kit — $7 USD
- Bundle: Pro + All Add-ons — $39 USD

### 5.3 SkillStack listing
- List the orchestrator as a skill on SkillStack marketplace
- $29 price point matches their ecosystem

---

## Phase 6: Distribution & Packaging (~2 hrs)

### 6.1 npm package structure
```
ninja-terminals/           # npm package (FREE)
├── cli.js
├── server.js
├── lib/
├── public/
└── package.json

# Tier content is NOT in npm — delivered via Gumroad download
```

### 6.2 Gumroad deliverables
Each tier is a zip file containing the `tiers/{tier}/` directory:
- `ninja-terminals-starter.zip` — starter/ contents
- `ninja-terminals-pro.zip` — pro/ contents (includes starter)
- `ninja-terminals-addon-{name}.zip` — addon contents

### 6.3 Installation flow
```
1. User runs: npx ninja-terminals
2. App starts in FREE mode (2 terminals)
3. User buys Starter on Gumroad → gets license key + zip
4. User runs: npx ninja-terminals --license NT-XXXX
5. License saved to ~/.ninja-terminals/license
6. User extracts zip to their project
7. App restarts in STARTER mode (4 terminals + orchestrator)
```

---

## Execution Order (using Ninja Terminals)

### Day 1: Foundation
- T1: License key gating (Phase 1)
- T2: Starter CLAUDE.md + orchestrator prompt (Phase 2.1, 2.5)
- T3: Git safety hooks + prompt templates (Phase 2.2, 2.3)
- T4: Quick-start guide (Phase 2.4)

### Day 2: Pro Tier
- T1: Builder Pro + LocalRag integration (Phase 3.2)
- T2: Auto-delete RAG + security scan hooks (Phase 3.3, 3.4)
- T3: Domain CLAUDE.md configs (Phase 3.5)
- T4: Full orchestrator system packaging (Phase 3.1)

### Day 3: Add-ons + Launch
- T1: Add-on packaging system + installer (Phase 4.1, 4.2)
- T2: Next.js + Python add-ons (Phase 4.3)
- T3: Landing page + Gumroad products (Phase 5)
- T4: npm re-publish + distribution testing (Phase 6)

---

## Success Metrics
- [ ] `npx ninja-terminals` starts in FREE mode with 2 terminals
- [ ] License key unlocks STARTER (4 terminals + orchestrator)
- [ ] Pro license unlocks full system (metrics, Builder Pro, LocalRag)
- [ ] Add-on installer merges configs without breaking existing setup
- [ ] Landing page shows 3 tiers with working buy buttons
- [ ] End-to-end: purchase on Gumroad → download zip → install → Pro mode works
- [ ] Builder Pro with LocalRag completes a full BMAD build cycle
- [ ] RAG plans auto-delete after build completion
