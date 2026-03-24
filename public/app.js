/* Ninja Terminal v2 — Frontend */

const WS_BASE = `ws://${location.host}`;
const API_BASE = '';

// ── State ────────────────────────────────────────────────────

const state = {
  terminals: new Map(),   // id -> { id, label, status, progress, elapsed, term, ws, fitAddon, paneEl, ... }
  maximizedId: null,
  activeId: null,
  terminalIndex: new Map(), // id -> index (0-3) for feed coloring
  nextIndex: 0,
};

// ── DOM Refs ─────────────────────────────────────────────────

const grid = document.getElementById('grid');
const sidebar = document.getElementById('sidebar');
const activityFeed = document.getElementById('activity-feed');
const taskQueue = document.getElementById('task-queue');
const statusCounts = document.getElementById('status-counts');
const statusProgress = document.getElementById('status-progress');
const addTaskBtn = document.getElementById('add-task-btn');
const sidebarToggle = document.getElementById('sidebar-toggle');

// ── State Color Map ──────────────────────────────────────────

const STATE_ICONS = {
  idle:              '\u25CB',  // circle outline
  working:           '\u25B6',  // play triangle
  done:              '\u2713',  // checkmark
  blocked:           '\u23F8',  // pause
  error:             '\u2717',  // X
  compacting:        '\u21BB',  // rotating arrows
  waiting_approval:  '\u26A0',  // warning
  starting:          '\u25CB',
  exited:            '\u2717',
};

const STATE_LABELS = {
  idle: 'IDLE',
  working: 'WORKING',
  done: 'DONE',
  blocked: 'BLOCKED',
  error: 'ERROR',
  compacting: 'COMPACTING',
  waiting_approval: 'APPROVAL',
  starting: 'STARTING',
  exited: 'EXITED',
};

// ── Utilities ────────────────────────────────────────────────

function timestamp() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function getTerminalFeedClass(id) {
  let idx = state.terminalIndex.get(id);
  if (idx === undefined) {
    idx = state.nextIndex % 4;
    state.terminalIndex.set(id, idx);
    state.nextIndex++;
  }
  return `feed-t${idx + 1}`;
}

// ── Activity Feed ────────────────────────────────────────────

