'use strict';

const path = require('path');

// ---------------------------------------------------------------------------
// Pattern matching helpers
// ---------------------------------------------------------------------------

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports `*` (any chars) and `?` (single char). Everything else is literal.
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Build a matchable string from a tool invocation.
 * Format: `ToolName(argument_summary)`
 * @param {string} toolName
 * @param {Object} toolInput
 * @returns {string}
 */
function buildMatchString(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return toolName;

  // For Bash, the "command" field is the primary matchable content
  if (toolName === 'Bash' && toolInput.command) {
    return `Bash(${toolInput.command})`;
  }

  // For file-oriented tools, use the file path
  const filePath = toolInput.file_path || toolInput.path || toolInput.pattern || '';
  if (filePath) {
    return `${toolName}(${filePath})`;
  }

  // Fallback: serialize all values
  const vals = Object.values(toolInput).join(' ');
  return `${toolName}(${vals})`;
}

/**
 * Test whether a match string satisfies a pattern.
 * Pattern formats:
 *   - `ToolName`           — matches any invocation of that tool
 *   - `ToolName(glob)`     — matches tool + argument glob
 *   - `*`                  — matches everything
 *
 * @param {string} matchStr  - e.g. "Bash(rm -rf /tmp)"
 * @param {string} pattern   - e.g. "Bash(rm -rf *)"
 * @returns {boolean}
 */
function matchesPattern(matchStr, pattern) {
  // Wildcard — matches everything
  if (pattern === '*') return true;

  // Pattern with arguments: "Tool(glob)"
  const parenIdx = pattern.indexOf('(');
  if (parenIdx !== -1 && pattern.endsWith(')')) {
    const patTool = pattern.slice(0, parenIdx);
    const patArgs = pattern.slice(parenIdx + 1, -1);

    const matchParenIdx = matchStr.indexOf('(');
    if (matchParenIdx === -1) return false;

    const matchTool = matchStr.slice(0, matchParenIdx);
    const matchArgs = matchStr.slice(matchParenIdx + 1, -1);

    // Tool name must match (case-insensitive)
    if (patTool.toLowerCase() !== matchTool.toLowerCase()) return false;

    // Args glob match
    return globToRegex(patArgs).test(matchArgs);
  }

  // Simple tool-name-only pattern
  const matchTool = matchStr.split('(')[0];
  return pattern.toLowerCase() === matchTool.toLowerCase();
}

// ---------------------------------------------------------------------------
// Permission evaluation
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PermissionRules
 * @property {string[]} allow - Patterns to allow
 * @property {string[]} deny  - Patterns to deny
 * @property {string[]} ask   - Patterns to prompt the user
 */

/**
 * @typedef {Object} PermissionDecision
 * @property {'allow'|'deny'|'ask'} decision
 * @property {string} [reason]
 */

/**
 * Evaluate whether a tool invocation should be allowed, denied, or require approval.
 *
 * Evaluation order: deny -> allow -> ask -> default 'ask'.
 *
 * @param {string}          terminalId - Terminal identifier
 * @param {string}          toolName   - Name of the tool being invoked
 * @param {Object}          toolInput  - Tool input/arguments
 * @param {PermissionRules} rules      - Permission rules to evaluate against
 * @returns {PermissionDecision}
 */
function evaluatePermission(terminalId, toolName, toolInput, rules) {
  const matchStr = buildMatchString(toolName, toolInput);

  // 1. Deny rules checked first (most restrictive wins)
  if (rules.deny) {
    for (const pattern of rules.deny) {
      if (matchesPattern(matchStr, pattern)) {
        return {
          decision: 'deny',
          reason: `Denied by rule: ${pattern}`,
        };
      }
    }
  }

  // 2. Allow rules
  if (rules.allow) {
    for (const pattern of rules.allow) {
      if (matchesPattern(matchStr, pattern)) {
        return {
          decision: 'allow',
          reason: `Allowed by rule: ${pattern}`,
        };
      }
    }
  }

  // 3. Ask rules
  if (rules.ask) {
    for (const pattern of rules.ask) {
      if (matchesPattern(matchStr, pattern)) {
        return {
          decision: 'ask',
          reason: `Requires approval per rule: ${pattern}`,
        };
      }
    }
  }

  // 4. Default: ask
  return {
    decision: 'ask',
    reason: `No matching rule for ${toolName}; defaulting to ask`,
  };
}

