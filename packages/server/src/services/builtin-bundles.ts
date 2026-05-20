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

/** Repo root lives four directories above packages/server/src/services/ */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const BUNDLES_DIR = join(REPO_ROOT, 'bundles');
const SQUADBOARD_APPS_DIR = join(REPO_ROOT, 'squadboard-apps');

const VISIBLE_PROJECT_TEMPLATE_IDS = new Set([
  'content-writing-project',
  'feature-kanban',
  'open-source-project',
  'research-spike',
]);

type BundleCatalog = 'template' | 'squadboard-app';

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
  /** Catalog surface that should show this bundle. */
  catalog: BundleCatalog;
  /** Optional URL from squadapp.json. */
  homepage?: string;
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

  const roots: Array<{ dir: string; catalog: BundleCatalog; required: boolean }> = [
    { dir: BUNDLES_DIR, catalog: 'template', required: true },
    { dir: SQUADBOARD_APPS_DIR, catalog: 'squadboard-app', required: false },
  ];

  for (const root of roots) {
    let slugs: string[];
    try {
      const dirents = await readdir(root.dir, { withFileTypes: true });
      slugs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (err) {
      if (!root.required) continue;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Cannot read bundles directory at ${root.dir}: ${msg}`);
    }

    for (const slug of slugs) {
      const manifestPath = join(root.dir, slug, 'squad-bundle.json');
      try {
        const raw = await readFile(manifestPath, 'utf-8');
        const bundle = JSON.parse(raw) as SquadboardBundle;
        validateBundleManifest(slug, bundle);

        // Try to read squadapp.json for enriched metadata (tags, kind).
        // Non-critical: missing or malformed squadapp.json is silently ignored.
        let tags: string[] = [];
        let kind = root.catalog === 'squadboard-app' ? 'squadboard-app' : 'project-template';
        let displayName: string | undefined;
        let homepage: string | undefined;
        try {
          const squadAppRaw = await readFile(join(root.dir, slug, 'squadapp.json'), 'utf-8');
          const squadApp = JSON.parse(squadAppRaw) as Record<string, unknown>;
          if (Array.isArray(squadApp['tags'])) {
            tags = (squadApp['tags'] as unknown[]).filter((t): t is string => typeof t === 'string');
          }
          if (typeof squadApp['kind'] === 'string') {
            kind = squadApp['kind'];
          }
          if (typeof squadApp['displayName'] === 'string') {
            displayName = squadApp['displayName'];
          }
          if (typeof squadApp['homepage'] === 'string') {
            homepage = squadApp['homepage'];
          }
        } catch {
          // squadapp.json absent or malformed — use defaults
        }

        const catalog: BundleCatalog = root.catalog === 'squadboard-app' || kind === 'squadboard-app'
          ? 'squadboard-app'
          : 'template';

        entries.push({
          bundleId: bundle.manifest.bundleId,
          name: displayName ?? bundle.manifest.name,
          description: bundle.manifest.description,
          icon: bundle.project?.icon,
          version: bundle.manifest.version,
          dir: join(root.dir, slug),
          tags,
          kind,
          catalog,
          homepage,
        });
        if (!bundleMap.has(bundle.manifest.bundleId)) {
          bundleMap.set(bundle.manifest.bundleId, bundle);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push({ slug, message: msg });
        console.warn(`[builtin-bundles] Skipping bundle "${slug}": ${msg}`);
      }
    }
  }

  const seen = new Set<string>();
  const uniqueEntries: BuiltinBundleEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.bundleId)) {
      warnings.push({
        slug: entry.bundleId,
        message: `Duplicate bundleId "${entry.bundleId}" skipped`,
      });
      continue;
    }
    seen.add(entry.bundleId);
    uniqueEntries.push(entry);
  }

  // Sort by bundleId for deterministic ordering
  uniqueEntries.sort((a, b) => a.bundleId.localeCompare(b.bundleId));

  return { entries: uniqueEntries, bundleMap, warnings };
}

export async function getBuiltinProjectTemplateBundles(): Promise<BuiltinBundleEntry[]> {
  const bundles = await getBuiltinBundles();
  return bundles.filter((entry) =>
    entry.catalog === 'template'
    && entry.kind === 'project-template'
    && VISIBLE_PROJECT_TEMPLATE_IDS.has(entry.bundleId),
  );
}

export async function getBuiltinSquadboardApps(): Promise<BuiltinBundleEntry[]> {
  const bundles = await getBuiltinBundles();
  return bundles.filter((entry) => entry.catalog === 'squadboard-app');
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
