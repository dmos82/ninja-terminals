'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { safeAppend } = require('./safe-file-writer');

const SUMMARIES_PATH = path.join(__dirname, '..', 'orchestrator', 'metrics', 'summaries.ndjson');

/**
 * Analyze a raw NDJSON session file and return a summary object.
 * @param {string} filePath - Path to a session-*.ndjson file
 * @returns {Promise<object>} Session summary
 */
async function analyzeSession(filePath) {
  const tools = {};
  const insights = [];
  let firstTs = null;
  let lastTs = null;
  let sessionId = 'unknown';
  let terminal = 'unknown';
  let playbook = null;
  let totalEvents = 0;

  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });

  for await (const line of rl) {
    try {
      const evt = JSON.parse(line);
      totalEvents++;

      if (!firstTs) firstTs = evt.ts;
      lastTs = evt.ts;
      if (evt.session && evt.session !== 'unknown') sessionId = evt.session;
      if (evt.terminal && evt.terminal !== 'unknown') terminal = evt.terminal;

      // Tool events
      if (evt.tool) {
        if (!tools[evt.tool]) {
          tools[evt.tool] = { invocations: 0, successes: 0, failures: 0, total_duration_ms: 0 };
        }
        const t = tools[evt.tool];
        t.invocations++;
        if (evt.status === 'success' || evt.success === true) t.successes++;
        else t.failures++;
        t.total_duration_ms += (evt.duration_ms || 0);
      }

      // Insights and playbook markers
      if (evt.type === 'insight') insights.push(evt.meta || evt.text || '');
      if (evt.type === 'playbook') playbook = evt.meta || evt.text || null;
    } catch { /* skip malformed lines */ }
  }

  // Compute derived stats
  for (const t of Object.values(tools)) {
    t.success_rate = t.invocations > 0 ? +(t.successes / t.invocations).toFixed(3) : 0;
    t.avg_duration_ms = t.invocations > 0 ? Math.round(t.total_duration_ms / t.invocations) : 0;
  }

  const startTime = firstTs ? new Date(firstTs) : new Date();
  const endTime = lastTs ? new Date(lastTs) : new Date();
  const durationMin = Math.round((endTime - startTime) / 60000);

  return {
    session_id: sessionId,
    terminal,
    date: startTime.toISOString().split('T')[0],
    start_ts: firstTs,
    end_ts: lastTs,
    duration_min: durationMin,
    total_events: totalEvents,
    tools,
    insights,
    playbook_used: playbook,
  };
}

// CLI mode: node analyze-session.js <path>
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) { console.error('Usage: node analyze-session.js <ndjson-file>'); process.exit(1); }

  analyzeSession(filePath)
    .then(summary => {
      safeAppend(SUMMARIES_PATH, JSON.stringify(summary));
      console.log('Session summary written to', SUMMARIES_PATH);
    })
    .catch(err => { console.error('Analysis failed:', err.message); process.exit(1); });
}

module.exports = { analyzeSession, SUMMARIES_PATH };
