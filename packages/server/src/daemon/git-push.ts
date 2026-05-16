/**
 * packages/server/src/daemon/git-push.ts
 *
 * Optional git push after the ceremony's commit.
 *
 * Rules:
 *   - Only pushes if git remote 'origin' exists.
 *   - Only pushes if ~/.squadboard/config.json has { daemon: { push: true } }.
 *   - NEVER force-pushes.
 *   - Push failures are warnings, not fatal errors — the daemon continues.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readConfig } from './guards.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hasOriginRemote(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      timeout: 10_000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function isPushEnabled(): Promise<boolean> {
  const config = readConfig();
  return config.daemon?.push === true;
}

// ---------------------------------------------------------------------------
// Public push function
// ---------------------------------------------------------------------------

export interface PushResult {
  attempted: boolean;
  success: boolean;
  skippedReason?: string;
  output?: string;
  error?: string;
}

export async function gitPush(): Promise<PushResult> {
  const [hasRemote, pushEnabled] = await Promise.all([
    hasOriginRemote(),
    isPushEnabled(),
  ]);

  if (!pushEnabled) {
    return {
      attempted: false,
      success: false,
      skippedReason: 'push disabled in config (set daemon.push=true to enable)',
    };
  }

  if (!hasRemote) {
    return {
      attempted: false,
      success: false,
      skippedReason: 'no git remote "origin" configured',
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      'git',
      ['push', 'origin', 'HEAD'],
      { timeout: 60_000 },
    );
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    console.log('[daemon:git-push] pushed to origin:', output || '(no output)');
    return { attempted: true, success: true, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[daemon:git-push] push failed (non-fatal):', message);
    return { attempted: true, success: false, error: message };
  }
}