function addFeedEntry(message, terminalId) {
  const entry = document.createElement('div');
  const feedClass = terminalId != null ? getTerminalFeedClass(terminalId) : '';
  entry.className = `feed-entry ${feedClass}`;
  entry.innerHTML = `<span class="feed-time">${timestamp()}</span><span class="feed-msg">${escapeHtml(message)}</span>`;

  // Insert at top (most recent first)
  if (activityFeed.firstChild) {
    activityFeed.insertBefore(entry, activityFeed.firstChild);
  } else {
    activityFeed.appendChild(entry);
  }

  // Cap at 200 entries
  while (activityFeed.children.length > 200) {
    activityFeed.removeChild(activityFeed.lastChild);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Terminal Creation ────────────────────────────────────────

function createTerminalUI(termData) {
  const { id, label, status, elapsed, progress, taskName } = termData;

  // Pane
  const pane = document.createElement('div');
  pane.className = 'terminal-pane';
  pane.id = `pane-${id}`;

  // Header
  const header = document.createElement('div');
  header.className = 'pane-header';

  // Label (editable on double-click)
  const labelEl = document.createElement('span');
  labelEl.className = 'pane-label';
  labelEl.textContent = label || `Terminal ${id.slice(0, 6)}`;
  labelEl.title = 'Double-click to rename';
  labelEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startLabelEdit(id, labelEl);
  });

  // State indicator
  const stateEl = document.createElement('span');
  stateEl.className = 'pane-state';
  const stateIcon = document.createElement('span');
  stateIcon.className = `state-icon ${status || 'idle'}`;
  stateIcon.id = `state-icon-${id}`;
  const stateText = document.createElement('span');
  stateText.className = `state-text ${status || 'idle'}`;
  stateText.id = `state-text-${id}`;
  stateText.textContent = STATE_LABELS[status] || 'IDLE';
  stateEl.appendChild(stateIcon);
  stateEl.appendChild(stateText);

  // Elapsed
  const elapsedEl = document.createElement('span');
  elapsedEl.className = 'pane-elapsed';
  elapsedEl.id = `elapsed-${id}`;
  elapsedEl.textContent = elapsed || '';

  // Spacer
  const spacer = document.createElement('span');
  spacer.className = 'pane-spacer';

  // Action buttons container
  const actionsEl = document.createElement('span');
  actionsEl.className = 'pane-actions';
  actionsEl.id = `actions-${id}`;

  // Progress bar
  const progressTrack = document.createElement('div');
  progressTrack.className = 'progress-bar-track';
  const progressFill = document.createElement('div');
  progressFill.className = `progress-bar-fill ${status || 'idle'}`;
  progressFill.id = `progress-${id}`;
  progressFill.style.width = `${progress || 0}%`;
  progressTrack.appendChild(progressFill);

  header.appendChild(labelEl);
  header.appendChild(stateEl);
  header.appendChild(elapsedEl);
  header.appendChild(spacer);
  header.appendChild(actionsEl);
  header.appendChild(progressTrack);

  // Double-click header to maximize/restore
  header.addEventListener('dblclick', (e) => {
    if (e.target.closest('.pane-label') || e.target.closest('.action-btn')) return;
    toggleMaximize(id);
  });

  // Terminal container
  const container = document.createElement('div');
  container.className = 'terminal-container';
  container.id = `terminal-${id}`;

  pane.appendChild(header);
  pane.appendChild(container);
  grid.appendChild(pane);

  // Click pane to focus
  pane.addEventListener('mousedown', () => {
    setActiveTerminal(id);
  });

  // xterm.js
  const term = new window.Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
    theme: {
      background: '#0a0a0a',
      foreground: '#cccccc',
      cursor: '#cccccc',
      selectionBackground: '#334455',
    },
    scrollback: 5000,
    allowProposedApi: true,
  });

  const fitAddon = new window.FitAddon.FitAddon();
  const webLinksAddon = new window.WebLinksAddon.WebLinksAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.open(container);

  requestAnimationFrame(() => {
    try { fitAddon.fit(); } catch {}
  });

  // WebSocket
  const ws = new WebSocket(`${WS_BASE}/ws/${id}`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };

  ws.onmessage = (event) => {
    const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
    term.write(data);
    // Always scroll to bottom on new output
    term.scrollToBottom();
  };

  ws.onclose = () => {
    term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
  };

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  // Store
  const termState = {
    id,
    label: label || `Terminal ${id.slice(0, 6)}`,
    status: status || 'idle',
    progress: progress || 0,
    elapsed: elapsed || '',
    taskName: taskName || '',
    term,
    ws,
    fitAddon,
    paneEl: pane,
    labelEl,
  };
  state.terminals.set(id, termState);

  // Assign feed index
  getTerminalFeedClass(id);

  // Set initial action buttons
  updateActionButtons(id, termState.status);

  // Set as active
  setActiveTerminal(id);

  addFeedEntry(`Terminal created: ${termState.label}`, id);

  return termState;
}

// ── Label Editing ────────────────────────────────────────────

