'use strict';

const fs = require('fs');
const path = require('path');
const { parsePlaybooks } = require('./playbook-tracker');
const { SUMMARIES_PATH } = require('./analyze-session');

const STATE_PATH = path.join(__dirname, '..', 'orchestrator', 'metrics', 'hypothesis-state.json');

// Decision thresholds from Phase 4 spec
const MIN_TEST_SESSIONS = 3;
const IMPROVEMENT_THRESHOLD = 0.10; // 10%

/**
 * Extract metric targets from hypothesis text.
 * Maps hypothesis claims to measurable metrics.
 * @param {string} hypothesisText - The full hypothesis section text
 * @returns {object} { type: 'tool'|'session'|'pattern', target: string, metric: string }
 */
function extractMetricTarget(hypothesisText) {
  const text = hypothesisText.toLowerCase();

  // Tool-specific hypotheses: "Edit has C rating", "prefer Write over Edit", "Glob is reliable"
  const toolPatterns = [
    { regex: /\b(edit|write|read|bash|glob|grep|agent)\b.*\b(rating|reliable|failure|prefer)/i, metric: 'success_rate' },
    { regex: /prefer\s+(\w+)\s+over\s+(\w+)/i, metric: 'success_rate' },
    { regex: /\b(\w+)\s+has\s+[a-s]\s+rating/i, metric: 'success_rate' },
  ];

  for (const pattern of toolPatterns) {
    const match = hypothesisText.match(pattern.regex);
    if (match) {
      // Extract the tool name (capitalize first letter)
      const toolName = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      return { type: 'tool', target: toolName, metric: pattern.metric };
    }
  }

  // Session-level hypotheses: "staggered dispatch", "session time"
  if (text.includes('staggered') || text.includes('dispatch') || text.includes('session time')) {
    return { type: 'session', target: 'duration', metric: 'duration_min' };
  }

  // Default: overall tool success rate
  return { type: 'aggregate', target: 'all_tools', metric: 'success_rate' };
}

/**
 * Load all session summaries from NDJSON file.
 * @param {string} summariesPath
 * @returns {Array<object>} Parsed session summaries
 */
function loadSummaries(summariesPath) {
  const filePath = summariesPath || SUMMARIES_PATH;
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const summaries = [];

  for (const line of lines) {
    try {
      summaries.push(JSON.parse(line));
    } catch { /* skip malformed */ }
  }

  // Deduplicate by session_id (keep latest)
  const seen = new Map();
  for (const s of summaries) {
    seen.set(s.session_id, s);
  }

  return Array.from(seen.values());
}

/**
 * Load or initialize hypothesis tracking state.
 * Tracks when each hypothesis was first observed (by session count).
 * @returns {object} { hypotheses: { [name]: { firstSeenAt: number, sessionCount: number } } }
 */
function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { hypotheses: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { hypotheses: {} };
  }
}

/**
 * Save hypothesis tracking state.
 * @param {object} state
 */
