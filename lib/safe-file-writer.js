'use strict';

const fs = require('fs');
const path = require('path');

/** Files that must NEVER be modified by the self-improvement system. */
const IMMUTABLE_FILES = ['identity.md', 'security-protocol.md'];

/**
 * Check if a file path points to an immutable file.
 * @param {string} filePath
 * @returns {boolean}
 */
function isImmutable(filePath) {
  return IMMUTABLE_FILES.includes(path.basename(filePath));
}

/**
 * Atomically write content to a file (temp + rename).
 * Throws if the file is immutable.
 * @param {string} filePath
 * @param {string} content
 */
function safeWrite(filePath, content) {
  if (isImmutable(filePath)) {
    throw new Error(`Cannot write to immutable file: ${path.basename(filePath)}`);
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
  return filePath;
}

/**
 * Append a line to a file. Creates the file and directory if needed.
 * Throws if the file is immutable.
 * @param {string} filePath
 * @param {string} line
 */
function safeAppend(filePath, line) {
  if (isImmutable(filePath)) {
    throw new Error(`Cannot append to immutable file: ${path.basename(filePath)}`);
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, line + '\n', 'utf8');
}

module.exports = { isImmutable, safeWrite, safeAppend };
