#!/usr/bin/env node
/**
 * test-mcp.js - Test script for ninja-terminals MCP server
 * Tests all 12 tools with mock data and validates responses
 */

const { spawn } = require('child_process');
const { createInterface } = require('readline');

const SERVER_PATH = './mcp-server.js';

// Define the 12 expected tools and their test cases
const TEST_CASES = [
  {
    name: 'list_terminals',
    method: 'tools/call',
    params: { name: 'list_terminals', arguments: {} },
    validate: (result) => Array.isArray(result?.content) || result?.content?.[0]?.text
  },
  {
    name: 'get_terminal',
    method: 'tools/call',
    params: { name: 'get_terminal', arguments: { terminal_id: 'T1' } },
    validate: (result) => result?.content?.[0]?.text !== undefined
  },
  {
    name: 'send_command',
    method: 'tools/call',
    params: { name: 'send_command', arguments: { terminal_id: 'T1', command: 'echo "test"' } },
    validate: (result) => result?.content?.[0]?.text !== undefined
  },
  {
    name: 'read_output',
    method: 'tools/call',
    params: { name: 'read_output', arguments: { terminal_id: 'T1', lines: 10 } },
    validate: (result) => result?.content?.[0]?.text !== undefined
  },
  {
    name: 'get_status',
    method: 'tools/call',
    params: { name: 'get_status', arguments: { terminal_id: 'T1' } },
    validate: (result) => result?.content?.[0]?.text !== undefined
  },
  {
    name: 'broadcast_command',
    method: 'tools/call',
    params: { name: 'broadcast_command', arguments: { command: 'echo "broadcast test"' } },
    validate: (result) => result?.content?.[0]?.text !== undefined
  },
  {
    name: 'get_all_status',
    method: 'tools/call',
    params: { name: 'get_all_status', arguments: {} },
    validate: (result) => result?.content?.[0]?.text !== undefined
  },
  {
    name: 'wait_for_idle',
    method: 'tools/call',
    params: { name: 'wait_for_idle', arguments: { terminal_id: 'T1', timeout_ms: 1000 } },
    validate: (result) => result?.content?.[0]?.text !== undefined
  },
  {
    name: 'clear_terminal',
    method: 'tools/call',
    params: { name: 'clear_terminal', arguments: { terminal_id: 'T1' } },
    validate: (result) => result?.content?.[0]?.text !== undefined
  },
  {
    name: 'set_working_directory',
    method: 'tools/call',
    params: { name: 'set_working_directory', arguments: { terminal_id: 'T1', path: '/tmp' } },
    validate: (result) => result?.content?.[0]?.text !== undefined
  },
  {
    name: 'get_terminal_logs',
    method: 'tools/call',
    params: { name: 'get_terminal_logs', arguments: { terminal_id: 'T1', since: Date.now() - 60000 } },
    validate: (result) => result?.content?.[0]?.text !== undefined
  },
  {
    name: 'health_check',
    method: 'tools/call',
    params: { name: 'health_check', arguments: {} },
    validate: (result) => result?.content?.[0]?.text !== undefined
  }
];

class MCPTestRunner {
  constructor() {
    this.server = null;
    this.rl = null;
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.results = [];
  }

  async start() {
    console.log('Starting MCP server...');

    this.server = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NINJA_AUTH_SECRET: 'test_secret',
        NINJA_TERMINAL_COUNT: '4',
        NINJA_LOG_LEVEL: 'error'
      }
    });

    this.rl = createInterface({ input: this.server.stdout });

    this.rl.on('line', (line) => {
      try {
        const response = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          pending.resolve(response);
          this.pendingRequests.delete(response.id);
        }
      } catch (e) {
        // Non-JSON output, ignore
      }
    });

    this.server.stderr.on('data', (data) => {
      // Log stderr for debugging
      if (process.env.DEBUG) {
        console.error(`[stderr] ${data}`);
      }
    });

    // Wait for server to be ready
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-mcp', version: '1.0.0' }
    });

    console.log('MCP server initialized\n');
  }

  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.server.stdin.write(JSON.stringify(request) + '\n');

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 5000);
    });
  }

  async runTests() {
    console.log('Running tests for 12 MCP tools...\n');
    console.log('─'.repeat(60));

    for (const testCase of TEST_CASES) {
      const startTime = Date.now();
      let status = 'FAIL';
      let error = null;
      let response = null;

      try {
        response = await this.sendRequest(testCase.method, testCase.params);

        if (response.error) {
          error = response.error.message || JSON.stringify(response.error);
        } else if (testCase.validate(response.result)) {
          status = 'PASS';
        } else {
          error = 'Validation failed';
        }
      } catch (e) {
        error = e.message;
      }

      const duration = Date.now() - startTime;
      const statusIcon = status === 'PASS' ? '✓' : '✗';
      const statusColor = status === 'PASS' ? '\x1b[32m' : '\x1b[31m';

      console.log(`${statusColor}${statusIcon}\x1b[0m ${testCase.name.padEnd(25)} ${duration}ms ${error ? `- ${error}` : ''}`);

      this.results.push({
        name: testCase.name,
        status,
        duration,
        error,
        response: status === 'FAIL' ? response : undefined
      });
    }

    console.log('─'.repeat(60));
  }

  printSummary() {
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const total = this.results.length;

    console.log(`\nSummary: ${passed}/${total} passed, ${failed} failed`);

    if (failed > 0) {
      console.log('\nFailed tests:');
      this.results
        .filter(r => r.status === 'FAIL')
        .forEach(r => {
          console.log(`  - ${r.name}: ${r.error}`);
          if (r.response && process.env.DEBUG) {
            console.log(`    Response: ${JSON.stringify(r.response, null, 2)}`);
          }
        });
    }

    return failed === 0;
  }

  stop() {
    if (this.server) {
      this.server.kill();
    }
  }
}

async function main() {
  const runner = new MCPTestRunner();

  try {
    await runner.start();
    await runner.runTests();
    const success = runner.printSummary();
    runner.stop();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error(`\nTest runner error: ${error.message}`);
    runner.stop();
    process.exit(1);
  }
}

main();
