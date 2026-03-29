'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Worker settings generator
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tier-based permission definitions
// ---------------------------------------------------------------------------

const TIER_PERMISSIONS = {
  // Free tier: basic file operations only
  free: {
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    mcp: [], // No MCP tools
    network: false,
    agents: false,
  },
  // Standard tier: + network tools
  standard: {
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    mcp: [], // No MCP tools
    network: true, // WebFetch, WebSearch
    agents: true,
  },
  // Pro tier: full access including all MCP tools
  pro: {
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    mcp: [
      'mcp__studychat__*',
      'mcp__postforme__*',
      'mcp__render-billing__*',
      'mcp__netlify-billing__*',
      'mcp__chrome-devtools__*',
      'mcp__gkchatty-production__*',
      'mcp__builder-pro-mcp__*',
      'mcp__gmail__*',
      'mcp__c2c__*',
      'mcp__atlas-architect__*',
    ],
    network: true,
    agents: true,
  },
};

/**
 * Generate a Claude Code worker settings object for a terminal.
 *
 * @param {number|string} terminalId - Terminal identifier
 * @param {string|string[]} scope    - File scope path(s), or '*'/'' for unrestricted
 * @param {Object}          [options={}]
 * @param {number}          [options.port=3000]          - Server port for hook URLs
 * @param {string}          [options.tier='pro']         - User tier: 'free', 'standard', 'pro'
 * @param {string[]}        [options.additionalAllow=[]] - Extra allow rules to merge
 * @param {string[]}        [options.additionalDeny=[]]  - Extra deny rules to merge
 * @returns {Object} Settings object suitable for `.claude/settings.local.json`
 */
function generateWorkerSettings(terminalId, scope, options = {}) {
  const port = options.port || 3000;
  const tier = options.tier || 'pro';
  const additionalAllow = options.additionalAllow || [];
  const additionalDeny = options.additionalDeny || [];

  // Get tier permissions (default to free if unknown tier)
  const tierPerms = TIER_PERMISSIONS[tier] || TIER_PERMISSIONS.free;

  // Build Edit/Write rules based on scope
  const editWriteRules = [];
  const unrestricted = !scope || scope === '*' || (Array.isArray(scope) && scope.length === 0);

  if (unrestricted) {
    editWriteRules.push('Edit', 'Write');
  } else {
    const scopes = Array.isArray(scope) ? scope : [scope];
    for (const s of scopes) {
      // Normalize: ensure trailing /** for glob matching
      const normalized = s.endsWith('/**') ? s : (s.endsWith('/') ? `${s}**` : `${s}/**`);
      const scopePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
      editWriteRules.push(`Edit(${scopePath})`, `Write(${scopePath})`);
    }
  }

  // Base permissions for all tiers
  const allow = [
    'Read',
    'Glob',
    'Grep',
    ...editWriteRules,
    // Safe bash commands (all tiers)
    'Bash(npm test *)',
    'Bash(npm run *)',
    'Bash(node *)',
    'Bash(npx *)',
    'Bash(git diff *)',
    'Bash(git log *)',
    'Bash(git status)',
    'Bash(ls *)',
    'Bash(cat *)',
    'Bash(wc *)',
    'Bash(head *)',
    'Bash(tail *)',
    'Bash(mkdir *)',
    'Bash(cp *)',
  ];

  // Add tier-specific permissions
  if (tierPerms.network) {
    allow.push('WebFetch(*)', 'WebSearch(*)');
    allow.push('Bash(curl *)');
  }

  if (tierPerms.agents) {
    allow.push('Agent(*)');
  }

  // Add MCP tools for the tier
  allow.push(...tierPerms.mcp);

  // Additional bash commands (all tiers)
  allow.push(
    'Bash(cd *)',
    'Bash(grep *)',
    'Bash(find *)',
    'Bash(echo *)',
    'Bash(sleep *)',
    'Bash(kill *)',
    'Bash(lsof *)',
    'Bash(ps *)',
    'Bash(git add *)',
    'Bash(git commit *)',
    'Bash(git push *)',
  );

  // Merge additional allows
  allow.push(...additionalAllow);

  const deny = [
    'Bash(rm -rf *)',
    'Bash(git push --force *)',
    'Bash(sudo *)',
    'Bash(chmod *)',
    'Bash(chown *)',
    'Read(./.env)',
    'Read(./.env.*)',
    'Read(~/.ssh/**)',
    'Read(~/.aws/**)',
    'Edit(./.env)',
    'Edit(./.env.*)',
    ...additionalDeny,
  ];

  return {
    permissions: { allow, deny },
    sandbox: {
      enabled: false,
    },
  };
}

/**
 * Generate and write worker settings to disk.
 *
 * @param {number|string} terminalId - Terminal identifier
 * @param {string}        projectDir - Absolute path to the project directory
 * @param {string|string[]} scope    - File scope path(s)
 * @param {Object}        [options={}]
 * @param {string}        [options.tier='pro'] - User tier for permission gating
 * @returns {string} Absolute path to the written settings file
 */
function writeWorkerSettings(terminalId, projectDir, scope, options = {}) {
  const settings = generateWorkerSettings(terminalId, scope, options);
  const claudeDir = path.join(projectDir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');

  // Create .claude/ directory if it doesn't exist
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  // Merge with existing settings instead of overwriting
  let existing = {};
  try {
    if (fs.existsSync(settingsPath)) {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch { /* ignore parse errors, start fresh */ }

  // Merge permissions: deduplicate allow/deny lists
  const mergedAllow = [...new Set([...(existing.permissions?.allow || []), ...settings.permissions.allow])];
  const mergedDeny = [...new Set([...(existing.permissions?.deny || []), ...settings.permissions.deny])];

  const merged = {
    ...existing,
    permissions: { allow: mergedAllow, deny: mergedDeny },
    sandbox: settings.sandbox,
    // Preserve existing hooks, enabledMcpjsonServers, etc.
  };

  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return settingsPath;
}

module.exports = { generateWorkerSettings, writeWorkerSettings, TIER_PERMISSIONS };
