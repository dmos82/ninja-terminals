'use strict';

const fs = require('fs');
const { SUMMARIES_PATH } = require('./analyze-session');

/**
 * Read all session summaries and compute per-tool effectiveness ratings.
 * @returns {Promise<Map<string, object>>} tool name -> { invocations, success_rate, avg_duration_ms, frequency, composite, rating }
 */
async function rateTools() {
  const ratings = new Map();

  if (!fs.existsSync(SUMMARIES_PATH)) return ratings;

  const lines = fs.readFileSync(SUMMARIES_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const sessions = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const totalSessions = sessions.length;
  if (totalSessions === 0) return ratings;

  // Aggregate per tool across all sessions
  const agg = {};
  for (const s of sessions) {
    if (!s.tools) continue;
    for (const [tool, stats] of Object.entries(s.tools)) {
      if (!agg[tool]) agg[tool] = { invocations: 0, successes: 0, failures: 0, total_duration_ms: 0, sessions: 0 };
      const a = agg[tool];
      a.invocations += stats.invocations || 0;
      a.successes += stats.successes || 0;
      a.failures += stats.failures || 0;
      a.total_duration_ms += stats.total_duration_ms || (stats.avg_duration_ms || 0) * (stats.invocations || 0);
      a.sessions++;
    }
  }

  for (const [tool, a] of Object.entries(agg)) {
    const successRate = a.invocations > 0 ? a.successes / a.invocations : 0;
    const avgDuration = a.invocations > 0 ? a.total_duration_ms / a.invocations : 0;
    const frequency = a.sessions / totalSessions;

    // Composite score: success matters most, then usage frequency, then speed
    const speedScore = 1 - Math.min(avgDuration / 30000, 1); // <30s is good
    const composite = (successRate * 0.5) + (frequency * 0.3) + (speedScore * 0.2);

    let rating;
    if (composite >= 0.85) rating = 'S';
    else if (composite >= 0.70) rating = 'A';
    else if (composite >= 0.50) rating = 'B';
    else rating = 'C';

    ratings.set(tool, {
      invocations: a.invocations,
      success_rate: +successRate.toFixed(3),
      avg_duration_ms: Math.round(avgDuration),
      frequency: +frequency.toFixed(3),
      composite: +composite.toFixed(3),
      rating,
    });
  }

  return ratings;
}

module.exports = { rateTools };
