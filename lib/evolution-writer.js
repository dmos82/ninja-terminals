'use strict';

const path = require('path');
const { safeAppend } = require('./safe-file-writer');

const EVOLUTION_LOG = path.join(__dirname, '..', 'orchestrator', 'evolution-log.md');

/**
 * Append a formatted entry to evolution-log.md.
 * @param {{ file: string, change: string, why: string, evidence: string, reversible?: string }} entry
 */
function logEvolution(entry) {
  const date = new Date().toISOString().split('T')[0];
  const block = [
    '',
    `### ${date} — ${entry.change.substring(0, 80)}`,
    `**File:** ${entry.file}`,
    `**Change:** ${entry.change}`,
    `**Why:** ${entry.why}`,
    `**Evidence:** ${entry.evidence}`,
    `**Reversible:** ${entry.reversible || 'yes'}`,
  ].join('\n');

  safeAppend(EVOLUTION_LOG, block);
}

module.exports = { logEvolution };
