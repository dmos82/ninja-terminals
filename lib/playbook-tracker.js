'use strict';

const fs = require('fs');
const { SUMMARIES_PATH } = require('./analyze-session');

/**
 * Parse playbooks.md into structured entries.
 * Looks for ### headings and **Status:** lines.
 * @param {string} playbooksPath
 * @returns {Array<{ name: string, status: string, section: string }>}
 */
function parsePlaybooks(playbooksPath) {
  if (!fs.existsSync(playbooksPath)) return [];

  const content = fs.readFileSync(playbooksPath, 'utf8');
  const entries = [];
  const sections = content.split(/^### /m).slice(1); // split on ### headings

  for (const section of sections) {
    const lines = section.split('\n');
    const name = lines[0].trim();
    const statusMatch = section.match(/\*\*Status:\*\*\s*(.+)/i);
    const status = statusMatch
      ? statusMatch[1].trim().toLowerCase().replace(/[^a-z_-]/g, '')
      : 'unknown';

    entries.push({ name, status, section: '### ' + section.trim() });
  }

  return entries;
}

/**
 * Count how many sessions used each playbook (from PLAYBOOK: markers).
 * @param {string} summariesPath
 * @returns {Map<string, number>} playbook name -> session count
 */
function getPlaybookUsage(summariesPath) {
  const usage = new Map();
  const filePath = summariesPath || SUMMARIES_PATH;

  if (!fs.existsSync(filePath)) return usage;

  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const s = JSON.parse(line);
      if (s.playbook_used) {
        usage.set(s.playbook_used, (usage.get(s.playbook_used) || 0) + 1);
      }
    } catch { /* skip */ }
  }

  return usage;
}

/**
 * Generate promotion recommendations for playbooks based on usage data.
 * Promotes hypothesis/testing -> validated after 3+ successful sessions.
 * @param {string} playbooksPath
 * @param {string} summariesPath
 * @returns {Array<{ name: string, current_status: string, recommended: string, sessions: number, evidence: string }>}
 */
function promotePlaybooks(playbooksPath, summariesPath) {
  const entries = parsePlaybooks(playbooksPath);
  const usage = getPlaybookUsage(summariesPath);
  const promotions = [];

  for (const entry of entries) {
    const sessions = usage.get(entry.name) || 0;
    if ((entry.status === 'hypothesis' || entry.status.startsWith('testing')) && sessions >= 3) {
      promotions.push({
        name: entry.name,
        current_status: entry.status,
        recommended: 'validated',
        sessions,
        evidence: `Used in ${sessions} sessions`,
      });
    }
  }

  return promotions;
}

module.exports = { parsePlaybooks, getPlaybookUsage, promotePlaybooks };
