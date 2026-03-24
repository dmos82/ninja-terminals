'use strict';

/**
 * Server-Sent Events manager.
 * Maintains a set of connected Express response objects and broadcasts
 * named events to all of them.
 */
class SSEManager {
  constructor() {
    /** @type {Set<import('http').ServerResponse>} */
    this._clients = new Set();
    /** @type {NodeJS.Timeout|null} */
    this._heartbeatTimer = null;
  }

  /**
   * Register an Express response as an SSE client.
   * Sets the required headers, sends an initial keepalive comment,
   * and automatically removes the client on connection close.
   *
   * @param {import('http').ServerResponse} res - Express response object
   */
  addClient(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering if proxied
    });
    res.write(':ok\n\n');

    this._clients.add(res);

    res.on('close', () => {
      this._clients.delete(res);
    });
  }

  /**
   * Explicitly remove an SSE client.
   * @param {import('http').ServerResponse} res
   */
  removeClient(res) {
    this._clients.delete(res);
  }

  /**
   * Broadcast a named event with JSON data to every connected client.
   * Silently drops clients whose connections have ended.
   *
   * @param {string} eventName - SSE event name
   * @param {*}      data      - Payload (will be JSON-stringified)
   */
  broadcast(eventName, data) {
    const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this._clients) {
      if (client.writableEnded) {
        this._clients.delete(client);
        continue;
      }
      client.write(frame);
    }
  }

  /**
   * Start sending periodic heartbeat comments to keep connections alive.
   * @param {number} [intervalMs=15000] - Heartbeat interval in milliseconds
   */
  startHeartbeat(intervalMs = 15000) {
    this.stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      for (const client of this._clients) {
        if (client.writableEnded) {
          this._clients.delete(client);
          continue;
        }
        client.write(': heartbeat\n\n');
      }
    }, intervalMs);
    // Allow the process to exit even if the timer is running
    if (this._heartbeatTimer.unref) {
      this._heartbeatTimer.unref();
    }
  }

  /** Stop the heartbeat timer. */
  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Number of currently connected SSE clients.
   * @returns {number}
   */
  get clientCount() {
    return this._clients.size;
  }
}

module.exports = { SSEManager };