function startLabelEdit(id, labelEl) {
  const t = state.terminals.get(id);
  if (!t) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pane-label editing';
  input.value = t.label;
  input.style.width = `${Math.max(80, labelEl.offsetWidth + 20)}px`;

  labelEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const newLabel = input.value.trim() || t.label;
    t.label = newLabel;

    const newLabelEl = document.createElement('span');
    newLabelEl.className = 'pane-label';
    newLabelEl.textContent = newLabel;
    newLabelEl.title = 'Double-click to rename';
    newLabelEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startLabelEdit(id, newLabelEl);
    });

    input.replaceWith(newLabelEl);
    t.labelEl = newLabelEl;

    // Persist to server
    fetch(`${API_BASE}/api/terminals/${id}/label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel }),
    }).catch(() => {});
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = t.label; input.blur(); }
  });
}

// ── Action Buttons ───────────────────────────────────────────

function updateActionButtons(id, status) {
  const actionsEl = document.getElementById(`actions-${id}`);
  if (!actionsEl) return;
  actionsEl.innerHTML = '';

  const buttons = [];

  switch (status) {
    case 'working':
    case 'starting':
      buttons.push({ label: 'Pause', action: () => pauseTerminal(id) });
      buttons.push({ label: 'Kill', action: () => killTerminal(id), danger: true });
      break;
    case 'done':
      buttons.push({ label: 'Clear', action: () => clearTerminal(id) });
      buttons.push({ label: 'New', action: () => restartTerminal(id) });
      break;
    case 'blocked':
    case 'waiting_approval':
      buttons.push({ label: 'Unblock', action: () => restartTerminal(id) });
      buttons.push({ label: 'Kill', action: () => killTerminal(id), danger: true });
      break;
    case 'error':
    case 'exited':
      buttons.push({ label: 'Retry', action: () => restartTerminal(id) });
      buttons.push({ label: 'Kill', action: () => killTerminal(id), danger: true });
      break;
    case 'compacting':
      buttons.push({ label: 'Kill', action: () => killTerminal(id), danger: true });
      break;
    case 'idle':
    default:
      buttons.push({ label: 'Kill', action: () => killTerminal(id), danger: true });
      break;
  }

  for (const btn of buttons) {
    const el = document.createElement('button');
    el.className = `action-btn${btn.danger ? ' danger' : ''}`;
    el.textContent = btn.label;
    // mousedown + preventDefault to avoid stealing focus from terminal
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.action();
    });
    actionsEl.appendChild(el);
  }
}

// ── Terminal Actions ─────────────────────────────────────────

function setActiveTerminal(id) {
  state.activeId = id;
  for (const [tid, terminal] of state.terminals) {
    terminal.paneEl.classList.toggle('active', tid === id);
  }
  const t = state.terminals.get(id);
  if (t) t.term.focus();
}

function toggleMaximize(id) {
  const t = state.terminals.get(id);
  if (!t) return;

  if (state.maximizedId === id) {
    // Restore
    t.paneEl.classList.remove('maximized');
    state.maximizedId = null;
    for (const [, terminal] of state.terminals) {
      terminal.paneEl.classList.remove('hidden');
    }
  } else {
    // Maximize
    if (state.maximizedId) {
      const prev = state.terminals.get(state.maximizedId);
      if (prev) prev.paneEl.classList.remove('maximized');
    }
    for (const [tid, terminal] of state.terminals) {
      if (tid !== id) terminal.paneEl.classList.add('hidden');
      else terminal.paneEl.classList.remove('hidden');
    }
    t.paneEl.classList.add('maximized');
    state.maximizedId = id;
  }

  requestAnimationFrame(() => fitAll());
}

async function closeTerminal(id) {
  const t = state.terminals.get(id);
  if (!t) return;

  try {
    await fetch(`${API_BASE}/api/terminals/${id}`, { method: 'DELETE' });
  } catch {}

  t.ws.close();
  t.term.dispose();
  t.paneEl.remove();
  state.terminals.delete(id);

  if (state.maximizedId === id) {
    state.maximizedId = null;
    for (const [, terminal] of state.terminals) {
      terminal.paneEl.classList.remove('hidden');
    }
  }

  addFeedEntry(`Terminal closed: ${t.label}`, id);
  updateStatusBar();
  requestAnimationFrame(() => fitAll());
}

async function killTerminal(id) {
  try {
    await fetch(`${API_BASE}/api/terminals/${id}/kill`, { method: 'POST' });
    addFeedEntry(`Kill sent to terminal`, id);
  } catch (err) {
    console.error('Kill failed:', err);
  }
}

async function pauseTerminal(id) {
  // Send escape sequence (Ctrl+C)
  try {
    await fetch(`${API_BASE}/api/terminals/${id}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '\x1b' }),
    });
    addFeedEntry(`Escape sent to terminal`, id);
  } catch (err) {
    console.error('Pause failed:', err);
  }
}