function saveState(state) {
  const dir = path.dirname(STATE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Compute aggregate metrics for a set of sessions.
 * @param {Array<object>} sessions
 * @param {object} target - { type, target, metric }
 * @returns {object} { value: number, sampleSize: number }
 */
function computeMetric(sessions, target) {
  if (sessions.length === 0) {
    return { value: null, sampleSize: 0 };
  }

  if (target.type === 'tool') {
    // Aggregate tool-specific metrics
    let totalInvocations = 0;
    let totalSuccesses = 0;

    for (const s of sessions) {
      const toolData = s.tools?.[target.target];
      if (toolData) {
        totalInvocations += toolData.invocations || 0;
        totalSuccesses += toolData.successes || 0;
      }
    }

    if (totalInvocations === 0) {
      return { value: null, sampleSize: 0 };
    }

    return {
      value: totalSuccesses / totalInvocations,
      sampleSize: totalInvocations,
    };
  }

  if (target.type === 'session') {
    // Session-level metrics (e.g., duration)
    const values = sessions.map(s => s[target.metric]).filter(v => v != null && v > 0);
    if (values.length === 0) {
      return { value: null, sampleSize: 0 };
    }

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { value: avg, sampleSize: values.length };
  }

  // Aggregate: all tools combined
  let totalInvocations = 0;
  let totalSuccesses = 0;

  for (const s of sessions) {
    for (const toolData of Object.values(s.tools || {})) {
      totalInvocations += toolData.invocations || 0;
      totalSuccesses += toolData.successes || 0;
    }
  }

  if (totalInvocations === 0) {
    return { value: null, sampleSize: 0 };
  }

  return {
    value: totalSuccesses / totalInvocations,
    sampleSize: totalInvocations,
  };
}

/**
 * Calculate percentage change between baseline and test.
 * For success rates: positive = improvement
 * For duration: negative = improvement (faster)
 * @param {number} baseline
 * @param {number} test
 * @param {string} metric
 * @returns {number} Change as decimal (-0.15 = 15% worse, 0.15 = 15% better)
 */
function calculateChange(baseline, test, metric) {
  if (baseline === 0 || baseline == null || test == null) {
    return null;
  }

  const rawChange = (test - baseline) / baseline;

  // For duration, lower is better, so invert
  if (metric === 'duration_min') {
    return -rawChange;
  }

  return rawChange;
}

/**
 * Validate all hypotheses in playbooks.md against session metrics.
 * Compares baseline (before hypothesis) vs test (after hypothesis) periods.
 *
 * Decision rules (from Phase 4 spec):
 * - 3+ test sessions AND metric improved by >10% -> promote
 * - 3+ test sessions AND metric worsened by >10% -> reject
 * - Otherwise -> continue (need more data)
 *
 * @param {string} playbooksPath - Path to playbooks.md
 * @param {string} summariesPath - Path to summaries.ndjson
 * @returns {Array<{ hypothesis: string, decision: 'promote'|'reject'|'continue', evidence: string, metrics: object }>}
 */
function validateHypotheses(playbooksPath, summariesPath) {
  const playbooks = parsePlaybooks(playbooksPath);
  const summaries = loadSummaries(summariesPath);
  const state = loadState();
  const results = [];

  // Filter for hypothesis/testing entries (status may contain extra text)
  const hypotheses = playbooks.filter(p =>
    p.status.includes('hypothesis') || p.status.includes('testing')
  );

  const currentSessionCount = summaries.length;

  for (const hyp of hypotheses) {
    // Initialize tracking if new hypothesis
    if (!state.hypotheses[hyp.name]) {
      state.hypotheses[hyp.name] = {
        firstSeenAt: currentSessionCount,
        sessionCountAtStart: currentSessionCount,
      };
    }

    const tracking = state.hypotheses[hyp.name];
    const target = extractMetricTarget(hyp.section);

    // Split sessions into baseline (before hypothesis) and test (after)
    const baselineSessions = summaries.slice(0, tracking.firstSeenAt);
    const testSessions = summaries.slice(tracking.firstSeenAt);

    const baselineMetric = computeMetric(baselineSessions, target);
    const testMetric = computeMetric(testSessions, target);

    const change = calculateChange(baselineMetric.value, testMetric.value, target.metric);

    // Build evidence string
    const evidenceParts = [];
    evidenceParts.push(`Target: ${target.target} (${target.metric})`);
    evidenceParts.push(`Baseline: ${baselineMetric.value?.toFixed(3) ?? 'N/A'} (${baselineMetric.sampleSize} samples)`);
    evidenceParts.push(`Test: ${testMetric.value?.toFixed(3) ?? 'N/A'} (${testMetric.sampleSize} samples)`);
    if (change != null) {
      const changePercent = (change * 100).toFixed(1);
      evidenceParts.push(`Change: ${change > 0 ? '+' : ''}${changePercent}%`);
    }
    evidenceParts.push(`Test sessions: ${testSessions.length}`);

    // Decision logic
    let decision = 'continue';
    let reason = '';

    if (testSessions.length < MIN_TEST_SESSIONS) {
      reason = `Need ${MIN_TEST_SESSIONS}+ test sessions, have ${testSessions.length}`;
    } else if (change == null) {
      reason = 'Insufficient metric data for comparison';
    } else if (change >= IMPROVEMENT_THRESHOLD) {
      decision = 'promote';
      reason = `Improved by ${(change * 100).toFixed(1)}% (>${IMPROVEMENT_THRESHOLD * 100}% threshold)`;
    } else if (change <= -IMPROVEMENT_THRESHOLD) {
      decision = 'reject';
      reason = `Worsened by ${(-change * 100).toFixed(1)}% (>${IMPROVEMENT_THRESHOLD * 100}% threshold)`;
    } else {
      reason = `Change of ${(change * 100).toFixed(1)}% within neutral zone (±${IMPROVEMENT_THRESHOLD * 100}%)`;
    }

    results.push({
      hypothesis: hyp.name,
      status: hyp.status,
      decision,
      evidence: evidenceParts.join(' | ') + ` | ${reason}`,
      metrics: {
        target,
        baseline: baselineMetric,
        test: testMetric,
        change,
        testSessionCount: testSessions.length,
      },
    });
  }

  // Save updated state
  saveState(state);

  return results;
}

/**
 * Get a summary of hypothesis validation status.
 * @param {Array} results - Output from validateHypotheses
 * @returns {object} { total, promote, reject, continue, summary: string }
 */
function summarizeResults(results) {
  const counts = {
    total: results.length,
    promote: results.filter(r => r.decision === 'promote').length,
    reject: results.filter(r => r.decision === 'reject').length,
    continue: results.filter(r => r.decision === 'continue').length,
  };

  const lines = [
    `Hypothesis validation: ${counts.total} total`,
    `  Promote: ${counts.promote}`,
    `  Reject: ${counts.reject}`,
    `  Continue: ${counts.continue}`,
  ];

  for (const r of results) {
    lines.push(`  - [${r.decision.toUpperCase()}] ${r.hypothesis}`);
  }

  return { ...counts, summary: lines.join('\n') };
}

// CLI mode
if (require.main === module) {
  const playbooksPath = process.argv[2] || path.join(__dirname, '..', 'orchestrator', 'playbooks.md');
  const summariesPath = process.argv[3] || SUMMARIES_PATH;

  console.log('Validating hypotheses...');
  console.log('  Playbooks:', playbooksPath);
  console.log('  Summaries:', summariesPath);
  console.log('');

  const results = validateHypotheses(playbooksPath, summariesPath);
  const summary = summarizeResults(results);

  console.log(summary.summary);
  console.log('');
  console.log('Details:');
  for (const r of results) {
    console.log(`\n${r.hypothesis}:`);
    console.log(`  Decision: ${r.decision}`);
    console.log(`  Evidence: ${r.evidence}`);
  }
}

module.exports = {
  validateHypotheses,
  summarizeResults,
  extractMetricTarget,
  loadSummaries,
  computeMetric,
  calculateChange,
  STATE_PATH,
};
