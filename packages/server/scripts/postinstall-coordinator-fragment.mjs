#!/usr/bin/env node
/* eslint-disable no-console */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Respect the skip env var
if (process.env.SQUADBOARD_SKIP_POSTINSTALL) {
  console.log('ℹ️  Squadboard postinstall skipped (SQUADBOARD_SKIP_POSTINSTALL set)');
  process.exit(0);
}

const targetDir = path.join(os.homedir(), '.squad', 'extensions', 'coordinator');
const targetPath = path.join(targetDir, 'squadboard.md');
const bundledPath = path.join(__dirname, '..', 'coordinator-fragment.md');

const MARKER = '<!-- squadboard:auto-installed -->';

/**
 * Compute SHA-256 of file contents
 */
function computeSha(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Read bundled fragment and prepend marker
 */
function readBundledFragment() {
  let content = fs.readFileSync(bundledPath, 'utf-8');
  // Remove marker if already present (idempotency)
  content = content.replace(`${MARKER}\n\n`, '').replace(`${MARKER}\n`, '');
  // Prepend marker
  return `${MARKER}\n\n${content}`;
}

/**
 * Install or upgrade the coordinator fragment
 */
try {
  // Ensure target directory exists
  fs.mkdirSync(targetDir, { recursive: true });

  const bundledContent = readBundledFragment();
  const bundledSha = computeSha(bundledContent);

  // Case 1: Target file does not exist
  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, bundledContent, 'utf-8');
    console.log(`✅ Installed Squadboard coordinator fragment at ~/.squad/extensions/coordinator/squadboard.md`);
    process.exit(0);
  }

  // Case 2: Target file exists
  const targetContent = fs.readFileSync(targetPath, 'utf-8');
  const targetSha = computeSha(targetContent);

  // Case 2a: SHAs match — no-op
  if (targetSha === bundledSha) {
    console.log(`✅ Squadboard coordinator fragment up to date`);
    process.exit(0);
  }

  // Case 2b: SHAs differ — check marker
  if (targetContent.includes(MARKER)) {
    // We own this file; upgrade silently
    fs.writeFileSync(targetPath, bundledContent, 'utf-8');
    console.log(`🔄 Squadboard coordinator fragment upgraded`);
    process.exit(0);
  }

  // Case 2c: User has manually edited; save new version alongside
  const newPath = `${targetPath}.new`;
  fs.writeFileSync(newPath, bundledContent, 'utf-8');
  console.log(`⚠️  User-edited squadboard.md detected — wrote new version to squadboard.md.new`);
  console.log(`   Run 'diff ~/.squad/extensions/coordinator/squadboard.md ~/.squad/extensions/coordinator/squadboard.md.new' to compare.`);
  console.log(`   Keep your edits or merge as you prefer.`);
  process.exit(0);
} catch (err) {
  console.error(`⚠️  Squadboard postinstall encountered an error: ${err.message}`);
  // Always exit 0 — postinstall failures must not break npm install
  process.exit(0);
}
