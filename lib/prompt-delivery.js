const fs = require('fs');
const path = require('path');

const BACKEND_URL = process.env.NINJA_BACKEND_URL || 'https://emtchat-backend.onrender.com';
const SESSION_MARKER = '.ninja-prompt-session';

/**
 * Fetch orchestrator prompt from backend based on user's subscription tier.
 * @param {string} token - JWT auth token
 * @param {string} projectDir - User's CWD where prompts will be written
 * @returns {Promise<{promptLevel: string, filesWritten: string[]}>}
 */
async function fetchAndWritePrompt(token, projectDir) {
  const fetch = require('node-fetch');

  const response = await fetch(`${BACKEND_URL}/api/ninja/orchestrator-prompt`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch prompt: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const { promptLevel, prompt, workerRules, orchestratorFiles } = data;
  const filesWritten = [];

  // Free tier: no prompts delivered
  if (promptLevel === 'none') {
    return { promptLevel, filesWritten };
  }

  // Standard tier (lite): write ORCHESTRATOR-PROMPT.md only
  if (promptLevel === 'lite' && prompt) {
    const promptPath = path.join(projectDir, 'ORCHESTRATOR-PROMPT.md');
    fs.writeFileSync(promptPath, prompt, 'utf8');
    filesWritten.push('ORCHESTRATOR-PROMPT.md');
  }

  // Pro tier (full): write ORCHESTRATOR-PROMPT.md + orchestrator/ directory
  if (promptLevel === 'full') {
    if (prompt) {
      const promptPath = path.join(projectDir, 'ORCHESTRATOR-PROMPT.md');
      fs.writeFileSync(promptPath, prompt, 'utf8');
      filesWritten.push('ORCHESTRATOR-PROMPT.md');
    }

    if (orchestratorFiles && typeof orchestratorFiles === 'object') {
      const orchestratorDir = path.join(projectDir, 'orchestrator');
      if (!fs.existsSync(orchestratorDir)) {
        fs.mkdirSync(orchestratorDir, { recursive: true });
      }

      for (const [filename, content] of Object.entries(orchestratorFiles)) {
        const filePath = path.join(orchestratorDir, filename);
        fs.writeFileSync(filePath, content, 'utf8');
        filesWritten.push(`orchestrator/${filename}`);
      }
    }
  }

  // Write session marker so we know these prompts were delivered (not user-owned)
  if (filesWritten.length > 0) {
    const markerPath = path.join(projectDir, SESSION_MARKER);
    const markerData = {
      deliveredAt: new Date().toISOString(),
      promptLevel,
      files: filesWritten
    };
    fs.writeFileSync(markerPath, JSON.stringify(markerData, null, 2), 'utf8');
  }

  return { promptLevel, filesWritten };
}

/**
 * Clean up delivered prompts on session end / logout.
 * Only deletes files that we delivered (tracked via session marker).
 * @param {string} projectDir - User's CWD
 * @returns {Promise<{cleaned: boolean, filesRemoved: string[]}>}
 */
async function cleanupPrompts(projectDir) {
  const markerPath = path.join(projectDir, SESSION_MARKER);
  const filesRemoved = [];

  // Check if we delivered prompts in this session
  if (!fs.existsSync(markerPath)) {
    return { cleaned: false, filesRemoved };
  }

  try {
    const markerData = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    const deliveredFiles = markerData.files || [];

    // Remove each delivered file
    for (const file of deliveredFiles) {
      const filePath = path.join(projectDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        filesRemoved.push(file);
      }
    }

    // Remove orchestrator directory if it's now empty
    const orchestratorDir = path.join(projectDir, 'orchestrator');
    if (fs.existsSync(orchestratorDir)) {
      const remaining = fs.readdirSync(orchestratorDir);
      if (remaining.length === 0) {
        fs.rmdirSync(orchestratorDir);
      }
    }

    // Remove the session marker
    fs.unlinkSync(markerPath);

    return { cleaned: true, filesRemoved };
  } catch (err) {
    console.error('Error cleaning up prompts:', err.message);
    return { cleaned: false, filesRemoved };
  }
}

module.exports = { fetchAndWritePrompt, cleanupPrompts };
