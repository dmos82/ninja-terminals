# Session: 2026-03-30 — Self-Improvement Automation + Production Ready

## What Was Accomplished

### Self-Improvement Loop (now fully automated)
Built the missing automation layer that makes the system actually self-improving:

| Component | File | What it does |
|-----------|------|--------------|
| Pre-dispatch intelligence | `lib/pre-dispatch.js` | Reads tool ratings + playbooks, generates guidance strings |
| Post-session automation | `lib/post-session.js` | Auto-analyzes NDJSON, computes ratings, validates hypotheses |
| Hypothesis validator | `lib/hypothesis-validator.js` | Compares before/after metrics, decides promote/reject/continue |
| Dispatch injection | `server.js` | Injects guidance into terminal prompts (INJECT_GUIDANCE toggle) |

**The loop:**
```
Session runs → Tool calls captured via PostToolUse hooks
                    ↓
Session ends → POST /api/session/end
                    ↓
              Auto-analyze all NDJSON files
              Compare ratings (before vs after)
              Validate hypotheses (3+ sessions, >10% change)
              Update playbooks.md status
                    ↓
Next session → Guidance injected into dispatches
              "Avoid Edit (C rating), prefer Write"
              "Use staggered dispatch"
```

### Learnings UI
- 🧠 button in sidebar opens learnings modal
- Shows tool rating changes (e.g., "Edit: C→D, dropped 8%")
- Shows hypothesis updates (promoted/rejected/testing)
- Shows active guidance being injected
- "End Session & Analyze" button triggers full pipeline

### Terminal Management UI
- **+** button: Add new terminal (prompts for directory, remembers last used)
- **X** button: Close individual terminal
- **🗑** button: Clear all terminals
- Fresh start: New sessions start with 0 terminals (no auto-spawn)
- Fixed: X button now correctly calls `closeTerminal` (was broken)
- Fixed: Session returns existing terminals on refresh (no duplicates)

### Removed Dead Code
- Task Queue UI removed (was half-built, "+ Add Task" just spawned terminals)
- Cleaner sidebar without unused features

### Package Production-Ready (v2.1.4)
Fixed npm package to include all critical files:

**Included:**
- `CLAUDE.md` — Worker rules
- `ORCHESTRATOR-PROMPT.md` — Main orchestrator system prompt
- `orchestrator/playbooks.md` — Self-evolving workflows
- `orchestrator/identity.md` — Orchestrator identity
- `orchestrator/security-protocol.md` — Security rules
- `orchestrator/tool-registry.md` — Tool ratings
- `orchestrator/evolution-log.md` — Self-modification history
- `orchestrator/metrics/.gitkeep` — Empty folder structure
- `prompts/orchestrator-lite.md` — Compact prompt for Standard tier
- All `lib/` files
- All `public/` files

**Excluded:**
- Raw session data (users start fresh)
- Dev files (docs/, research/, site/)

**Package size:** 72KB (was 94KB with session data)

## Current State

### Versions
- npm: `ninja-terminals@2.1.4`
- Landing: ninjaterminals.com (Netlify)
- GitHub: dmos82/ninja-terminals

### Working Features
| Feature | Status |
|---------|--------|
| Auth (login/license key) | ✓ |
| Terminal spawning (+) | ✓ |
| Terminal closing (X) | ✓ |
| Clear all (🗑) | ✓ |
| Fresh start (0 terminals) | ✓ |
| Self-improvement loop | ✓ |
| Tool ratings (A/B/C/D) | ✓ |
| Guidance injection | ✓ |
| Learnings UI (🧠) | ✓ |
| Hypothesis validation | ✓ |
| Package includes all prompts | ✓ |

### Not Yet Done
| Item | Priority |
|------|----------|
| Rotate MongoDB password (leaked in git history) | **HIGH** |
| Stripe webhook (auto-upgrade tier on purchase) | Medium |
| Registration form in login overlay | Medium |
| Pattern detector (auto-generate hypotheses) | Future |

## Key Decisions

### Self-Improvement: Human-in-the-loop is OK
- System learns from data (tool ratings, timing, failures)
- System validates hypotheses automatically
- Humans still write new hypotheses to test
- This is "self-improving with human guidance" — defensible marketing claim

### Pattern Detector (future)
Designed but not built — would enable fully autonomous evolution:
- `lib/pattern-detector.js` analyzes session patterns
- Auto-generates hypotheses like "Glob-then-Write succeeds 95% vs 60%"
- Writes to playbooks.md with confidence scores
- System then validates these auto-generated hypotheses

### Package Structure
- Explicit file list in package.json (not folder wildcards)
- .npmignore for dev files
- Users get clean slate with empty metrics folder

## Git Commits This Session
- `aaf76d4` — Add true self-improvement automation
- `ff61503` — Add user-facing learnings summary with UI
- `4d69581` — Add terminal management UI: +/X buttons, clear all
- `48e8a51` — v2.1.1
- `0340328` — Fix terminal management: X button works, no auto-spawn
- `596aa16` — v2.1.2
- `909fe5f` — Remove Task Queue UI (unused feature)
- `338d1a7` — v2.1.3
- `8a556c6` — Fix npm package: include orchestrator prompts, exclude session data

## Architecture (current)

```
User runs: npx ninja-terminals
              ↓
         cli.js starts server.js on port 3300
              ↓
         Browser opens localhost:3300
              ↓
         Login with EMTChat credentials or license key
              ↓
         POST /api/session validates token, returns tier
              ↓
         User clicks + to add terminals
              ↓
         Each terminal runs: claude --dangerously-skip-permissions
              ↓
         PostToolUse hooks capture tool calls → NDJSON
              ↓
         User clicks 🧠 or session ends
              ↓
         POST /api/session/end runs full analysis pipeline
              ↓
         Next session gets guidance injected

Data flow:
  PostToolUse hooks → orchestrator/metrics/raw/*.ndjson
  analyze-session.js → orchestrator/metrics/summaries.ndjson
  tool-rater.js → orchestrator/metrics/tool-ratings.json
  hypothesis-validator.js → updates orchestrator/playbooks.md
  pre-dispatch.js → reads ratings, generates guidance
  server.js input endpoint → injects guidance into prompts
```

## Test Commands

```bash
# Start server
cd ~/Desktop/Projects/ninja-terminal && PORT=3300 node server.js

# Login and get token
TOKEN=$(curl -s http://localhost:3300/api/auth/login -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"david_ninja","password":"NinjaTest123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Create session
curl -s -X POST "http://localhost:3300/api/session" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# Get learnings
curl -s "http://localhost:3300/api/learnings/latest" \
  -H "Authorization: Bearer $TOKEN"

# End session (trigger analysis)
curl -s -X POST "http://localhost:3300/api/session/end" \
  -H "Authorization: Bearer $TOKEN"
```
