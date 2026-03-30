'use strict';

const fs = require('fs');
const path = require('path');
const { analyzeSession, SUMMARIES_PATH } = require('./analyze-session');
const { rateTools } = require('./tool-rater');
const { validateHypotheses, summarizeResults } = require('./hypothesis-validator');
const { safeAppend, safeWrite } = require('./safe-file-writer');
const { logEvolution } = require('./evolution-writer');

// Paths
const RAW_DIR = path.join(__dirname, '..', 'orchestrator', 'metrics', 'raw');
const PROCESSED_PATH = path.join(__dirname, '..', 'orchestrator', 'metrics', 'processed.json');
const TOOL_RATINGS_PATH = path.join(__dirname, '..', 'orchestrator', 'metrics', 'tool-ratings.json');
const TOOL_RATINGS_PREV_PATH = path.join(__dirname, '..', 'orchestrator', 'metrics', 'tool-ratings-prev.json');
const PLAYBOOKS_PATH = path.join(__dirname, '..', 'orchestrator', 'playbooks.md');

/**
 * Load previous tool ratings for comparison.
 * @returns {object|null}
 */
function loadPreviousRatings() {
  if (!fs.existsSync(TOOL_RATINGS_PREV_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOOL_RATINGS_PREV_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Save current ratings as previous before computing new ones.
 */
function savePreviousRatings() {
  if (fs.existsSync(TOOL_RATINGS_PATH)) {
    try {
      const current = fs.readFileSync(TOOL_RATINGS_PATH, 'utf8');
      fs.writeFileSync(TOOL_RATINGS_PREV_PATH, current, 'utf8');
    } catch { /* ignore */ }
  }
}

/**
 * Generate a human-readable learning summary comparing before/after.
 * @param {object} currentRatings - Current tool ratings
 * @param {object|null} previousRatings - Previous tool ratings (null if first run)
 * @param {object} hypothesisValidation - Results from hypothesis validation
 * @param {string[]} newGuidance - New guidance strings being injected
 * @returns {{ plainText: string, structured: object }}
 */
function generateLearningSummary(currentRatings, previousRatings, hypothesisValidation, newGuidance) {
  const toolChanges = [];
  const lines = [];

  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║                    SESSION LEARNINGS                         ║');
  lines.push('╠══════════════════════════════════════════════════════════════╣');

  // Tool changes
  lines.push('║  Tool Rating Changes:                                        ║');
  for (const [tool, stats] of Object.entries(currentRatings)) {
    const prev = previousRatings?.[tool];
    const currRate = (stats.success_rate * 100).toFixed(0);
    const currRating = stats.rating;

    if (prev) {
      const prevRate = (prev.success_rate * 100).toFixed(0);
      const prevRating = prev.rating;
      const delta = stats.success_rate - prev.success_rate;
      const deltaStr = delta >= 0 ? `+${(delta * 100).toFixed(0)}%` : `${(delta * 100).toFixed(0)}%`;

      if (prevRating !== currRating || Math.abs(delta) >= 0.05) {
        const change = { tool, from: prevRating, to: currRating, delta: deltaStr };
        toolChanges.push(change);
        lines.push(`║    ${tool}: ${prevRating}→${currRating} (${deltaStr})`.padEnd(63) + '║');
      }
    } else {
      // New tool
      toolChanges.push({ tool, from: null, to: currRating, delta: 'new' });
      lines.push(`║    ${tool}: ${currRating} (${currRate}% success) [NEW]`.padEnd(63) + '║');
    }
  }

  if (toolChanges.length === 0) {
    lines.push('║    No significant changes                                    ║');
  }

  lines.push('║                                                               ║');

  // Hypothesis updates
  lines.push('║  Hypothesis Updates:                                         ║');
  const promoted = hypothesisValidation.promoted || [];
  const rejected = hypothesisValidation.rejected || [];
  const continuing = hypothesisValidation.continue || [];

  if (promoted.length > 0) {
    for (const h of promoted) {
      lines.push(`║    ✓ PROMOTED: ${h.substring(0, 43)}`.padEnd(63) + '║');
    }
  }
  if (rejected.length > 0) {
    for (const h of rejected) {
      lines.push(`║    ✗ REJECTED: ${h.substring(0, 43)}`.padEnd(63) + '║');
    }
  }
  if (continuing.length > 0) {
    lines.push(`║    ⋯ ${continuing.length} hypothesis(es) still testing`.padEnd(63) + '║');
  }
  if (promoted.length === 0 && rejected.length === 0 && continuing.length === 0) {
    lines.push('║    No hypotheses to validate                                 ║');
  }

  lines.push('║                                                               ║');

  // New guidance
  lines.push('║  Active Guidance (injected into dispatches):                 ║');
  if (newGuidance && newGuidance.length > 0) {
    for (const g of newGuidance.slice(0, 5)) {
      lines.push(`║    • ${g.substring(0, 55)}`.padEnd(63) + '║');
    }
    if (newGuidance.length > 5) {
      lines.push(`║    ... and ${newGuidance.length - 5} more`.padEnd(63) + '║');
    }
  } else {
    lines.push('║    None yet                                                  ║');
  }

  lines.push('╚══════════════════════════════════════════════════════════════╝');

  return {
    plainText: lines.join('\n'),
    structured: {
      toolChanges,
      hypothesisUpdates: {
        promoted,
        rejected,
        continuing,
      },
      guidance: newGuidance || [],
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Load the set of already-processed NDJSON files.
 * @returns {Set<string>} File basenames that have been processed
 */
function loadProcessedFiles() {
  if (!fs.existsSync(PROCESSED_PATH)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(PROCESSED_PATH, 'utf8'));
    return new Set(data.files || []);
  } catch {
    return new Set();
  }
}

/**
 * Save the set of processed NDJSON files.
 * @param {Set<string>} processed
 */
function saveProcessedFiles(processed) {
  const dir = path.dirname(PROCESSED_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROCESSED_PATH, JSON.stringify({
    files: Array.from(processed),
    lastUpdated: new Date().toISOString(),
  }, null, 2), 'utf8');
}

/**
 * Find all unprocessed NDJSON files in the raw directory.
 * @returns {string[]} Full paths to unprocessed files
 */
function findUnprocessedFiles() {
  if (!fs.existsSync(RAW_DIR)) return [];

  const processed = loadProcessedFiles();
  const allFiles = fs.readdirSync(RAW_DIR)
    .filter(f => f.endsWith('.ndjson'))
    .filter(f => !processed.has(f));

  return allFiles.map(f => path.join(RAW_DIR, f));
}

/**
 * Process all raw NDJSON files - analyze each and append to summaries.
 * @returns {Promise<{ processed: number, summaries: object[] }>}
 */
async function processRawFiles() {
  const unprocessed = findUnprocessedFiles();
  const processed = loadProcessedFiles();
  const summaries = [];

  for (const filePath of unprocessed) {
    try {
      const summary = await analyzeSession(filePath);
      safeAppend(SUMMARIES_PATH, JSON.stringify(summary));
      summaries.push(summary);
      processed.add(path.basename(filePath));
      console.log(`[post-session] Processed: ${path.basename(filePath)}`);
    } catch (err) {
      console.error(`[post-session] Failed to process ${filePath}:`, err.message);
    }
  }

  saveProcessedFiles(processed);
  return { processed: summaries.length, summaries };
}

/**
 * Compute and save tool ratings to tool-ratings.json.
 * Saves previous ratings first for comparison.
 * @returns {Promise<{ current: object, previous: object|null }>}
 */
async function computeAndSaveRatings() {
  // Save current as previous before overwriting
  savePreviousRatings();
  const previousRatings = loadPreviousRatings();

  const ratingsMap = await rateTools();
  const ratings = {};
  for (const [tool, data] of ratingsMap) {
    ratings[tool] = data;
  }

  fs.mkdirSync(path.dirname(TOOL_RATINGS_PATH), { recursive: true });
  fs.writeFileSync(TOOL_RATINGS_PATH, JSON.stringify(ratings, null, 2), 'utf8');
  console.log(`[post-session] Tool ratings saved to ${TOOL_RATINGS_PATH}`);

  return { current: ratings, previous: previousRatings };
}

/**
 * Update playbooks.md status for a hypothesis.
 * @param {string} hypothesisName
 * @param {string} newStatus - 'validated' or 'rejected'
 * @param {string} evidence
 * @returns {boolean} True if updated
 */
function updatePlaybookStatus(hypothesisName, newStatus, evidence) {
  if (!fs.existsSync(PLAYBOOKS_PATH)) return false;

  let content = fs.readFileSync(PLAYBOOKS_PATH, 'utf8');
  const originalContent = content;

  // Find the section for this hypothesis and update its status
  // Look for **Status:** lines after the hypothesis name/section
  const sections = content.split(/^### /m);
  let updated = false;

  const newSections = sections.map((section, i) => {
    if (i === 0) return section; // Header before first ###

    // Check if this section contains/relates to the hypothesis
    const sectionNameMatch = section.match(/^([^\n]+)/);
    const sectionName = sectionNameMatch ? sectionNameMatch[1].trim() : '';

    // Match by name or by content containing the hypothesis text
    if (sectionName.toLowerCase().includes(hypothesisName.toLowerCase()) ||
        section.toLowerCase().includes(hypothesisName.toLowerCase())) {

      // Update Status line if it contains hypothesis or testing
      const statusRegex = /\*\*Status:\*\*\s*(?:hypothesis|testing)[^\n]*/gi;
      if (statusRegex.test(section)) {
        const date = new Date().toISOString().split('T')[0];
        const newStatusLine = `**Status:** ${newStatus} (${date}) — ${evidence.substring(0, 100)}`;
        section = section.replace(statusRegex, newStatusLine);
        updated = true;
      }
    }

    return '### ' + section;
  });

  if (updated) {
    content = newSections.join('');
    safeWrite(PLAYBOOKS_PATH, content);
    console.log(`[post-session] Updated playbook status: ${hypothesisName} -> ${newStatus}`);
  }

  return updated;
}

/**
 * Run hypothesis validation and update playbooks accordingly.
 * @returns {object} { results: array, promoted: array, rejected: array }
 */
function runHypothesisValidation() {
  const results = validateHypotheses(PLAYBOOKS_PATH, SUMMARIES_PATH);
  const promoted = [];
  const rejected = [];

  for (const result of results) {
    if (result.decision === 'promote') {
      const updated = updatePlaybookStatus(result.hypothesis, 'validated', result.evidence);
      if (updated) {
        promoted.push(result);
        logEvolution({
          file: 'orchestrator/playbooks.md',
          change: `Promoted hypothesis: ${result.hypothesis}`,
          why: 'Metric improvement exceeded 10% threshold over 3+ sessions',
          evidence: result.evidence,
          reversible: 'yes',
        });
      }
    } else if (result.decision === 'reject') {
      const updated = updatePlaybookStatus(result.hypothesis, 'rejected', result.evidence);
      if (updated) {
        rejected.push(result);
        logEvolution({
          file: 'orchestrator/playbooks.md',
          change: `Rejected hypothesis: ${result.hypothesis}`,
          why: 'Metric worsened by >10% over 3+ sessions',
          evidence: result.evidence,
          reversible: 'yes',
        });
      }
    }
  }

  return { results, promoted, rejected };
}

/**
 * Run the full post-session automation pipeline.
 * Called when a session ends (all terminals idle or manual trigger).
 *
 * Steps:
 * 1. Process all unprocessed NDJSON files
 * 2. Compute and save tool ratings
 * 3. Run hypothesis validation
 * 4. Update playbooks with promotions/rejections
 * 5. Log evolution changes
 *
 * @returns {Promise<object>} Pipeline results
 */
async function runPostSession() {
  console.log('[post-session] Starting post-session automation...');
  const startTime = Date.now();

  // Step 1: Process raw NDJSON files
  const { processed: filesProcessed, summaries } = await processRawFiles();
  console.log(`[post-session] Processed ${filesProcessed} raw NDJSON files`);

  // Step 2: Compute tool ratings (saves previous first)
  const { current: ratings, previous: previousRatings } = await computeAndSaveRatings();
  const toolCount = Object.keys(ratings).length;
  console.log(`[post-session] Computed ratings for ${toolCount} tools`);

  // Step 3-4: Validate hypotheses and update playbooks
  const validation = runHypothesisValidation();
  const validationSummary = summarizeResults(validation.results);
  console.log(`[post-session] Hypothesis validation: ${validationSummary.promote} promoted, ${validationSummary.reject} rejected, ${validationSummary.continue} continue`);

  // Step 5: Generate guidance for next session (for summary)
  let newGuidance = [];
  try {
    const { getPreDispatchContext } = require('./pre-dispatch');
    const ctx = await getPreDispatchContext();
    newGuidance = ctx.toolGuidance || [];
  } catch { /* pre-dispatch might not be loaded */ }

  // Step 6: Generate learning summary
  const hypothesisValidation = {
    total: validation.results.length,
    promoted: validation.promoted.map(r => r.hypothesis),
    rejected: validation.rejected.map(r => r.hypothesis),
    continue: validation.results.filter(r => r.decision === 'continue').map(r => r.hypothesis),
    details: validation.results,
  };

  const learningSummary = generateLearningSummary(ratings, previousRatings, hypothesisValidation, newGuidance);

  const duration = Date.now() - startTime;
  console.log(`[post-session] Pipeline completed in ${duration}ms`);

  // Print summary to console
  console.log('\n' + learningSummary.plainText);

  return {
    filesProcessed,
    summaries: summaries.map(s => ({ session_id: s.session_id, terminal: s.terminal, duration_min: s.duration_min })),
    toolRatings: ratings,
    previousRatings,
    hypothesisValidation,
    learningSummary,
    duration_ms: duration,
    ts: new Date().toISOString(),
  };
}

// CLI mode
if (require.main === module) {
  runPostSession()
    .then(result => {
      console.log('\n=== Post-Session Report ===');
      console.log(`Files processed: ${result.filesProcessed}`);
      console.log(`Tools rated: ${Object.keys(result.toolRatings).length}`);
      console.log(`Hypotheses: ${result.hypothesisValidation.total} total`);
      console.log(`  Promoted: ${result.hypothesisValidation.promoted.join(', ') || 'none'}`);
      console.log(`  Rejected: ${result.hypothesisValidation.rejected.join(', ') || 'none'}`);
      console.log(`  Continue: ${result.hypothesisValidation.continue.length}`);
      console.log(`Duration: ${result.duration_ms}ms`);
    })
    .catch(err => {
      console.error('Post-session failed:', err.message);
      process.exit(1);
    });
}

module.exports = {
  runPostSession,
  processRawFiles,
  computeAndSaveRatings,
  runHypothesisValidation,
  updatePlaybookStatus,
  findUnprocessedFiles,
  loadProcessedFiles,
  saveProcessedFiles,
  generateLearningSummary,
  loadPreviousRatings,
  TOOL_RATINGS_PATH,
  RAW_DIR,
};