async function restartTerminal(id) {
  try {
    await fetch(`${API_BASE}/api/terminals/${id}/restart`, { method: 'POST' });
    addFeedEntry(`Restart requested`, id);
  } catch (err) {
    console.error('Restart failed:', err);
  }
}

function clearTerminal(id) {
  const t = state.terminals.get(id);
  if (t) {
    t.term.clear();
    addFeedEntry(`Terminal cleared`, id);
  }
}

async function addNewTerminal() {
  try {
    const res = await fetch(`${API_BASE}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    createTerminalUI(data);
    requestAnimationFrame(() => fitAll());
  } catch (err) {
    console.error('Failed to create terminal:', err);
  }
}

// ── Fit All Terminals ────────────────────────────────────────

function fitAll() {
  for (const [, t] of state.terminals) {
    if (!t.paneEl.classList.contains('hidden')) {
      try { t.fitAddon.fit(); } catch {}
    }
  }
}

// ── Status Updates ───────────────────────────────────────────

function updateTerminalState(id, newStatus, extra) {
  const t = state.terminals.get(id);
  if (!t) return;

  const oldStatus = t.status;
  t.status = newStatus;

  if (extra) {
    if (extra.elapsed !== undefined) t.elapsed = extra.elapsed;
    if (extra.progress !== undefined) t.progress = extra.progress;
    if (extra.label !== undefined) {
      t.label = extra.label;
      if (t.labelEl) t.labelEl.textContent = extra.label;
    }
    if (extra.taskName !== undefined) t.taskName = extra.taskName;
  }

  // Update state icon
  const stateIcon = document.getElementById(`state-icon-${id}`);
  if (stateIcon) stateIcon.className = `state-icon ${newStatus}`;

  // Update state text
  const stateText = document.getElementById(`state-text-${id}`);
  if (stateText) {
    stateText.className = `state-text ${newStatus}`;
    stateText.textContent = STATE_LABELS[newStatus] || newStatus.toUpperCase();
  }

  // Update elapsed
  const elapsedEl = document.getElementById(`elapsed-${id}`);
  if (elapsedEl) elapsedEl.textContent = t.elapsed;

  // Update progress bar
  const progressFill = document.getElementById(`progress-${id}`);
  if (progressFill) {
    progressFill.className = `progress-bar-fill ${newStatus}`;
    progressFill.style.width = `${t.progress}%`;
  }

  // Update pane border state classes
  t.paneEl.classList.remove('state-error', 'state-blocked', 'state-done', 'flash');

  if (newStatus === 'error' || newStatus === 'exited') {
    t.paneEl.classList.add('state-error');
  } else if (newStatus === 'blocked' || newStatus === 'waiting_approval') {
    t.paneEl.classList.add('state-blocked');
  }

  // Done flash animation (one-shot)
  if (newStatus === 'done' && oldStatus !== 'done') {
    t.paneEl.classList.add('state-done', 'flash');
    t.paneEl.addEventListener('animationend', () => {
      t.paneEl.classList.remove('flash');
    }, { once: true });
  }

  // Update action buttons
  updateActionButtons(id, newStatus);

  // Update status bar
  updateStatusBar();

  // Desktop notification for done/error when tab not focused
  if ((newStatus === 'done' || newStatus === 'error') && oldStatus !== newStatus && !document.hasFocus()) {
    fireNotification(t.label, newStatus);
  }
}

function updateProgress(id, progress) {
  const t = state.terminals.get(id);
  if (!t) return;

  t.progress = progress;

  const progressFill = document.getElementById(`progress-${id}`);
  if (progressFill) {
    progressFill.style.width = `${progress}%`;
  }

  updateStatusBar();
}

function updateStatusBar() {
  const counts = {};
  let totalProgress = 0;
  let termCount = 0;

  for (const [, t] of state.terminals) {
    const s = t.status || 'idle';
    counts[s] = (counts[s] || 0) + 1;
    totalProgress += t.progress || 0;
    termCount++;
  }

  // Render counts
  const order = ['working', 'done', 'blocked', 'error', 'waiting_approval', 'compacting', 'idle'];
  const parts = [];
  for (const s of order) {
    if (counts[s]) {
      parts.push(`<span class="status-count"><span class="status-dot ${s}"></span>${counts[s]} ${STATE_LABELS[s] ? STATE_LABELS[s].toLowerCase() : s}</span>`);
    }
  }
  statusCounts.innerHTML = parts.join('');

  // Overall progress
  const overall = termCount > 0 ? Math.round(totalProgress / termCount) : 0;
  statusProgress.textContent = `Overall: ${overall}%`;
}

// ── Desktop Notifications ────────────────────────────────────

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function fireNotification(label, status) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const icon = status === 'done' ? '\u2713' : '\u2717';
    new Notification(`Ninja Terminal: ${label}`, {
      body: `${icon} Terminal is ${status.toUpperCase()}`,
      tag: `ninja-${label}-${status}`,
    });
  }
}

// ── SSE Connection ───────────────────────────────────────────

function connectSSE() {
  const evtSource = new EventSource(`${API_BASE}/api/events`);

  evtSource.addEventListener('status_change', (e) => {
    try {
      const data = JSON.parse(e.data);
      const { terminalId, status, elapsed, progress, label, taskName } = data;
      updateTerminalState(terminalId, status, { elapsed, progress, label, taskName });

      const t = state.terminals.get(terminalId);
      const name = t ? t.label : terminalId;
      addFeedEntry(`${name} -> ${STATE_LABELS[status] || status}`, terminalId);
    } catch {}
  });

  evtSource.addEventListener('progress', (e) => {
    try {
      const data = JSON.parse(e.data);
      const { terminalId, progress } = data;
      updateProgress(terminalId, progress);
    } catch {}
  });

  evtSource.addEventListener('permission_request', (e) => {
    try {
      const data = JSON.parse(e.data);
      const { terminalId, message } = data;
      const t = state.terminals.get(terminalId);
      const name = t ? t.label : terminalId;
      addFeedEntry(`[APPROVAL] ${name}: ${message || 'Permission requested'}`, terminalId);
    } catch {}
  });

  evtSource.addEventListener('error', (e) => {
    try {
      const data = JSON.parse(e.data);
      const { terminalId, message } = data;
      const t = state.terminals.get(terminalId);
      const name = t ? t.label : terminalId;
      addFeedEntry(`[ERROR] ${name}: ${message || 'Unknown error'}`, terminalId);
    } catch {}
  });

  evtSource.addEventListener('compacted', (e) => {
    try {
      const data = JSON.parse(e.data);
      const { terminalId } = data;
      const t = state.terminals.get(terminalId);
      const name = t ? t.label : terminalId;
      addFeedEntry(`${name}: Context compacted`, terminalId);
    } catch {}
  });

  evtSource.addEventListener('context_low', (e) => {
    try {
      const data = JSON.parse(e.data);
      const { terminalId, contextPct } = data;
      const t = state.terminals.get(terminalId);
      const name = t ? t.label : terminalId;
      addFeedEntry(`[WARN] ${name}: Context low (${contextPct}%)`, terminalId);
    } catch {}
  });

  evtSource.onerror = () => {
    // EventSource will auto-reconnect
  };

  return evtSource;
}

// ── Task Queue ───────────────────────────────────────────────

async function fetchTasks() {
  try {
    const res = await fetch(`${API_BASE}/api/tasks`);
    if (!res.ok) {
      taskQueue.innerHTML = '<div class="no-tasks">No tasks</div>';
      return;
    }
    const tasks = await res.json();
    renderTasks(tasks);
  } catch {
    taskQueue.innerHTML = '<div class="no-tasks">No tasks</div>';
  }
}

function renderTasks(tasks) {
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    taskQueue.innerHTML = '<div class="no-tasks">No tasks</div>';
    return;
  }

  taskQueue.innerHTML = '';
  for (const task of tasks) {
    const item = document.createElement('div');
    item.className = 'task-item';
    const dotClass = task.status || 'pending';
    item.innerHTML = `
      <span class="task-dot ${dotClass}"></span>
      <span class="task-name" title="${escapeHtml(task.name || task.id || '')}">${escapeHtml(task.name || task.id || 'Unnamed')}</span>
      <span class="task-status">${escapeHtml(task.status || 'pending')}</span>
    `;
    taskQueue.appendChild(item);
  }
}

// ── Status Polling (fallback + elapsed updates) ──────────────

async function pollStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/terminals`);
    const list = await res.json();

    for (const item of list) {
      const t = state.terminals.get(item.id);
      if (!t) {
        // Terminal exists on server but not in UI — create it
        createTerminalUI(item);
        continue;
      }

      // Update elapsed time (SSE might not send this continuously)
      if (item.elapsed !== undefined) {
        t.elapsed = item.elapsed;
        const elapsedEl = document.getElementById(`elapsed-${item.id}`);
        if (elapsedEl) elapsedEl.textContent = item.elapsed;
      }

      // Update progress if present
      if (item.progress !== undefined && item.progress !== t.progress) {
        updateProgress(item.id, item.progress);
      }

      // Update status if changed (SSE is primary, this is fallback)
      if (item.status && item.status !== t.status) {
        updateTerminalState(item.id, item.status, {
          elapsed: item.elapsed,
          progress: item.progress,
          label: item.label,
          taskName: item.taskName,
        });
      }
    }

    // Check for removed terminals
    for (const [id] of state.terminals) {
      if (!list.find((item) => item.id === id)) {
        closeTerminal(id);
      }
    }

    updateStatusBar();
  } catch {}
}

