#!/usr/bin/env bash
# Stop hook: trigger session analysis when Claude Code session ends
# Async — does not block the exit

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RAW_DIR="${PROJECT_DIR}/orchestrator/metrics/raw"

# Find the most recent NDJSON file for today
DATE_TAG="$(date +%Y-%m-%d)"
LATEST=$(ls -t "${RAW_DIR}"/session-${DATE_TAG}-*.ndjson 2>/dev/null | head -1)

if [ -n "$LATEST" ] && [ -s "$LATEST" ]; then
  node "${PROJECT_DIR}/lib/analyze-session.js" "$LATEST" &
fi
