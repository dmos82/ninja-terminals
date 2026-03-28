#!/usr/bin/env bash
# PostToolUse hook: append tool event to session NDJSON file
# Async — does not block Claude Code operations
# Receives JSON on stdin with: session_id, tool_name, tool_input, tool_response

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
METRICS_DIR="${PROJECT_DIR}/orchestrator/metrics/raw"
DATE_TAG="$(date +%Y-%m-%d)"

mkdir -p "$METRICS_DIR"

# Read hook input from stdin
INPUT=$(cat)

# Extract fields using Node.js (guaranteed available since this is a Node project)
TOOL=$(echo "$INPUT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.tool_name||'unknown')}catch{console.log('unknown')}})" 2>/dev/null || echo "unknown")
SESSION=$(echo "$INPUT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.session_id||'unknown')}catch{console.log('unknown')}})" 2>/dev/null || echo "unknown")

# Determine success from tool_response
SUCCESS="true"
if echo "$INPUT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const r=JSON.stringify(j.tool_response||{});process.exit(r.match(/error|failed|ENOENT/i)?1:0)}catch{process.exit(0)}})" 2>/dev/null; then
  SUCCESS="true"
else
  SUCCESS="false"
fi

OUT_FILE="${METRICS_DIR}/session-${DATE_TAG}-${SESSION}.ndjson"

printf '{"ts":"%s","tool":"%s","success":%s,"session":"%s","terminal":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$TOOL" \
  "$SUCCESS" \
  "$SESSION" \
  "${NINJA_TERMINAL_ID:-unknown}" \
  >> "$OUT_FILE"
