#!/usr/bin/env node

'use strict';

const pkg = require('./package.json');

// ── Arg parsing ─────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] !== undefined) {
    return args[idx + 1];
  }
  return defaultValue;
}

function hasFlag(flag) {
  return args.includes(flag);
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
NINJA TERMINALS ${pkg.version}

  Multi-terminal Claude Code orchestrator

USAGE
  npx ninja-terminals [options]

OPTIONS
  --setup                  Configure MCP server + orchestrator prompt (run once)
  --port        <number>   Port to listen on          (default: 3300)
  --terminals   <number>   Number of terminals to spawn (default: 4)
  --cwd         <path>     Working directory for terminals (default: current dir)
  --token       <jwt>      Auth token for Pro users / CI (skips browser login)
  --offline                Offline mode for Pro users (skips backend validation)
  --version, -v            Print version and exit
  --help,    -h            Show this help message

AUTHENTICATION
  Pro users can authenticate via:
    1. Browser login (default) - sign in at the web UI
    2. --token flag - pass JWT directly (useful for CI/scripts)
    3. --offline flag - skip validation (requires downloaded Pro package)

EXAMPLES
  npx ninja-terminals
  npx ninja-terminals --port 3301 --terminals 2
  npx ninja-terminals --cwd /path/to/my-project
  npx ninja-terminals --token eyJhbGciOiJIUzI1NiIs...
  npx ninja-terminals --offline
`);
  process.exit(0);
}

if (hasFlag('--version') || hasFlag('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

// ── Setup command ───────────────────────────────────────────
if (hasFlag('--setup')) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  console.log('\n🥷 NINJA TERMINALS SETUP\n');

  // 1. Find or create .mcp.json
  const projectMcp = path.join(process.cwd(), '.mcp.json');
  const globalMcp = path.join(os.homedir(), '.mcp.json');
  const mcpPath = fs.existsSync(projectMcp) ? projectMcp : globalMcp;

  let mcpConfig = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    } catch (e) {
      console.log(`⚠️  Could not parse ${mcpPath}, creating new config`);
    }
  }

  // 2. Add ninja-terminals MCP server
  const npmRoot = path.dirname(require.resolve('ninja-terminals/package.json'));
  mcpConfig.mcpServers['ninja-terminals'] = {
    command: 'node',
    args: [path.join(npmRoot, 'mcp-server.js')],
    env: {
      NINJA_TERMINAL_COUNT: '4',
      NINJA_LOG_LEVEL: 'info'
    }
  };

  fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  console.log(`✅ Added ninja-terminals to ${mcpPath}`);

  // 3. Copy orchestrator prompt to CLAUDE.md
  const claudeMd = path.join(process.cwd(), 'CLAUDE.md');
  const orchestratorPrompt = path.join(npmRoot, 'prompts', 'orchestrator-lite.md');

  if (fs.existsSync(orchestratorPrompt)) {
    const prompt = fs.readFileSync(orchestratorPrompt, 'utf-8');
    const marker = '<!-- NINJA TERMINALS ORCHESTRATOR -->';

    let claudeContent = '';
    if (fs.existsSync(claudeMd)) {
      claudeContent = fs.readFileSync(claudeMd, 'utf-8');
      if (claudeContent.includes(marker)) {
        console.log(`✅ Orchestrator prompt already in CLAUDE.md`);
      } else {
        claudeContent += `\n\n${marker}\n${prompt}`;
        fs.writeFileSync(claudeMd, claudeContent);
        console.log(`✅ Added orchestrator prompt to CLAUDE.md`);
      }
    } else {
      fs.writeFileSync(claudeMd, `${marker}\n${prompt}`);
      console.log(`✅ Created CLAUDE.md with orchestrator prompt`);
    }
  }

  // 4. Check for Claude in Chrome
  const chromeExt = mcpConfig.mcpServers['claude-in-chrome'];
  if (chromeExt) {
    console.log(`✅ Claude in Chrome detected`);
  } else {
    console.log(`⚠️  Claude in Chrome not found in MCP config`);
    console.log(`   For browser automation, install: https://github.com/anthropics/claude-in-chrome`);
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ Setup complete!

Next steps:
1. Restart Claude Code to load MCP server
2. Run: npx ninja-terminals
3. Or use MCP tools directly in Claude Code

MCP tools available after restart:
  mcp__ninja-terminals__spawn_terminal
  mcp__ninja-terminals__send_input
  mcp__ninja-terminals__list_terminals
  ... and 9 more
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  process.exit(0);
}

const port      = parseInt(getArg('--port',      '3300'),  10);
const terminals = parseInt(getArg('--terminals', '4'),     10);
const cwd       = getArg('--cwd', process.cwd());
const token     = getArg('--token', null);
const offline   = hasFlag('--offline');

if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`Error: --port must be a number between 1 and 65535`);
  process.exit(1);
}

if (isNaN(terminals) || terminals < 1 || terminals > 16) {
  console.error(`Error: --terminals must be a number between 1 and 16`);
  process.exit(1);
}

// ── Startup banner ───────────────────────────────────────────

const authMode = offline ? 'offline' : (token ? 'token' : 'browser');

console.log(`
╔═══════════════════════════════════════╗
║          NINJA TERMINALS v${pkg.version}          ║
║   Multi-agent Claude Code orchestrator  ║
╠═══════════════════════════════════════╣
║  Port       : ${String(port).padEnd(24)} ║
║  Terminals  : ${String(terminals).padEnd(24)} ║
║  CWD        : ${cwd.length > 24 ? '...' + cwd.slice(-21) : cwd.padEnd(24)} ║
║  Auth       : ${authMode.padEnd(24)} ║
╚═══════════════════════════════════════╝
`);

// ── Set env vars before requiring server.js ──────────────────
// server.js reads these at the top level on require(), so they
// must be set here before the require call.

process.env.PORT               = String(port);
process.env.DEFAULT_TERMINALS  = String(terminals);
process.env.DEFAULT_CWD        = cwd;

// Auth env vars
if (token) {
  process.env.NINJA_AUTH_TOKEN = token;
}
if (offline) {
  process.env.NINJA_OFFLINE = '1';
}

// ── Auto-open browser ────────────────────────────────────────

function openBrowser(url) {
  const { spawn } = require('child_process');
  const platform = process.platform;
  let cmd, cmdArgs;

  if (platform === 'darwin') {
    cmd = 'open';
    cmdArgs = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    cmdArgs = ['/c', 'start', url];
  } else {
    cmd = 'xdg-open';
    cmdArgs = [url];
  }

  spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref();
}

// Delay browser open until after the server listen callback fires.
// server.js calls server.listen() synchronously on require, so we
// schedule the open after the current tick stack clears.
setTimeout(() => {
  openBrowser(`http://localhost:${port}`);
}, 1500);

// ── Start the server ─────────────────────────────────────────

require('./server.js');
