/**
 * coordinator/preamble.ts — Hybrid preamble loader (MC-2, W29).
 *
 * Prefer the in-repo `.squad/squadboard-coordinator.md` when present and
 * non-empty; otherwise fall back to the built-in constant from
 * preamble-builtin.ts.  Result is memoized after the first successful load.
 * Use `forceReload` or `resetPreambleCache()` to bypass the cache in tests.
 */

import { BUILT_IN_PREAMBLE } from "./preamble-builtin.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export interface PreambleSource {
  source: "in-repo" | "built-in";
  text: string;
  path?: string;    // set when source === "in-repo"
  loadedAt: string; // ISO 8601 timestamp
}

// ---------------------------------------------------------------------------
// Integrity check (W30 C-4) — opt-in via COORDINATOR_PREAMBLE_SHA256 env var
// ---------------------------------------------------------------------------

export class CoordinatorPreambleIntegrityError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
    filePath: string,
  ) {
    super(
      `Coordinator preamble integrity check failed for "${filePath}": ` +
        `expected sha256=${expected}, got sha256=${actual}`,
    );
    this.name = "CoordinatorPreambleIntegrityError";
  }
}

const REPO_PREAMBLE_PATH = ".squad/squadboard-coordinator.md";

let cached: PreambleSource | null = null;

export async function loadCoordinatorPreamble(opts?: {
  squadRoot?: string;   // defaults to process.cwd()
  forceReload?: boolean; // bypass cached value
}): Promise<PreambleSource> {
  if (cached && !opts?.forceReload) return cached;

  const root = opts?.squadRoot ?? process.cwd();
  const inRepoPath = path.join(root, REPO_PREAMBLE_PATH);

  if (existsSync(inRepoPath)) {
    try {
      const text = await readFile(inRepoPath, "utf8");
      if (text.trim().length > 0) {
        // Integrity check: if COORDINATOR_PREAMBLE_SHA256 is set and non-empty, verify.
        const expectedHash = (process.env.COORDINATOR_PREAMBLE_SHA256 ?? "").trim();
        if (expectedHash.length > 0) {
          const actualHash = createHash("sha256").update(text, "utf8").digest("hex");
          if (actualHash !== expectedHash) {
            throw new CoordinatorPreambleIntegrityError(expectedHash, actualHash, inRepoPath);
          }
        }

        cached = {
          source: "in-repo",
          text,
          path: inRepoPath,
          loadedAt: new Date().toISOString(),
        };
        return cached;
      }
    } catch (err) {
      // Re-throw integrity errors — they must not be silently swallowed.
      if (err instanceof CoordinatorPreambleIntegrityError) throw err;
      // fall through to built-in for all other read errors
    }
  }

  cached = {
    source: "built-in",
    text: BUILT_IN_PREAMBLE,
    loadedAt: new Date().toISOString(),
  };
  return cached;
}

export function resetPreambleCache(): void {
  cached = null;
}

/** For testing — allows direct inspection of cached state. */
export function getCachedPreamble(): PreambleSource | null {
  return cached;
}