// ── Sidebar Toggle ───────────────────────────────────────────

function setupSidebar() {
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    requestAnimationFrame(() => fitAll());
  });

  // Mobile: create overlay toggle
  const mobileToggle = document.createElement('button');
  mobileToggle.className = 'mobile-toggle';
  mobileToggle.innerHTML = '&#9776;';
  mobileToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    sidebar.classList.remove('collapsed');
  });
  document.body.appendChild(mobileToggle);
}

// ── Add Task ─────────────────────────────────────────────────

function setupAddTask() {
  addTaskBtn.addEventListener('click', () => {
    addNewTerminal();
  });
}

// ── Resize Handler ───────────────────────────────────────────

let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => fitAll(), 100);
});

// ── Initialize ───────────────────────────────────────────────

async function init() {
  // Request desktop notification permission
  requestNotificationPermission();

  // Setup sidebar
  setupSidebar();
  setupAddTask();

  // Load existing terminals
  try {
    const res = await fetch(`${API_BASE}/api/terminals`);
    const list = await res.json();
    for (const item of list) {
      createTerminalUI(item);
    }
  } catch (err) {
    console.error('Failed to load terminals:', err);
  }

  // Initial fit after all terminals loaded
  setTimeout(() => fitAll(), 300);

  // Connect SSE for real-time updates
  connectSSE();

  // Fetch initial task queue
  fetchTasks();

  // Poll status every 3 seconds (fallback for SSE + elapsed updates)
  setInterval(pollStatus, 3000);

  // Poll task queue every 5 seconds
  setInterval(fetchTasks, 5000);

  // Initial status bar
  updateStatusBar();

  addFeedEntry('Ninja Terminal v2 started');
}

init();