// ---------------------------------------------------------------------------
// Default rules generator
// ---------------------------------------------------------------------------

/** Safe bash commands that are read-only or low-risk. */
const SAFE_BASH_PREFIXES = [
  'ls', 'cat', 'head', 'tail', 'wc', 'echo', 'pwd', 'which', 'whoami',
  'date', 'env', 'printenv', 'node -e', 'node -p',
  'npm test', 'npm run test', 'npm run lint', 'npm run build',
  'npx jest', 'npx tsc', 'npx eslint',
  'git status', 'git diff', 'git log', 'git show', 'git branch',
  'git stash list', 'git remote -v',
];

/**
 * Generate sensible default permission rules scoped to a directory.
 *
 * @param {string} scope - Absolute or relative directory path (e.g. "/src/api/")
 * @returns {PermissionRules}
 */
function getDefaultRules(scope) {
  const normalizedScope = scope.endsWith('/') ? scope : scope + '/';

  const allow = [
    // Read-only tools are always safe
    'Read',
    'Glob',
    'Grep',
    // File modifications within scope
    `Edit(${normalizedScope}*)`,
    `Write(${normalizedScope}*)`,
  ];

  // Safe bash commands
  for (const cmd of SAFE_BASH_PREFIXES) {
    allow.push(`Bash(${cmd}*)`);
  }

  const deny = [
    // Destructive filesystem operations
    'Bash(rm -rf *)',
    'Bash(rm -r /*)',
    'Bash(sudo *)',
    'Bash(chmod 777 *)',

    // Destructive git operations
    'Bash(git push --force*)',
    'Bash(git push -f *)',
    'Bash(git reset --hard*)',
    'Bash(git clean -f*)',

    // Sensitive files and directories
    'Read(*.env)',
    'Read(*.env.*)',
    'Edit(*.env)',
    'Edit(*.env.*)',
    'Write(*.env)',
    'Write(*.env.*)',
    `Read(${path.join(process.env.HOME || '~', '.ssh')}*)`,
    `Read(${path.join(process.env.HOME || '~', '.aws')}*)`,
    `Edit(${path.join(process.env.HOME || '~', '.ssh')}*)`,
    `Edit(${path.join(process.env.HOME || '~', '.aws')}*)`,
    `Write(${path.join(process.env.HOME || '~', '.ssh')}*)`,
    `Write(${path.join(process.env.HOME || '~', '.aws')}*)`,
  ];

  const ask = [
    // Anything outside scope that modifies files
    'Edit',
    'Write',
    // Any bash command not explicitly allowed
    'Bash',
  ];

  return { allow, deny, ask };
}

// ---------------------------------------------------------------------------
// Express middleware factory
// ---------------------------------------------------------------------------

/**
 * Create an Express middleware that evaluates Claude Code PreToolUse hook requests.
 *
 * The middleware handles `POST /api/terminals/:id/evaluate` and returns
 * a decision in the Claude Code hook response format.
 *
 * @param {(terminalId: string) => PermissionRules} getTerminalRules
 *   Callback that returns the permission rules for a given terminal ID.
 * @returns {import('express').RequestHandler}
 */
function createEvaluateMiddleware(getTerminalRules) {
  return function evaluateMiddleware(req, res) {
    try {
      const terminalId = req.params.id;

      if (!terminalId) {
        res.status(400).json({ error: 'Missing terminal id' });
        return;
      }

      const { tool_name, tool_input } = req.body || {};

      if (!tool_name) {
        res.status(400).json({ error: 'Missing tool_name in request body' });
        return;
      }

      const rules = getTerminalRules(terminalId);

      if (!rules) {
        // No rules configured for this terminal — default allow
        res.json({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: `No rules configured for terminal ${terminalId}`,
          },
        });
        return;
      }

      const { decision, reason } = evaluatePermission(
        terminalId,
        tool_name,
        tool_input || {},
        rules
      );

      res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision,
          permissionDecisionReason: reason || '',
        },
      });
    } catch (err) {
      res.status(500).json({
        error: 'Permission evaluation failed',
        detail: err.message,
      });
    }
  };
}

module.exports = {
  evaluatePermission,
  getDefaultRules,
  createEvaluateMiddleware,
};
