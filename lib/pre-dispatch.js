'use strict';

const fs = require('fs');
const path = require('path');
const { SUMMARIES_PATH } = require('./analyze-session');
const { rateTools } = require('./tool-rater');
const { parsePlaybooks } = require('./playbook-tracker');

const TOOL_RATINGS_PATH = path.join(__dirname, '..', 'orchestrator', 'metrics', 'tool-ratings.json');
const PLAYBOOKS_PATH = path.join(__dirname, '..', 'orchestrator', 'playbooks.md');

// Known tool alternatives for guidance generation
const TOOL_ALTERNATIVES = {
  Edit: { preferred: 'Write', useCase: 'new files or full rewrites' },
  Bash: { preferred: 'Glob', useCase: 'directory scanning' },
  find: { preferred: 'Glob', useCase: 'file searches' },
  grep: { preferred: 'Grep', useCase: 'content searches' },
  cat: { preferred: 'Read', useCase: 'reading files' },
};

/**
 * Load tool ratings from JSON file or compute fresh from summaries.
 * @returns {Promise<Map<string, object>>}
 */
async function loadToolRatings() {
  // Try cached JSON first
  if (fs.existsSync(TOOL_RATINGS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(TOOL_RATINGS_PATH, 'utf8'));
      const map = new Map();
      for (const [tool, stats] of Object.entries(data)) {
        map.set(tool, stats);
      }
      return map;
    } catch { /* fall through to compute */ }
  }

  // Compute fresh
  return rateTools();
}

/**
 * Generate tool guidance strings from ratings.
 * @param {Map<string, object>} ratings
 * @returns {string[]}
 */
function generateToolGuidance(ratings) {
  const guidance = [];

  for (const [tool, stats] of ratings) {
    const { rating, composite, success_rate } = stats;

    if (rating === 'C' || composite < 0.50) {
      // Low-rated tool: suggest avoidance
      const alt = TOOL_ALTERNATIVES[tool];
      if (alt) {
        guidance.push(`Avoid ${tool} for ${alt.useCase}, prefer ${alt.preferred} (${tool} has ${rating} rating: ${composite})`);
      } else {
        guidance.push(`Use ${tool} cautiously — ${rating} rating (${composite}), success rate: ${(success_rate * 100).toFixed(0)}%`);
      }
    } else if (rating === 'S' || rating === 'A') {
      // High-rated tool: recommend preference
      guidance.push(`Prefer ${tool} — reliable (${rating} rating: ${composite})`);
    }
  }

  return guidance;
}

/**
 * Extract actionable insights from validated playbooks.
 * @returns {string[]}
 */
