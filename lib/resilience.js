'use strict';

/**
 * Maximum reset timeout for circuit breaker doubling (5 minutes).
 */
const MAX_RESET_TIMEOUT = 5 * 60 * 1000;

/**
 * Circuit breaker states.
 */
const STATE_CLOSED = 'CLOSED';
const STATE_OPEN = 'OPEN';
const STATE_HALF_OPEN = 'HALF_OPEN';

/**
 * Per-terminal circuit breaker implementing the standard three-state pattern.
 *
 * State machine:
 *   CLOSED --[threshold failures]--> OPEN
 *   OPEN --[resetTimeout elapsed]--> HALF_OPEN
 *   HALF_OPEN --[success]--> CLOSED
 *   HALF_OPEN --[failure]--> OPEN (with doubled resetTimeout, max 5 min)
 */
class CircuitBreaker {
  /**
   * @param {number} terminalId - The terminal this breaker protects
   * @param {object} [options]
   * @param {number} [options.threshold=3] - Consecutive failures before opening
   * @param {number} [options.resetTimeout=60000] - Ms before OPEN transitions to HALF_OPEN
   */
  constructor(terminalId, { threshold = 3, resetTimeout = 60000 } = {}) {
    if (typeof terminalId !== 'number') {
      throw new Error('terminalId must be a number');
    }
    if (typeof threshold !== 'number' || threshold < 1) {
      throw new Error('threshold must be a positive number');
    }
    if (typeof resetTimeout !== 'number' || resetTimeout < 0) {
      throw new Error('resetTimeout must be a non-negative number');
    }

    this._terminalId = terminalId;
    this._threshold = threshold;
    this._resetTimeout = resetTimeout;
    this._currentResetTimeout = resetTimeout;
    this._state = STATE_CLOSED;
    this._failures = 0;
    this._lastFailureAt = null;
    this._openedAt = null;
  }

  /**
   * Record a failure. Increments failure count and opens the circuit
   * if the threshold is reached.
   * In HALF_OPEN state, a failure reopens the circuit with doubled timeout.
   */
  recordFailure() {
    this._failures++;
    this._lastFailureAt = Date.now();

    if (this._state === STATE_HALF_OPEN) {
      // Failure during probe — reopen with doubled timeout
      this._state = STATE_OPEN;
      this._openedAt = Date.now();
      this._currentResetTimeout = Math.min(
        this._currentResetTimeout * 2,
        MAX_RESET_TIMEOUT
      );
    } else if (this._state === STATE_CLOSED && this._failures >= this._threshold) {
      this._state = STATE_OPEN;
      this._openedAt = Date.now();
    }
  }

  /**
   * Record a success. Resets failure count and closes the circuit.
   */
  recordSuccess() {
    this._failures = 0;
    this._state = STATE_CLOSED;
    this._currentResetTimeout = this._resetTimeout;
    this._openedAt = null;
  }

  /**
   * Check whether this terminal can accept a new task.
   *
   * - CLOSED: always true
   * - OPEN: if resetTimeout has elapsed, transition to HALF_OPEN and return true (allow one probe)
   * - HALF_OPEN: false (a probe task is already in flight)
   *
   * @returns {boolean}
   */
  canAcceptTask() {
    if (this._state === STATE_CLOSED) return true;

    if (this._state === STATE_OPEN) {
      const elapsed = Date.now() - this._openedAt;
      if (elapsed >= this._currentResetTimeout) {
        this._state = STATE_HALF_OPEN;
        return true;
      }
      return false;
    }

    // HALF_OPEN — one test task already in flight
    return false;
  }

  /**
   * Current circuit breaker state.
   * @returns {'CLOSED'|'OPEN'|'HALF_OPEN'}
   */
  get state() {
    return this._state;
  }

  /**
   * Current consecutive failure count.
   * @returns {number}
   */
  get failureCount() {
    return this._failures;
  }

  /**
   * Serialize circuit breaker state.
   * @returns {object}
   */
  toJSON() {
    return {
      terminalId: this._terminalId,
      state: this._state,
      failures: this._failures,
      threshold: this._threshold,
      resetTimeout: this._resetTimeout,
      currentResetTimeout: this._currentResetTimeout,
      lastFailureAt: this._lastFailureAt,
      openedAt: this._openedAt,
    };
  }
}

/**
 * Global retry budget that limits retries within a sliding time window.
 * Prevents retry storms from overwhelming the system.
 */
