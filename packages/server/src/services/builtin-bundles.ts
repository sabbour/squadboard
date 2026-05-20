/**
 * services/builtin-bundles.ts
 *
 * Scans the workspace-level `bundles/` directory at first-call and caches
 * validated bundles in memory for the lifetime of the server process.
 *
 * Invariants:
 *   - Scan is lazy (first GET /api/templates/builtin-projects call triggers it).
 *   - Invalid bundles are logged as warnings but never crash the server.
 *   - Results are memoised after the first successful scan.
 *
 * Public API:
 *   getBuiltinBundles()  → Promise<BuiltinBundleEntry[]>
 *   getBuiltinBundle(id) → Promise<SquadboardBundle | null>
 *   getBuiltinBundleWarnings() → BuiltinBundleWarning[]
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SquadboardBundle } from '@sabbour/squadboard-sdk/bundle';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** bundles/ lives four directories above packages/server/src/services/ */
const BUNDLES_DIR = join(__dirname, '..', '..', '..', '..', 'bundles');

export interface BuiltinBundleEntry {
  bundleId: string;
  name: string;
  description: string;
  icon?: string;
  version: string;
  /** Absolute path to the bundle directory */
  dir: string;
  /** Tags sourced from squadapp.json (empty array if absent). */
  tags: string[];
  /** App kind from squadapp.json — e.g. 'project-template'. Defaults to 'project-template'. */
  kind: string;
}

export interface BuiltinBundleWarning {
  slug: string;
  message: string;
}

// ---------------------------------------------------------------------------
// In-process cache
// ---------------------------------------------------------------------------

let _cached: BuiltinBundleEntry[] | null = null;
let _bundleMap: Map<string, SquadboardBundle> | null = null;
let _warnings: BuiltinBundleWarning[] = [];
let _scanError: string | null = null;

/**
 * Reset the cache (test helper + used in diagnostic re-check).
 */
export function resetBuiltinBundleCache(): void {
  _cached = null;
  _bundleMap = null;
  _warnings = [];
  _scanError = null;
}

/**
 * Returns warnings collected during the last scan (non-fatal validation
 * failures). Safe to call before getBuiltinBundles() — returns [] until
 * first scan completes.
 */
export function getBuiltinBundleWarnings(): BuiltinBundleWarning[] {
  return _warnings;
}

/**
 * Returns the scan error message if the bundles directory is unreadable,
 * or null if the scan completed (even with per-bundle warnings).
 */
export function getBuiltinBundleScanError(): string | null {
  return _scanError;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

async function scan(): Promise<{ entries: BuiltinBundleEntry[]; bundleMap: Map<string, SquadboardBundle>; warnings: BuiltinBundleWarning[] }> {
  const entries: BuiltinBundleEntry[] = [];
  const bundleMap = new Map<string, SquadboardBundle>();
  const warnings: BuiltinBundleWarning[] = [];

  let slugs: string[];
  try {
    const dirents = await readdir(BUNDLES_DIR, { withFileTypes: true });
    slugs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read bundles directory at ${BUNDLES_DIR}: ${msg}`);
  }

  for (const slug of slugs) {
    const manifestPath = join(BUNDLES_DIR, slug, 'squad-bundle.json');
    try {
      const raw = await readFile(manifestPath, 'utf-8');
      const bundle = JSON.parse(raw) as SquadboardBundle;
      validateBundleManifest(slug, bundle);

      // Try to read squadapp.json for enriched metadata (tags, kind).
      // Non-critical: missing or malformed squadapp.json is silently ignored.
      let tags: string[] = [];
      let kind = 'project-template';
      try {
        const squadAppRaw = await readFile(join(BUNDLES_DIR, slug, 'squadapp.json'), 'utf-8');
        const squadApp = JSON.parse(squadAppRaw) as Record<string, unknown>;
        if (Array.isArray(squadApp['tags'])) {
          tags = (squadApp['tags'] as unknown[]).filter((t): t is string => typeof t === 'string');
        }
        if (typeof squadApp['kind'] === 'string') {
          kind = squadApp['kind'];
        }
      } catch {
        // squadapp.json absent or malformed — use defaults
      }

      entries.push({
        bundleId: bundle.manifest.bundleId,
        name: bundle.manifest.name,
        description: bundle.manifest.description,
        icon: bundle.project?.icon,
        version: bundle.manifest.version,
        dir: join(BUNDLES_DIR, slug),
        tags,
        kind,
      });
      bundleMap.set(bundle.manifest.bundleId, bundle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push({ slug, message: msg });
      console.warn(`[builtin-bundles] Skipping bundle "${slug}": ${msg}`);
    }
  }

  // Sort by bundleId for deterministic ordering
  entries.sort((a, b) => a.bundleId.localeCompare(b.bundleId));

  return { entries, bundleMap, warnings };
}

/**
 * Minimal structural validation — throws on malformed manifests.
 */
function validateBundleManifest(slug: string, bundle: unknown): void {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Not a valid JSON object');
  }
  const b = bundle as Record<string, unknown>;
  if (!b['manifest'] || typeof b['manifest'] !== 'object') {
    throw new Error('Missing required `manifest` section');
  }
  const m = b['manifest'] as Record<string, unknown>;
  if (!m['bundleId'] || typeof m['bundleId'] !== 'string') {
    throw new Error('manifest.bundleId is required');
  }
  if (!m['name'] || typeof m['name'] !== 'string') {
    throw new Error('manifest.name is required');
  }
  if (!m['version'] || typeof m['version'] !== 'string') {
    throw new Error('manifest.version is required');
  }
  if (typeof m['schemaVersion'] !== 'number') {
    throw new Error('manifest.schemaVersion must be a number');
  }
  if (m['schemaVersion'] as number > 1) {
    // Warn but don't throw — forward-compat
    console.warn(`[builtin-bundles] Bundle "${slug}" has schemaVersion=${m['schemaVersion']} > 1; unknown sections will be ignored`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns all valid built-in bundle summaries.
 * Triggers a scan on first call; subsequent calls return the cached result.
 */
export async function getBuiltinBundles(): Promise<BuiltinBundleEntry[]> {
  if (_cached !== null) {
    return _cached;
  }
  try {
    const { entries, bundleMap, warnings } = await scan();
    _cached = entries;
    _bundleMap = bundleMap;
    _warnings = warnings;
    _scanError = null;
    return entries;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _scanError = msg;
    _cached = [];
    _bundleMap = new Map();
    _warnings = [];
    return [];
  }
}

/**
 * Returns the full parsed SquadboardBundle for a given bundleId, or null
 * if not found or invalid.
 */
export async function getBuiltinBundle(bundleId: string): Promise<SquadboardBundle | null> {
  // Ensure scan has run
  await getBuiltinBundles();
  return _bundleMap?.get(bundleId) ?? null;
}

/**
 * Returns the directory path for a given bundleId, or null if not found.
 * Used to pass as `bundleDir` to applyBundle() for bodyPath resolution.
 */
export async function getBuiltinBundleDir(bundleId: string): Promise<string | null> {
  await getBuiltinBundles();
  const entry = (_cached ?? []).find((e) => e.bundleId === bundleId);
  return entry?.dir ?? null;
}
