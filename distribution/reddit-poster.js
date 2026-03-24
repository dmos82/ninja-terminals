#!/usr/bin/env node
/**
 * Reddit Poster — Posts to 3 subreddits with one command
 * 
 * SETUP:
 * 1. Go to reddit.com/prefs/apps → "create another app"
 * 2. Name: postforme | Type: script | Redirect: http://localhost
 * 3. Copy client ID (under app name) + secret
 * 4. Create .env in this directory with your creds
 * 5. Run: node reddit-poster.js
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
}

const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } = process.env;
if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) {
  console.error('Missing creds. Create .env with REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD');
  process.exit(1);
}

const posts = [
  { sr: 'ClaudeAI', title: "I built a system that runs 4 Claude Code terminals in parallel. Here's what actually works (and what doesn't).", file: 'reddit-claudeai.md' },
  { sr: 'ChatGPT', title: "Multi-agent AI orchestration: what I learned running 4 AI agents in parallel on real projects", file: 'reddit-chatgpt.md' },
  { sr: 'PromptEngineering', title: "Beyond single prompts: architecture patterns for running multiple LLM agents simultaneously", file: 'reddit-prompteng.md' }
];

function extractBody(fp) {
  const c = fs.readFileSync(fp, 'utf8');
  const m = c.match(/\*\*Body:\*\*\n\n([\s\S]+)$/) || c.match(/\*\*Text:\*\*\n\n([\s\S]+)$/);
  return m ? m[1].trim() : c.split('\n').slice(3).join('\n').trim();
}

async function main() {
  console.log('Authenticating...');
  const r = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(REDDIT_CLIENT_ID + ':' + REDDIT_CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'PostForMe/1.0'
    },
    body: 'grant_type=password&username=' + encodeURIComponent(REDDIT_USERNAME) + '&password=' + encodeURIComponent(REDDIT_PASSWORD)
  });
  const auth = await r.json();
  if (auth.error) { console.error('Auth failed:', auth.error, auth.message || ''); process.exit(1); }
  const token = auth.access_token;
  console.log('Authenticated!\n');

  for (const p of posts) {
    const fp = path.join(__dirname, p.file);
    if (!fs.existsSync(fp)) { console.log('⚠ Skip r/' + p.sr + ' — file missing'); continue; }
    try {
      const body = extractBody(fp);
      console.log('Posting to r/' + p.sr + '...');
      const res = await fetch('https://oauth.reddit.com/api/submit', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PostForMe/1.0' },
        body: new URLSearchParams({ api_type: 'json', kind: 'self', sr: p.sr, title: p.title, text: body })
      });
      const d = await res.json();
      if (d.json?.errors?.length) throw new Error(JSON.stringify(d.json.errors));
      console.log('✓ r/' + p.sr + ': ' + (d.json?.data?.url || 'posted') + '\n');
      await new Promise(r => setTimeout(r, 5000));
    } catch (e) { console.error('✗ r/' + p.sr + ': ' + e.message + '\n'); }
  }
  console.log('Done!');
}
main().catch(console.error);