class RetryBudget {
  /**
   * @param {object} [options]
   * @param {number} [options.maxRetries=10] - Maximum retries allowed within the window
   * @param {number} [options.windowMs=600000] - Sliding window duration (default 10 min)
   */
  constructor({ maxRetries = 10, windowMs = 600000 } = {}) {
    if (typeof maxRetries !== 'number' || maxRetries < 0) {
      throw new Error('maxRetries must be a non-negative number');
    }
    if (typeof windowMs !== 'number' || windowMs < 0) {
      throw new Error('windowMs must be a non-negative number');
    }

    this._maxRetries = maxRetries;
    this._windowMs = windowMs;
    /** @type {number[]} */
    this._timestamps = [];
  }

  /**
   * Prune expired timestamps and check if a retry is allowed.
   *
   * @returns {boolean} true if under budget
   */
  canRetry() {
    this._prune();
    return this._timestamps.length < this._maxRetries;
  }

  /**
   * Record a retry. Adds the current timestamp to the window.
   */
  recordRetry() {
    this._timestamps.push(Date.now());
  }

  /**
   * Number of retries remaining in the current window.
   * @returns {number}
   */
  get remaining() {
    this._prune();
    return Math.max(0, this._maxRetries - this._timestamps.length);
  }

  /**
   * Serialize retry budget state.
   * @returns {object}
   */
  toJSON() {
    this._prune();
    return {
      maxRetries: this._maxRetries,
      windowMs: this._windowMs,
      timestamps: [...this._timestamps],
      remaining: this.remaining,
    };
  }

  /**
   * Remove timestamps older than the sliding window.
   * @private
   */
  _prune() {
    const cutoff = Date.now() - this._windowMs;
    this._timestamps = this._timestamps.filter((ts) => ts > cutoff);
  }
}

/**
 * Supervisor that manages terminal restart decisions using Erlang-style strategies.
 * Enforces: "no more than maxRestarts within withinSeconds seconds."
 *
 * Strategies (informational — the caller decides what to do):
 * - one_for_one: only the failed terminal is restarted
 * - one_for_all: all terminals are restarted when one fails
 * - rest_for_one: the failed terminal and all started after it are restarted
 */
class Supervisor {
  /**
   * @param {object} [options]
   * @param {'one_for_one'|'one_for_all'|'rest_for_one'} [options.strategy='one_for_one']
   * @param {number} [options.maxRestarts=3] - Maximum restarts within the window
   * @param {number} [options.withinSeconds=300] - Window duration in seconds (default 5 min)
   */
  constructor({ strategy = 'one_for_one', maxRestarts = 3, withinSeconds = 300 } = {}) {
    const validStrategies = ['one_for_one', 'one_for_all', 'rest_for_one'];
    if (!validStrategies.includes(strategy)) {
      throw new Error(
        `Invalid strategy "${strategy}". Must be one of: ${validStrategies.join(', ')}`
      );
    }
    if (typeof maxRestarts !== 'number' || maxRestarts < 0) {
      throw new Error('maxRestarts must be a non-negative number');
    }
    if (typeof withinSeconds !== 'number' || withinSeconds < 0) {
      throw new Error('withinSeconds must be a non-negative number');
    }

    this._strategy = strategy;
    this._maxRestarts = maxRestarts;
    this._withinMs = withinSeconds * 1000;
    /** @type {Map<number, number[]>} terminalId -> [restart timestamps] */
    this._restarts = new Map();
  }

  /**
   * Record a restart for a terminal and check if it's within the allowed budget.
   *
   * @param {number} terminalId - Terminal being restarted
   * @returns {boolean} true if restart is allowed, false if max exceeded
   */
  recordRestart(terminalId) {
    if (typeof terminalId !== 'number') {
      throw new Error('terminalId must be a number');
    }

    if (!this._restarts.has(terminalId)) {
      this._restarts.set(terminalId, []);
    }

    const timestamps = this._restarts.get(terminalId);
    this._pruneTimestamps(timestamps);

    if (timestamps.length >= this._maxRestarts) {
      return false;
    }

    timestamps.push(Date.now());
    return true;
  }

