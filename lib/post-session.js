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
const PLAYBOOKS_PATH = path.join(__dirname, '..', 'orchestrator', 'playbooks.md');

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
 * @returns {Promise<object>} The ratings object
 */
async function computeAndSaveRatings() {
  const ratingsMap = await rateTools();
  const ratings = {};
  for (const [tool, data] of ratingsMap) {
    ratings[tool] = data;
  }

  fs.mkdirSync(path.dirname(TOOL_RATINGS_PATH), { recursive: true });
  fs.writeFileSync(TOOL_RATINGS_PATH, JSON.stringify(ratings, null, 2), 'utf8');
  console.log(`[post-session] Tool ratings saved to ${TOOL_RATINGS_PATH}`);

  return ratings;
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

  // Step 2: Compute tool ratings
  const ratings = await computeAndSaveRatings();
  const toolCount = Object.keys(ratings).length;
  console.log(`[post-session] Computed ratings for ${toolCount} tools`);

  // Step 3-4: Validate hypotheses and update playbooks
  const validation = runHypothesisValidation();
  const validationSummary = summarizeResults(validation.results);
  console.log(`[post-session] Hypothesis validation: ${validationSummary.promote} promoted, ${validationSummary.reject} rejected, ${validationSummary.continue} continue`);

  const duration = Date.now() - startTime;
  console.log(`[post-session] Pipeline completed in ${duration}ms`);

  return {
    filesProcessed,
    summaries: summaries.map(s => ({ session_id: s.session_id, terminal: s.terminal, duration_min: s.duration_min })),
    toolRatings: ratings,
    hypothesisValidation: {
      total: validation.results.length,
      promoted: validation.promoted.map(r => r.hypothesis),
      rejected: validation.rejected.map(r => r.hypothesis),
      continue: validation.results.filter(r => r.decision === 'continue').map(r => r.hypothesis),
      details: validation.results,
    },
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
  TOOL_RATINGS_PATH,
  RAW_DIR,
};
