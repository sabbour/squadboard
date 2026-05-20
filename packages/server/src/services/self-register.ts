/**
 * services/self-register.ts — Wave 10 Stream A1.
 *
 * Auto-registers the running Squadboard repo as a project in its own DB so
 * the dogfood loop (capture → inbox → board) can run against the real
 * squadboard codebase. Gated and idempotent:
 *
 *   - Disabled in production unless SQUADBOARD_AUTO_REGISTER_SELF=true.
 *   - Walks upward from the configured search roots looking for a `.squad/`
 *     directory; first hit wins.
 *   - Dedups on the resolved `.squad/` absolute path: if any existing
 *     project row already points at it, no-op.
 *
 * Called once at boot from `index.ts` after `initDb()` succeeds. Failure
 * never blocks server startup — we log and move on.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { isInternalSquadWorkspacePath } from './squad-path-safety.js';

const SELF_REGISTER_NAME = 'Squadboard';

export interface SelfRegisterResult {
  registered: boolean;
  reason: string;
  projectId?: string;
  squadDir?: string;
}

/**
 * Decide whether self-registration is permitted in the current environment.
 *
 * Allowed when EITHER:
 *   - `process.env.NODE_ENV !== 'production'` (dev / test default), OR
 *   - `process.env.SQUADBOARD_AUTO_REGISTER_SELF === 'true'` (explicit opt-in).
 *
 * Explicit opt-out: `SQUADBOARD_AUTO_REGISTER_SELF === 'false'` always wins.
 */
function isEnabled(): boolean {
  const raw = process.env.SQUADBOARD_AUTO_REGISTER_SELF;
  if (raw === 'false' || raw === '0') return false;
  if (raw === 'true' || raw === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Walk up from `start` looking for a `.squad/` subdirectory. Returns the
 * absolute path of the first `.squad/` found, or null.
 */
function findSquadDirUpward(start: string): string | null {
  let dir = isAbsolute(start) ? start : resolve(start);
  // Bound the walk so a misconfiguration can't traverse the whole filesystem.
  for (let depth = 0; depth < 12; depth++) {
    const candidate = join(dir, '.squad');
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory() && !isInternalSquadWorkspacePath(candidate)) {
          return candidate;
        }
      } catch {
        /* unreadable — skip */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Locate the running repo's `.squad/` directory.
 *
 * Search order:
 *   1. `process.cwd()` upward — covers the common case where `pnpm dev` is
 *      launched from the repo root.
 *   2. The directory of this source file upward — covers the
 *      `pnpm --filter <pkg> dev` case where pnpm changes CWD into the
 *      package directory before invoking the script.
 */
export function locateRepoSquadDir(): string | null {
  const fromCwd = findSquadDirUpward(process.cwd());
  if (fromCwd) return fromCwd;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return findSquadDirUpward(here);
  } catch {
    return null;
  }
}

/**
 * Insert a Squadboard project row pointing at the running repo's `.squad/`
 * if one doesn't already exist. Idempotent on the resolved `.squad/` path.
 */
export async function registerSelfIfNeeded(): Promise<SelfRegisterResult> {
  if (!isEnabled()) {
    return { registered: false, reason: 'disabled' };
  }

  const squadDir = locateRepoSquadDir();
  if (!squadDir) {
    return { registered: false, reason: 'no_squad_dir_found' };
  }

  const db = getDb();

  // Dedup: any project whose `path` resolves to this same `.squad/` is treated
  // as already self-registered. We compare both the literal string AND the
  // resolved variant (covers `<repo>` vs `<repo>/.squad` storage conventions).
  const existing = await db.select({
    id: schema.projects.id,
    name: schema.projects.name,
    path: schema.projects.path,
  })
    .from(schema.projects);

  const wantAbs = resolve(squadDir);
  const wantRoot = resolve(squadDir, '..');
  const match = existing.find((row) => {
    const stored = isAbsolute(row.path) ? row.path : resolve(row.path);
    return stored === wantAbs || stored === wantRoot;
  });

  if (match) {
    return {
      registered: false,
      reason: 'already_registered',
      projectId: match.id,
      squadDir: wantAbs,
    };
  }

  const staleInternalSelfProject = existing.find((row) => (
    row.name === SELF_REGISTER_NAME
    && isInternalSquadWorkspacePath(row.path)
  ));

  if (staleInternalSelfProject) {
    await db
      .update(schema.projects)
      .set({ path: wantAbs, updatedAt: new Date() })
      .where(eq(schema.projects.id, staleInternalSelfProject.id));

    return {
      registered: false,
      reason: 'corrected_internal_path',
      projectId: staleInternalSelfProject.id,
      squadDir: wantAbs,
    };
  }

  const [created] = await db
    .insert(schema.projects)
    .values({ name: SELF_REGISTER_NAME, path: wantAbs })
    .returning({ id: schema.projects.id });

  return {
    registered: true,
    reason: 'inserted',
    projectId: created.id,
    squadDir: wantAbs,
  };
}

/**
 * Convenience wrapper used at boot. Logs and swallows any error so a
 * registration glitch can't take down the server. Returns the result for
 * tests + diagnostics.
 */
export async function registerSelfAtBoot(): Promise<SelfRegisterResult> {
  try {
    const result = await registerSelfIfNeeded();
    if (result.registered) {
      console.log(
        `[self-register] inserted project "${SELF_REGISTER_NAME}" id=${result.projectId} path=${result.squadDir}`,
      );
    } else if (result.reason === 'already_registered') {
      console.log(
        `[self-register] skipped — already registered as id=${result.projectId} path=${result.squadDir}`,
      );
    } else if (result.reason === 'corrected_internal_path') {
      console.log(
        `[self-register] corrected internal project path id=${result.projectId} path=${result.squadDir}`,
      );
    } else if (result.reason === 'no_squad_dir_found') {
      console.log('[self-register] skipped — no .squad/ directory found near CWD or source root');
    } else if (result.reason === 'disabled') {
      console.log(
        '[self-register] skipped — disabled (NODE_ENV=production and SQUADBOARD_AUTO_REGISTER_SELF != true)',
      );
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[self-register] failed (non-fatal): ${message}`);
    return { registered: false, reason: `error: ${message}` };
  }
}