  /**
   * Check if a restart would be allowed without actually recording it.
   *
   * @param {number} terminalId - Terminal to check
   * @returns {boolean} true if a restart is currently allowed
   */
  shouldRestart(terminalId) {
    if (typeof terminalId !== 'number') {
      throw new Error('terminalId must be a number');
    }

    if (!this._restarts.has(terminalId)) return true;

    const timestamps = [...this._restarts.get(terminalId)];
    const cutoff = Date.now() - this._withinMs;
    const recent = timestamps.filter((ts) => ts > cutoff);
    return recent.length < this._maxRestarts;
  }

  /**
   * Clear restart history for a specific terminal.
   *
   * @param {number} terminalId - Terminal to reset
   */
  reset(terminalId) {
    if (typeof terminalId !== 'number') {
      throw new Error('terminalId must be a number');
    }
    this._restarts.delete(terminalId);
  }

  /**
   * Clear restart history for all terminals.
   */
  resetAll() {
    this._restarts.clear();
  }

  /**
   * Get the current restart count within the window for a terminal.
   *
   * @param {number} terminalId - Terminal to check
   * @returns {number}
   */
  getRestartCount(terminalId) {
    if (typeof terminalId !== 'number') {
      throw new Error('terminalId must be a number');
    }
    if (!this._restarts.has(terminalId)) return 0;

    const timestamps = this._restarts.get(terminalId);
    this._pruneTimestamps(timestamps);
    return timestamps.length;
  }

  /**
   * Serialize supervisor state.
   * @returns {object}
   */
  toJSON() {
    const restarts = {};
    for (const [id, timestamps] of this._restarts) {
      this._pruneTimestamps(timestamps);
      restarts[id] = [...timestamps];
    }
    return {
      strategy: this._strategy,
      maxRestarts: this._maxRestarts,
      withinSeconds: this._withinMs / 1000,
      restarts,
    };
  }

  /**
   * Remove timestamps outside the current window (mutates array in place).
   * @private
   * @param {number[]} timestamps
   */
  _pruneTimestamps(timestamps) {
    const cutoff = Date.now() - this._withinMs;
    let i = 0;
    while (i < timestamps.length) {
      if (timestamps[i] <= cutoff) {
        timestamps.splice(i, 1);
      } else {
        i++;
      }
    }
  }
}

/**
 * Error type definitions with retryable flag and recommended action.
 * @typedef {{ type: string, retryable: boolean, action: string }} ClassifiedError
 */

/**
 * Parse a STATUS: ERROR line and classify it into a typed error
 * with retry eligibility and recommended action.
 *
 * @param {string} errorText - Raw error text from a terminal
 * @returns {ClassifiedError} Classified error with type, retryable, and action
 */
function classifyError(errorText) {
  if (typeof errorText !== 'string') {
    return { type: 'TOOL_FAIL', retryable: true, action: 'retry' };
  }

  const lower = errorText.toLowerCase();

  // Context full / compaction needed
  if (
    (lower.includes('context') && lower.includes('full')) ||
    lower.includes('compac')
  ) {
    return { type: 'CONTEXT_FULL', retryable: false, action: 'restart' };
  }

  // Dependency / waiting for another task
  if (
    lower.includes('need:') ||
    lower.includes('dependency') ||
    lower.includes('waiting for')
  ) {
    return { type: 'DEPENDENCY', retryable: false, action: 'route' };
  }

  // Rate limiting
  if (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('too many requests')
  ) {
    return { type: 'RATE_LIMIT', retryable: true, action: 'wait' };
  }

  // Timeout
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { type: 'TIMEOUT', retryable: true, action: 'retry' };
  }

  // Stuck / loop
  if (
    lower.includes('stuck') ||
    lower.includes('loop') ||
    lower.includes('same output')
  ) {
    return { type: 'STUCK', retryable: false, action: 'escalate' };
  }

  // Validation errors
  if (
    lower.includes('validation') ||
    (lower.includes('expected') && lower.includes('actual'))
  ) {
    return { type: 'VALIDATION', retryable: true, action: 'retry' };
  }

  // Crash / process exit
  if (
    lower.includes('crash') ||
    lower.includes('exit') ||
    lower.includes('sigterm') ||
    lower.includes('sigkill')
  ) {
    return { type: 'CRASH', retryable: false, action: 'restart' };
  }

  // Default: assume tool failure, retryable
  return { type: 'TOOL_FAIL', retryable: true, action: 'retry' };
}

module.exports = {
  CircuitBreaker,
  RetryBudget,
  Supervisor,
  classifyError,
};
