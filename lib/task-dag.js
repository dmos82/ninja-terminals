'use strict';

/**
 * Default timeout configuration for tasks (milliseconds).
 */
const DEFAULT_TIMEOUT = {
  scheduleToStart: 60000,
  startToClose: 1800000,
  heartbeat: 120000,
  scheduleToClose: 2700000,
};

/**
 * Default retry policy for tasks.
 */
const DEFAULT_RETRY_POLICY = {
  maxAttempts: 2,
  backoff: 'exponential',
  initialDelay: 10000,
  nonRetryableErrors: ['ERROR:CONTEXT_FULL', 'ERROR:STUCK'],
};

/**
 * Runs Kahn's algorithm on a set of tasks to produce a topological ordering
 * and detect any deadlocked (cyclic) tasks.
 *
 * @param {Map<string, object>} taskMap - Map of taskId -> task object
 * @returns {{ order: object[], deadlocked: object[] }}
 */
function topologicalSort(taskMap) {
  const inDegree = new Map();
  const dependents = new Map(); // taskId -> [taskIds that depend on it]

  for (const [id] of taskMap) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }

  for (const [id, task] of taskMap) {
    for (const dep of task.dependencies) {
      if (taskMap.has(dep)) {
        inDegree.set(id, inDegree.get(id) + 1);
        dependents.get(dep).push(id);
      }
    }
  }

  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order = [];
  while (queue.length > 0) {
    const current = queue.shift();
    order.push(taskMap.get(current));
    for (const dependent of dependents.get(current)) {
      const newDeg = inDegree.get(dependent) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  const orderedIds = new Set(order.map((t) => t.id));
  const deadlocked = [];
  for (const [id, task] of taskMap) {
    if (!orderedIds.has(id)) deadlocked.push(task);
  }

  return { order, deadlocked };
}

/**
 * Checks whether adding a dependency edge (taskId depends on dependsOnId)
 * would create a cycle. A cycle exists if dependsOnId already transitively
 * depends on taskId. We check by DFS from dependsOnId following forward
 * dependency edges (task.dependencies) to see if taskId is reachable.
 *
 * @param {Map<string, object>} taskMap
 * @param {string} taskId - The task that would gain a new dependency
 * @param {string} dependsOnId - The task it would depend on
 * @returns {boolean} true if a cycle would be created
 */
function wouldCreateCycle(taskMap, taskId, dependsOnId) {
  // If taskId === dependsOnId, self-loop
  if (taskId === dependsOnId) return true;

  // DFS from dependsOnId following its dependency chain (forward edges).
  // If we reach taskId, adding the edge would create a cycle.
  const visited = new Set();
  const stack = [dependsOnId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const task = taskMap.get(current);
    if (task) {
      for (const dep of task.dependencies) {
        if (!visited.has(dep)) {
          stack.push(dep);
        }
      }
    }
  }
  return false;
}

/**
 * Directed Acyclic Graph manager for task dependencies.
 * Tracks tasks, their statuses, dependency relationships, and provides
 * scheduling-ready queries like getReadyTasks and deadlock detection.
 */
class TaskDAG {
  constructor() {
    /** @type {Map<string, object>} */
    this._tasks = new Map();
  }

  /**
   * Create a task from a config object and add it to the graph.
   * Fills in defaults for timeout, retryPolicy, and other fields.
   * Throws if the task ID already exists or if adding it would create a cycle.
   *
   * @param {object} taskConfig - Task configuration
   * @param {string} taskConfig.id - Unique task identifier
   * @param {string} taskConfig.name - Human-readable task name
   * @param {string} [taskConfig.description=''] - Full description
   * @param {string[]} [taskConfig.dependencies=[]] - IDs of prerequisite tasks
   * @param {string[]} [taskConfig.scope=[]] - File paths this task owns
   * @param {string} [taskConfig.expectedOutput=''] - What completion looks like
   * @param {object} [taskConfig.timeout] - Timeout overrides
   * @param {object} [taskConfig.retryPolicy] - Retry policy overrides
   * @returns {object} The created task
   * @throws {Error} If id is missing, already exists, or would create a cycle
   */
  addTask(taskConfig) {
    if (!taskConfig || typeof taskConfig !== 'object') {
      throw new Error('taskConfig must be a non-null object');
    }
    if (!taskConfig.id || typeof taskConfig.id !== 'string') {
      throw new Error('Task must have a string id');
    }
    if (!taskConfig.name || typeof taskConfig.name !== 'string') {
      throw new Error('Task must have a string name');
    }
    if (this._tasks.has(taskConfig.id)) {
      throw new Error(`Task "${taskConfig.id}" already exists`);
    }

    const dependencies = Array.isArray(taskConfig.dependencies)
      ? [...taskConfig.dependencies]
      : [];

    // Validate that all dependencies reference existing tasks
    for (const dep of dependencies) {
      if (!this._tasks.has(dep)) {
        throw new Error(
          `Dependency "${dep}" does not exist in the graph`
        );
      }
    }

    const task = {
      id: taskConfig.id,
      name: taskConfig.name,
      description: taskConfig.description || '',
      dependencies,
      assignedTerminal: taskConfig.assignedTerminal || null,
      status: 'pending',
      scope: Array.isArray(taskConfig.scope) ? [...taskConfig.scope] : [],
      expectedOutput: taskConfig.expectedOutput || '',
      timeout: { ...DEFAULT_TIMEOUT, ...(taskConfig.timeout || {}) },
      retryPolicy: {
        ...DEFAULT_RETRY_POLICY,
        nonRetryableErrors: [
          ...(taskConfig.retryPolicy?.nonRetryableErrors ||
            DEFAULT_RETRY_POLICY.nonRetryableErrors),
        ],
        ...(taskConfig.retryPolicy || {}),
        // Re-apply nonRetryableErrors since spread above would overwrite
      },
      attempt: 0,
      checkpoints: [],
      artifacts: [],
      startedAt: null,
      completedAt: null,
      error: null,
    };

    // Fix retryPolicy: ensure nonRetryableErrors is always an array from config or default
    task.retryPolicy.nonRetryableErrors = Array.isArray(
      taskConfig.retryPolicy?.nonRetryableErrors
    )
      ? [...taskConfig.retryPolicy.nonRetryableErrors]
      : [...DEFAULT_RETRY_POLICY.nonRetryableErrors];

    // Check for cycles: temporarily add the task and run topological sort
    this._tasks.set(task.id, task);
    const { deadlocked } = topologicalSort(this._tasks);
    if (deadlocked.length > 0) {
      this._tasks.delete(task.id);
      throw new Error(
        `Adding task "${task.id}" would create a cycle involving: ${deadlocked.map((t) => t.id).join(', ')}`
      );
    }

    return task;
  }

  /**
   * Remove a task from the graph.
   * Throws if the task doesn't exist or other tasks depend on it.
   *
   * @param {string} id - Task ID to remove
   * @throws {Error} If task not found or has dependents
   */
  removeTask(id) {
    if (typeof id !== 'string') {
      throw new Error('Task id must be a string');
    }
    if (!this._tasks.has(id)) {
      throw new Error(`Task "${id}" not found`);
    }

    // Check if any other task depends on this one
    for (const [otherId, task] of this._tasks) {
      if (otherId !== id && task.dependencies.includes(id)) {
        throw new Error(
          `Cannot remove task "${id}": task "${otherId}" depends on it`
        );
      }
    }

    this._tasks.delete(id);
  }

  /**
   * Get a task by ID.
   *
   * @param {string} id - Task ID
   * @returns {object|null} The task object or null if not found
   */
  getTask(id) {
    return this._tasks.get(id) || null;
  }

  /**
   * Get all tasks as an array.
   *
   * @returns {object[]} Array of all task objects
   */
  getAllTasks() {
    return Array.from(this._tasks.values());
  }

  /**
   * Get tasks that are ready to execute: status is 'pending' and all
   * dependencies are in 'done' status.
   *
   * @returns {object[]} Array of ready task objects
   */
  getReadyTasks() {
    const ready = [];
    for (const task of this._tasks.values()) {
      if (task.status !== 'pending') continue;
      const allDepsDone = task.dependencies.every((depId) => {
        const dep = this._tasks.get(depId);
        return dep && dep.status === 'done';
      });
      if (allDepsDone) ready.push(task);
    }
    return ready;
  }

  /**
   * Get tasks that are currently running.
   *
   * @returns {object[]} Array of running task objects
   */
  getRunningTasks() {
    return this.getAllTasks().filter((t) => t.status === 'running');
  }

  /**
   * Mark a task as queued and assign it to a terminal.
   *
   * @param {string} id - Task ID
   * @param {number} terminalId - Terminal ID to assign
   * @throws {Error} If task not found or not in 'pending' status
   */
  markQueued(id, terminalId) {
    const task = this._requireTask(id);
    if (task.status !== 'pending') {
      throw new Error(
        `Cannot queue task "${id}": status is "${task.status}", expected "pending"`
      );
    }
    if (typeof terminalId !== 'number') {
      throw new Error('terminalId must be a number');
    }
    task.status = 'queued';
    task.assignedTerminal = terminalId;
  }

  /**
   * Mark a task as running and set its startedAt timestamp.
   *
   * @param {string} id - Task ID
   * @throws {Error} If task not found or not in 'queued' status
   */
  markRunning(id) {
    const task = this._requireTask(id);
    if (task.status !== 'queued') {
      throw new Error(
        `Cannot start task "${id}": status is "${task.status}", expected "queued"`
      );
    }
    task.status = 'running';
    task.startedAt = Date.now();
  }

  /**
   * Mark a task as completed, store artifacts, and set completedAt.
   *
   * @param {string} id - Task ID
   * @param {Array} [artifacts=[]] - Outputs produced by the task
   * @throws {Error} If task not found or not in 'running' status
   */
  markCompleted(id, artifacts) {
    const task = this._requireTask(id);
    if (task.status !== 'running') {
      throw new Error(
        `Cannot complete task "${id}": status is "${task.status}", expected "running"`
      );
    }
    task.status = 'done';
    task.completedAt = Date.now();
    task.artifacts = Array.isArray(artifacts) ? [...artifacts] : [];
    task.error = null;
  }

  /**
   * Mark a task as failed. Increments attempt count.
   * If attempts remain and the error is retryable, resets to 'pending' for retry.
   *
   * @param {string} id - Task ID
   * @param {string} errorMsg - Error description
   * @throws {Error} If task not found or not in a running/queued state
   */
  markFailed(id, errorMsg) {
    const task = this._requireTask(id);
    if (task.status !== 'running' && task.status !== 'queued') {
      throw new Error(
        `Cannot fail task "${id}": status is "${task.status}", expected "running" or "queued"`
      );
    }

    task.attempt += 1;
    task.error = errorMsg || 'Unknown error';
    task.completedAt = Date.now();

    // Check if retryable
    const isNonRetryable = task.retryPolicy.nonRetryableErrors.some(
      (pattern) => errorMsg && errorMsg.includes(pattern)
    );
    const hasAttemptsLeft = task.attempt < task.retryPolicy.maxAttempts;

    if (!isNonRetryable && hasAttemptsLeft) {
      // Reset for retry
      task.status = 'pending';
      task.assignedTerminal = null;
      task.startedAt = null;
      task.completedAt = null;
    } else {
      task.status = 'failed';
    }
  }

  /**
   * Add a checkpoint snapshot to a task.
   *
   * @param {string} id - Task ID
   * @param {string} summary - Checkpoint summary text
   * @throws {Error} If task not found
   */
  addCheckpoint(id, summary) {
    const task = this._requireTask(id);
    if (typeof summary !== 'string' || summary.length === 0) {
      throw new Error('Checkpoint summary must be a non-empty string');
    }
    task.checkpoints.push({ ts: Date.now(), summary });
  }

  /**
   * Add a dynamic dependency edge between two tasks.
   * Validates both tasks exist and that the new edge won't create a cycle.
   *
   * @param {string} taskId - The task that will gain a dependency
   * @param {string} dependsOnId - The task it will depend on
   * @throws {Error} If either task not found, dependency already exists, or would create a cycle
   */
  addDependency(taskId, dependsOnId) {
    this._requireTask(taskId);
    this._requireTask(dependsOnId);

    const task = this._tasks.get(taskId);
    if (task.dependencies.includes(dependsOnId)) {
      throw new Error(
        `Task "${taskId}" already depends on "${dependsOnId}"`
      );
    }

    // Check for cycles before adding
    if (wouldCreateCycle(this._tasks, taskId, dependsOnId)) {
      throw new Error(
        `Adding dependency "${taskId}" -> "${dependsOnId}" would create a cycle`
      );
    }

    task.dependencies.push(dependsOnId);
  }

  /**
   * Run Kahn's algorithm to check for deadlocks in the graph.
   * Only considers non-terminal tasks (not 'done' or 'failed').
   *
   * @returns {{ deadlock: boolean, tasks?: object[] }}
   */
  checkDeadlock() {
    // Build a subgraph of active (non-terminal) tasks
    const activeMap = new Map();
    for (const [id, task] of this._tasks) {
      if (task.status !== 'done' && task.status !== 'failed') {
        activeMap.set(id, task);
      }
    }

    if (activeMap.size === 0) {
      return { deadlock: false };
    }

    const { deadlocked } = topologicalSort(activeMap);
    if (deadlocked.length > 0) {
      return { deadlock: true, tasks: deadlocked };
    }
    return { deadlock: false };
  }

  /**
   * Get progress statistics for the task graph.
   *
   * @returns {{ total: number, pending: number, queued: number, running: number, done: number, failed: number, pct: number }}
   */
  getProgress() {
    const counts = { total: 0, pending: 0, queued: 0, running: 0, done: 0, failed: 0 };
    for (const task of this._tasks.values()) {
      counts.total++;
      counts[task.status]++;
    }
    counts.pct = counts.total === 0 ? 0 : (counts.done / counts.total) * 100;
    return counts;
  }

  /**
   * Serialize the full DAG state to a plain JSON-compatible object.
   *
   * @returns {object}
   */
  toJSON() {
    return {
      tasks: this.getAllTasks().map((t) => ({ ...t })),
    };
  }

  /**
   * Deserialize a DAG from a JSON object produced by toJSON().
   * Restores all tasks and their states without validation constraints
   * (since the data was previously valid).
   *
   * @param {object} json - Serialized DAG
   * @returns {TaskDAG}
   */
  static fromJSON(json) {
    if (!json || !Array.isArray(json.tasks)) {
      throw new Error('Invalid JSON: expected { tasks: [...] }');
    }
    const dag = new TaskDAG();
    // First pass: add all tasks without dependency validation
    // (they reference each other, so we need them all in the map first)
    for (const taskData of json.tasks) {
      const task = {
        id: taskData.id,
        name: taskData.name,
        description: taskData.description || '',
        dependencies: Array.isArray(taskData.dependencies)
          ? [...taskData.dependencies]
          : [],
        assignedTerminal: taskData.assignedTerminal || null,
        status: taskData.status || 'pending',
        scope: Array.isArray(taskData.scope) ? [...taskData.scope] : [],
        expectedOutput: taskData.expectedOutput || '',
        timeout: { ...DEFAULT_TIMEOUT, ...(taskData.timeout || {}) },
        retryPolicy: {
          ...DEFAULT_RETRY_POLICY,
          ...(taskData.retryPolicy || {}),
          nonRetryableErrors: Array.isArray(
            taskData.retryPolicy?.nonRetryableErrors
          )
            ? [...taskData.retryPolicy.nonRetryableErrors]
            : [...DEFAULT_RETRY_POLICY.nonRetryableErrors],
        },
        attempt: taskData.attempt || 0,
        checkpoints: Array.isArray(taskData.checkpoints)
          ? [...taskData.checkpoints]
          : [],
        artifacts: Array.isArray(taskData.artifacts)
          ? [...taskData.artifacts]
          : [],
        startedAt: taskData.startedAt || null,
        completedAt: taskData.completedAt || null,
        error: taskData.error || null,
      };
      dag._tasks.set(task.id, task);
    }
    return dag;
  }

  /**
   * Internal: get a task or throw if not found.
   * @private
   * @param {string} id
   * @returns {object}
   */
  _requireTask(id) {
    if (typeof id !== 'string') {
      throw new Error('Task id must be a string');
    }
    const task = this._tasks.get(id);
    if (!task) {
      throw new Error(`Task "${id}" not found`);
    }
    return task;
  }
}

module.exports = { TaskDAG };