function extractPlaybookInsights() {
  const insights = [];

  if (!fs.existsSync(PLAYBOOKS_PATH)) return insights;

  const content = fs.readFileSync(PLAYBOOKS_PATH, 'utf8');

  // Extract from "## Measured Insights" section
  const measuredMatch = content.match(/## Measured Insights[^\n]*\n([\s\S]*?)(?=\n## |\n---|\*\*Status:\*\*|$)/);
  if (measuredMatch) {
    const bulletMatches = measuredMatch[1].match(/^- \*\*(.+?)\*\*\s*[—–-]\s*(.+)$/gm);
    if (bulletMatches) {
      for (const bullet of bulletMatches) {
        const cleaned = bullet
          .replace(/^- \*\*/, '')
          .replace(/\*\*\s*[—–-]\s*/, ' — ')
          .trim();
        insights.push(cleaned);
      }
    }
  }

  // Extract from "## Known Anti-Patterns" section
  const antiMatch = content.match(/## Known Anti-Patterns[^\n]*\n([\s\S]*?)(?=\n## |$)/);
  if (antiMatch) {
    const bulletMatches = antiMatch[1].match(/^- \*\*(.+?)\*\*\s*[—–-]\s*(.+)$/gm);
    if (bulletMatches) {
      for (const bullet of bulletMatches) {
        const cleaned = bullet
          .replace(/^- \*\*/, '')
          .replace(/\*\*\s*[—–-]\s*/, ' — ')
          .trim();
        insights.push(cleaned);
      }
    }
  }

  // Also extract dispatch best practices (simpler format)
  const dispatchMatch = content.match(/## Dispatch Best Practices\n([\s\S]*?)(?=\n## |$)/);
  if (dispatchMatch) {
    const simpleMatches = dispatchMatch[1].match(/^- \*\*(.+?)\*\*(.*)$/gm);
    if (simpleMatches) {
      for (const bullet of simpleMatches.slice(0, 3)) { // Just top 3
        const cleaned = bullet.replace(/^- /, '').trim();
        insights.push(cleaned);
      }
    }
  }

  return insights;
}

/**
 * Analyze recent summaries for terminal performance patterns.
 * @returns {object} terminalId -> { avgDuration, successRate, recentTools }
 */
function analyzeTerminalPerformance() {
  const hints = {};

  if (!fs.existsSync(SUMMARIES_PATH)) return hints;

  const lines = fs.readFileSync(SUMMARIES_PATH, 'utf8').trim().split('\n').filter(Boolean);

  // Only look at recent sessions (last 20)
  const recentLines = lines.slice(-20);
  const sessions = recentLines
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  // Aggregate by terminal
  const byTerminal = {};
  for (const s of sessions) {
    const t = s.terminal || 'unknown';
    if (t === 'unknown') continue;

    if (!byTerminal[t]) {
      byTerminal[t] = { durations: [], totalSuccess: 0, totalInvocations: 0, tools: {} };
    }
    const agg = byTerminal[t];
    agg.durations.push(s.duration_min || 0);

    // Aggregate tool stats
    if (s.tools) {
      for (const [tool, stats] of Object.entries(s.tools)) {
        agg.totalSuccess += stats.successes || 0;
        agg.totalInvocations += stats.invocations || 0;
        agg.tools[tool] = (agg.tools[tool] || 0) + (stats.invocations || 0);
      }
    }
  }

  // Compute hints per terminal
  for (const [t, agg] of Object.entries(byTerminal)) {
    const avgDuration = agg.durations.length > 0
      ? agg.durations.reduce((a, b) => a + b, 0) / agg.durations.length
      : 0;
    const successRate = agg.totalInvocations > 0
      ? agg.totalSuccess / agg.totalInvocations
      : 0;

    // Top 3 tools by usage
    const topTools = Object.entries(agg.tools)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tool]) => tool);

    hints[t] = {
      avgDuration: +avgDuration.toFixed(1),
      successRate: +successRate.toFixed(3),
      topTools,
    };
  }

  // Add comparative hints
  const terminals = Object.keys(hints);
  if (terminals.length >= 2) {
    // Find fastest and slowest
    const sorted = terminals.sort((a, b) => hints[a].avgDuration - hints[b].avgDuration);
    const fastest = sorted[0];
    const slowest = sorted[sorted.length - 1];

    if (hints[fastest].avgDuration > 0 && hints[slowest].avgDuration > hints[fastest].avgDuration * 1.3) {
      hints._comparison = `T${fastest} was ${((hints[slowest].avgDuration / hints[fastest].avgDuration - 1) * 100).toFixed(0)}% faster than T${slowest} in recent sessions`;
    }
  }

  return hints;
}

/**
 * Get pre-dispatch context for injection into terminal prompts.
 * @returns {Promise<{ toolGuidance: string[], playbookInsights: string[], terminalHints: object }>}
 */
async function getPreDispatchContext() {
  const ratings = await loadToolRatings();
  const toolGuidance = generateToolGuidance(ratings);
  const playbookInsights = extractPlaybookInsights();
  const terminalHints = analyzeTerminalPerformance();

  return {
    toolGuidance,
    playbookInsights,
    terminalHints,
  };
}

/**
 * Format pre-dispatch context as a string block for prompt injection.
 * @param {object} ctx - Output from getPreDispatchContext()
 * @returns {string}
 */
function formatContextForInjection(ctx) {
  const lines = ['[SYSTEM GUIDANCE from prior sessions]'];

  if (ctx.toolGuidance.length > 0) {
    for (const g of ctx.toolGuidance) {
      lines.push(`- ${g}`);
    }
  }

  if (ctx.playbookInsights.length > 0) {
    lines.push('');
    for (const i of ctx.playbookInsights.slice(0, 5)) { // Limit to top 5
      lines.push(`- ${i}`);
    }
  }

  if (ctx.terminalHints._comparison) {
    lines.push(`- ${ctx.terminalHints._comparison}`);
  }

  lines.push('[END GUIDANCE]');
  return lines.join('\n');
}

// CLI mode: node pre-dispatch.js
if (require.main === module) {
  getPreDispatchContext()
    .then(ctx => {
      console.log('=== Pre-Dispatch Context ===\n');
      console.log('Tool Guidance:');
      ctx.toolGuidance.forEach(g => console.log(`  - ${g}`));
      console.log('\nPlaybook Insights:');
      ctx.playbookInsights.forEach(i => console.log(`  - ${i}`));
      console.log('\nTerminal Hints:', JSON.stringify(ctx.terminalHints, null, 2));
      console.log('\n=== Formatted for Injection ===\n');
      console.log(formatContextForInjection(ctx));
    })
    .catch(err => { console.error('Failed:', err.message); process.exit(1); });
}

module.exports = { getPreDispatchContext, formatContextForInjection, loadToolRatings };
