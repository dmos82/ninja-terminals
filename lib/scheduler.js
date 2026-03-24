'use strict';

/**
 * Maximum "rest" duration (ms) for recency scoring.
 * Terminals resting longer than this get max recency score.
 */
const MAX_REST_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Context usage threshold. Terminals above this are excluded.
 */
const CONTEXT_THRESHOLD = 80;

/**
 * Scoring weights (must sum to 1.0).
 */
const WEIGHT_AFFINITY = 0.4;
const WEIGHT_CAPACITY = 0.4;
const WEIGHT_RECENCY = 0.2;

/**
 * Check whether two scope arrays have overlapping paths.
 * A path overlaps if one is a prefix of the other (directory containment)
 * or if they are identical.
 *
 * @param {string[]} scopeA
 * @param {string[]} scopeB
 * @returns {boolean}
 */
function scopesOverlap(scopeA, scopeB) {
  for (const a of scopeA) {
    for (const b of scopeB) {
      if (a === b || a.startsWith(b) || b.startsWith(a)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Compute affinity score: how many of the task's scope paths overlap with
 * the terminal's previousFiles. Returns 0-100.
 *
 * @param {string[]} taskScope - File/directory paths the task owns
 * @param {string[]} previousFiles - Files the terminal has worked on
 * @returns {number} 0-100
 */
function computeAffinity(taskScope, previousFiles) {
  if (!taskScope || taskScope.length === 0) return 50; // neutral if no scope
  if (!previousFiles || previousFiles.length === 0) return 0;

  let matches = 0;
  for (const scopePath of taskScope) {
    for (const file of previousFiles) {
      if (file === scopePath || file.startsWith(scopePath) || scopePath.startsWith(file)) {
        matches++;
        break; // count each scope path at most once
      }
    }
  }

  return Math.round((matches / taskScope.length) * 100);
}

/**
 * Compute capacity score from context percentage. More headroom = higher score.
 *
 * @param {number} contextPct - Current context window usage (0-100)
 * @returns {number} 0-100
 */
function computeCapacity(contextPct) {
  return Math.max(0, Math.min(100, 100 - contextPct));
}

/**
 * Compute recency score: how long the terminal has been resting.
 * Longer rest = higher score, capped at MAX_REST_MS.
 *
 * @param {number|null} lastTaskCompletedAt - Timestamp of last task completion
 * @returns {number} 0-100
 */
function computeRecency(lastTaskCompletedAt) {
  if (!lastTaskCompletedAt) return 100; // never used = fully rested
  const elapsed = Date.now() - lastTaskCompletedAt;
  if (elapsed <= 0) return 0;
  return Math.round(Math.min(elapsed / MAX_REST_MS, 1) * 100);
}

/**
 * Filter terminals that cannot accept a given task.
 *
 * Exclusion criteria:
 * - Status is not 'idle'
 * - contextPct exceeds threshold (>80)
 * - Circuit breaker is OPEN
 * - Scope conflicts with task scope
 *
 * @param {object[]} terminals - Array of terminal status objects
 * @param {object} task - Task object with scope property
 * @returns {object[]} Filtered array of eligible terminals
 * @throws {Error} If inputs are invalid
 */
function filterTerminals(terminals, task) {
  if (!Array.isArray(terminals)) {
    throw new Error('terminals must be an array');
  }
  if (!task || typeof task !== 'object') {
    throw new Error('task must be a non-null object');
  }

  const taskScope = Array.isArray(task.scope) ? task.scope : [];

  return terminals.filter((terminal) => {
    // Must be idle
    if (terminal.status !== 'idle') return false;

    // Must have context headroom
    if (typeof terminal.contextPct === 'number' && terminal.contextPct > CONTEXT_THRESHOLD) {
      return false;
    }

    // Circuit breaker must not be open
    if (terminal.circuitBreakerState === 'OPEN') return false;

    // Scope must not conflict (only if both have scope)
    if (
      taskScope.length > 0 &&
      Array.isArray(terminal.scope) &&
      terminal.scope.length > 0 &&
      scopesOverlap(taskScope, terminal.scope)
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Score eligible terminal candidates for a task using a weighted multi-factor model.
 *
 * Factors and weights:
 * - Affinity  (40%): overlap between task scope and terminal's previous files
 * - Capacity  (40%): available context window headroom
 * - Recency   (20%): time since last task completion (longer rest = better)
 *
 * @param {object[]} candidates - Filtered array of terminal status objects
 * @param {object} task - Task object with scope property
 * @returns {object[]} Candidates with `.score` property, sorted descending by score
 * @throws {Error} If inputs are invalid
 */
function scoreTerminals(candidates, task) {
  if (!Array.isArray(candidates)) {
    throw new Error('candidates must be an array');
  }
  if (!task || typeof task !== 'object') {
    throw new Error('task must be a non-null object');
  }

  const taskScope = Array.isArray(task.scope) ? task.scope : [];

  const scored = candidates.map((terminal) => {
    const affinity = computeAffinity(
      taskScope,
      Array.isArray(terminal.previousFiles) ? terminal.previousFiles : []
    );
    const capacity = computeCapacity(
      typeof terminal.contextPct === 'number' ? terminal.contextPct : 0
    );
    const recency = computeRecency(terminal.lastTaskCompletedAt || null);

    const score = Math.round(
      affinity * WEIGHT_AFFINITY +
        capacity * WEIGHT_CAPACITY +
        recency * WEIGHT_RECENCY
    );

    return { ...terminal, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Convenience function: filter, score, and select the best terminal for a task.
 *
 * @param {object[]} terminals - Array of terminal status objects
 * @param {object} task - Task object
 * @returns {object|null} Best terminal with score, or null if none eligible
 */
function selectTerminal(terminals, task) {
  if (!Array.isArray(terminals)) {
    throw new Error('terminals must be an array');
  }
  if (!task || typeof task !== 'object') {
    throw new Error('task must be a non-null object');
  }

  const filtered = filterTerminals(terminals, task);
  if (filtered.length === 0) return null;

  const scored = scoreTerminals(filtered, task);
  return scored.length > 0 ? scored[0] : null;
}

module.exports = {
  filterTerminals,
  scoreTerminals,
  selectTerminal,
};
