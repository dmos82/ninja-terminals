'use strict';

// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------

/**
 * Strip all ANSI escape sequences and carriage returns from a string.
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str) {
  return str
    .replace(/\x1b\][^\x07]*\x07/g, '')          // OSC sequences
    .replace(/\x1b\[[?>=!]?[0-9;]*[a-zA-Z]/g, '') // CSI sequences
    .replace(/\x1b[()][0-9A-Z]/g, '')             // character set selection
    .replace(/\x1b[>=<]/g, '')                     // keypad mode
    .replace(/\x1b\[>[0-9;]*[a-zA-Z]/g, '')       // private CSI
    .replace(/\r/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Status detection
// ---------------------------------------------------------------------------

/** Regex that matches status-bar noise lines that should be excluded. */
const STATUS_BAR_NOISE = /^(●|·|\/effort|\/mcp|high|low|medium|Failed to install|MCP server|Will retry|─+$|\?forshortcuts|forshortcuts)/i;

/** Regex that matches tool invocation patterns. */
const TOOL_RE = /Bash\(|Read\(|Edit\(|Write\(|Grep\(|Glob\(|Agent\(/i;

/** Spinner / thinking indicators. */
const SPINNER_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Thinking|Generating/i;

/**
 * Detect the current operational status of a Claude Code terminal.
 *
 * @param {string[]} lines - Array of ANSI-stripped lines (from LineBuffer)
 * @returns {'idle'|'working'|'waiting_approval'|'compacting'|'done'|'blocked'|'error'}
 */
function detectStatus(lines) {
  if (!lines || lines.length === 0) return 'idle';

  // Work with trimmed, non-empty lines
  const trimmed = lines.map(l => l.trim()).filter(Boolean);
  if (trimmed.length === 0) return 'idle';

  const last50 = trimmed.slice(-50).join('\n');
  const contentLines = trimmed.filter(l => !STATUS_BAR_NOISE.test(l));
  const lastContentLine = contentLines.slice(-1)[0] || '';
  const last10 = trimmed.slice(-10);

  // Prompt detection — idle if prompt is visible and no recent tool work
  const hasPrompt = last10.some(l => /^[>❯]$/.test(l));
  const hasShortcutsHint = last10.some(
    l => /\?.*for\s*shortcuts/i.test(l) || l === '?forshortcuts'
  );

  if (hasPrompt || hasShortcutsHint) {
    const recentWork = last10.some(l => TOOL_RE.test(l));
    if (!recentWork) return 'idle';
  }

  // Approval prompts
  if (/Select any you wish to enable|Space to select|Enter to confirm/i.test(last50)) {
    return 'waiting_approval';
  }
  if (/accept edits|allow bash|Yes\/No|\(y\/n\)/i.test(last50)) {
    return 'waiting_approval';
  }

  // Auto-compaction
  if (/auto-compact|compressing|compacting/i.test(last50)) return 'compacting';

  // Explicit status markers (convention for orchestrator scripts)
  if (/STATUS: DONE/i.test(last50)) return 'done';
  if (/STATUS: BLOCKED/i.test(last50)) return 'blocked';

  // Active tool use
  if (TOOL_RE.test(last50)) return 'working';

  // Spinner / thinking
  if (SPINNER_RE.test(lastContentLine)) return 'working';

  // Error detection in very recent output
  const last3 = contentLines.slice(-3).join('\n');
  if (/panic:|Traceback \(most recent/i.test(last3)) return 'error';

  // Default to working (Claude is likely generating)
  return 'working';
}

// ---------------------------------------------------------------------------
// Context window percentage extraction
// ---------------------------------------------------------------------------

/**
 * Extract context-window usage percentage from terminal output.
 * Looks for patterns like "Context: 42%" or "context window: 72%".
 *
 * @param {string[]} lines - Array of ANSI-stripped lines
 * @returns {number|null} Percentage (0-100) or null if not found
 */
function extractContextPct(lines) {
  if (!lines || lines.length === 0) return null;

  // Scan from the end — most recent value wins
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/context(?:\s*window)?[:\s]+(\d{1,3})%/i);
    if (match) {
      const pct = parseInt(match[1], 10);
      if (pct >= 0 && pct <= 100) return pct;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Structured event extraction
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} StructuredEvent
 * @property {string} ts        - ISO 8601 timestamp
 * @property {string} type      - Event type: status | progress | tool | build | error | need | contract | context
 * @property {string} terminal  - Terminal label (e.g. "T1")
 * @property {string} msg       - Raw message content
 * @property {Object} [meta]    - Type-specific metadata
 */

/**
 * Line prefix patterns for structured events.
 * Convention: lines prefixed with `STATUS:`, `PROGRESS:`, `NEED:`, etc.
 * are treated as structured events emitted by orchestrated Claude sessions.
 */
const EVENT_PATTERNS = [
  { re: /^STATUS:\s*(.+)/i,    type: 'status' },
  { re: /^PROGRESS:\s*(.+)/i,  type: 'progress' },
  { re: /^NEED:\s*(.+)/i,      type: 'need' },
  { re: /^CONTRACT:\s*(.+)/i,  type: 'contract' },
  { re: /^BUILD:\s*(.+)/i,     type: 'build' },
];

/** Tool invocation pattern for extracting tool events. */
const TOOL_INVOKE_RE = /^(Bash|Read|Edit|Write|Grep|Glob|Agent)\((.+)\)/;

/** Error pattern. */
const ERROR_RE = /^(Error|panic:|Traceback \(most recent|FATAL|ENOENT|EACCES)/i;

/** Context window pattern. */
const CONTEXT_RE = /context(?:\s*window)?[:\s]+(\d{1,3})%/i;

/**
 * Parse an array of stripped lines into structured JSONL-compatible event objects.
 *
 * @param {string[]} lines          - ANSI-stripped lines to parse
 * @param {string}   terminalLabel  - Label for the terminal (e.g. "T1")
 * @returns {StructuredEvent[]}
 */
function extractStructuredEvents(lines, terminalLabel) {
  if (!lines || lines.length === 0) return [];

  const events = [];
  const ts = new Date().toISOString();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check structured prefixes first
    let matched = false;
    for (const { re, type } of EVENT_PATTERNS) {
      const m = trimmed.match(re);
      if (m) {
        events.push({ ts, type, terminal: terminalLabel, msg: m[1].trim() });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Tool invocations
    const toolMatch = trimmed.match(TOOL_INVOKE_RE);
    if (toolMatch) {
      events.push({
        ts,
        type: 'tool',
        terminal: terminalLabel,
        msg: trimmed,
        meta: { tool: toolMatch[1], args: toolMatch[2] },
      });
      continue;
    }

    // Errors
    if (ERROR_RE.test(trimmed)) {
      events.push({ ts, type: 'error', terminal: terminalLabel, msg: trimmed });
      continue;
    }

    // Context window updates
    const ctxMatch = trimmed.match(CONTEXT_RE);
    if (ctxMatch) {
      const pct = parseInt(ctxMatch[1], 10);
      if (pct >= 0 && pct <= 100) {
        events.push({
          ts,
          type: 'context',
          terminal: terminalLabel,
          msg: trimmed,
          meta: { pct },
        });
      }
    }
  }

  return events;
}

module.exports = {
  stripAnsi,
  detectStatus,
  extractContextPct,
  extractStructuredEvents,
};
