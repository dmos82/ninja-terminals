'use strict';

/**
 * Circular buffer of ANSI-stripped text lines.
 * Overwrites oldest entries when capacity is reached.
 */
class LineBuffer {
  /**
   * @param {number} [maxLines=1000] - Maximum number of lines to retain
   */
  constructor(maxLines = 1000) {
    this._maxLines = maxLines;
    this._buf = new Array(maxLines);
    this._head = 0;   // next write position
    this._count = 0;  // total lines stored (capped at maxLines)
  }

  /**
   * Append a single line to the buffer. Overwrites the oldest line when full.
   * @param {string} line
   */
  push(line) {
    this._buf[this._head] = line;
    this._head = (this._head + 1) % this._maxLines;
    if (this._count < this._maxLines) this._count++;
  }

  /**
   * Return the last n lines (most recent first order is NOT used;
   * lines are returned in chronological order, oldest-to-newest).
   * @param {number} n - Number of recent lines to retrieve
   * @returns {string[]}
   */
  last(n) {
    const count = Math.min(n, this._count);
    if (count === 0) return [];
    const result = new Array(count);
    // start = position of the (count)-th line from the end
    const start = (this._head - count + this._maxLines) % this._maxLines;
    for (let i = 0; i < count; i++) {
      result[i] = this._buf[(start + i) % this._maxLines];
    }
    return result;
  }

  /**
   * Return a window of lines from the buffer.
   * @param {number} offset - Number of lines from the end to start (0 = most recent)
   * @param {number} limit  - Maximum number of lines to return
   * @returns {{ lines: string[], total: number, truncated: boolean }}
   */
  slice(offset, limit) {
    const total = this._count;
    if (total === 0 || offset >= total) {
      return { lines: [], total, truncated: false };
    }
    // offset 0 means "start from the newest line going backwards"
    // We want to return `limit` lines ending at `total - offset`
    const end = total - offset;           // exclusive upper bound (in logical order)
    const start = Math.max(0, end - limit); // inclusive lower bound
    const count = end - start;

    const result = new Array(count);
    const bufStart = (this._head - total + start + this._maxLines) % this._maxLines;
    for (let i = 0; i < count; i++) {
      result[i] = this._buf[(bufStart + i) % this._maxLines];
    }
    return {
      lines: result,
      total,
      truncated: end < total,
    };
  }

  /** Remove all stored lines. */
  clear() {
    this._head = 0;
    this._count = 0;
  }

  /** @returns {number} Number of lines currently stored */
  get length() {
    return this._count;
  }
}

/**
 * Circular byte buffer that retains raw PTY output (ANSI codes intact).
 * Trims from the front when the maximum size is exceeded.
 */
class RawBuffer {
  /**
   * @param {number} [maxBytes=65536] - Maximum buffer size in bytes
   */
  constructor(maxBytes = 65536) {
    this._maxBytes = maxBytes;
    this._data = '';
  }

  /**
   * Append string data to the buffer, trimming from the front if needed.
   * @param {string} data - Raw PTY output
   */
  push(data) {
    this._data += data;
    if (this._data.length > this._maxBytes) {
      this._data = this._data.slice(this._data.length - this._maxBytes);
    }
  }

  /**
   * Return the full buffer contents as a string.
   * @returns {string}
   */
  getAll() {
    return this._data;
  }

  /** Clear the buffer. */
  clear() {
    this._data = '';
  }
}

module.exports = { LineBuffer, RawBuffer };
