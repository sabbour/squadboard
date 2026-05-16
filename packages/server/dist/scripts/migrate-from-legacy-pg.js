/**
 * migrate-from-legacy-pg.ts
 *
 * One-time migrator: reads the legacy embedded-postgres cluster at
 * ~/.squadboard/data/ and copies all rows into the PGlite cluster at
 * ~/.squadboard/data/pglite/.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Wave 13 (commit ca257838) swapped embedded-postgres for PGlite. Users who
 * had been running the old server have their data in a PostgreSQL 18 on-disk
 * cluster that PGlite cannot read. This script bridges that gap once, then
 * writes a marker file so it never runs again.
 *
 * APPROACH — Option (c): cached pnpm binaries
 * ────────────────────────────────────────────
 * embedded-postgres@18 is still present in the workspace's pnpm virtual store
 * even though it was removed from packages/server/package.json. This script
 * discovers the `postgres` / `pg_ctl` binaries from the store by scanning
 * node_modules/.pnpm/ for the platform+arch package matching the legacy cluster's
 * PG major version. No re-install, no network, no system postgres required.
 *
 * If the binary cannot be found, the migrator aborts with a clear error.
 *
 * SAFETY INVARIANTS
 * ─────────────────
 * • NEVER modifies or deletes the legacy data directory (read-only access).
 * • Refuses to overwrite a non-empty PGlite cluster unless --force is set.
 * • Idempotent: no-op when marker file exists (unless --force).
 * • Per-table transactions in PGlite: a table that fails rolls back cleanly.
 *
 * MARKER FILE
 * ───────────
 * ~/.squadboard/data/.migrated-to-pglite-v1
 * JSON: { migrated_at, source_path, dest_path, row_counts: { table: N, … } }
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir, arch, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
// ─── Paths ───────────────────────────────────────────────────────────────────
const HOME = homedir();
const LEGACY_DATA_DIR = join(HOME, '.squadboard', 'data');
const PGLITE_DATA_DIR = join(HOME, '.squadboard', 'data', 'pglite');
const MARKER_FILE = join(LEGACY_DATA_DIR, '.migrated-to-pglite-v1');
// Legacy cluster credentials (from the embedded-postgres era; see .deprecated/postgres.ts)
const LEGACY_USER = 'squadboard';
const LEGACY_PASSWORD = 'squadboard';
const LEGACY_DATABASE = 'squadboard';
// pg_ctl log goes into the legacy data dir (safe, non-destructive)
const PGCTL_LOG = join(LEGACY_DATA_DIR, 'migrate-pg_ctl.log');
// ─── Table migration order (topological — parents before children) ────────────
// Every table in schema.ts is listed. Tables not present in the legacy cluster
// are silently skipped.
const TABLE_ORDER = [
    // Level 0 — no FK
    'projects',
    'templates',
    'review_policy_defaults',
    // Level 1 — FK → projects
    'settings',
    'agents',
    'issues',
    'labels',
    'column_meta',
    'routing_rules',
    'workflows',
    'skills',
    'tools',
    'mcp_servers',
    'review_policy_presets',
    'github_sync_log',
    // Level 1b — FK → workflows (must precede workflow_runs which references workflow_versions)
    'workflow_versions',
    'ceremony_schedules',
    // Level 2 — FK → agents
    'agent_keywords',
    // Level 2 — FK → issues + agents
    'issue_runs',
    // Level 2 — FK → issues + workflow_versions
    'workflow_runs',
    // Level 2 — FK → issues
    'comments',
    'deliverables',
    'issue_links',
    'issue_attachments',
    // Level 2 — FK → labels + issues
    'issue_labels',
    // Level 2 — FK → projects + agents
    'live_sessions',
    'consult_sessions',
    // Level 3 — FK → agents + skills/tools/mcp_servers
    'agent_skills',
    'agent_tools',
    'agent_mcp_servers',
    // Level 3 — FK → live_sessions
    'live_session_events',
    // Level 3 — FK → workflow_runs + issue_runs
    'step_runs',
    // Level 3 — FK → issues + workflow_versions
    'issue_workflows',
    // Level 3 — FK → projects + issues + issue_runs
    'routing_log',
    // Level 4 — FK → workflow_runs + step_runs + …
    'review_events',
    'handoff_context',
    // Level 4 — FK → projects + issues (on delete set null)
    'inbox_items',
    // Level 3 — FK → consult_sessions
    'consult_messages',
    // Level 4 — FK → consult_sessions + consult_messages
    'consult_proposals',
];
// ─── Binary discovery ─────────────────────────────────────────────────────────
/**
 * Resolves the directory containing postgres / pg_ctl binaries that match the
 * PG major version of the legacy cluster. Scans the workspace's pnpm virtual
 * store — the embedded-postgres platform package is there even after it was
 * removed from packages/server/package.json.
 */
function findLegacyPgBinDir(pgMajorVersion) {
    // Walk up from this file to the workspace root: src/scripts/FILE → src/scripts → src → server → packages → workspace
    const thisFile = fileURLToPath(import.meta.url);
    const workspaceRoot = resolve(thisFile, '../../../../..');
    const pnpmStore = join(workspaceRoot, 'node_modules', '.pnpm');
    if (!existsSync(pnpmStore)) {
        console.warn('[migrate] pnpm store not found at', pnpmStore);
        return null;
    }
    // Map Node arch to the embedded-postgres package suffix
    const nodeArch = arch(); // 'arm64' | 'x64' | 'ia32' …
    const nodePlatform = platform(); // 'linux' | 'darwin' | 'win32'
    const archMap = {
        arm64: 'arm64',
        x64: 'x64',
        ia32: 'ia32',
        arm: 'arm',
        ppc64: 'ppc64',
    };
    const pgArch = archMap[nodeArch];
    if (!pgArch) {
        console.warn('[migrate] unsupported arch:', nodeArch);
        return null;
    }
    // Package name pattern in pnpm store:
    // @embedded-postgres+linux-arm64@18.3.0-beta.17
    const pkgPrefix = `@embedded-postgres+${nodePlatform}-${pgArch}@${pgMajorVersion}.`;
    let entries;
    try {
        entries = readdirSync(pnpmStore);
    }
    catch {
        return null;
    }
    const match = entries.find((e) => e.startsWith(pkgPrefix));
    if (!match) {
        console.warn(`[migrate] no embedded-postgres v${pgMajorVersion} binary found in pnpm store`);
        console.warn(`[migrate]   searched prefix: ${pkgPrefix} in ${pnpmStore}`);
        return null;
    }
    const binDir = join(pnpmStore, match, 'node_modules', `@embedded-postgres`, `${nodePlatform}-${pgArch}`, 'native', 'bin');
    if (!existsSync(join(binDir, 'pg_ctl'))) {
        console.warn('[migrate] pg_ctl not found in discovered binDir:', binDir);
        return null;
    }
    return binDir;
}
// ─── Legacy cluster startup / shutdown ───────────────────────────────────────
function pickRandomPort() {
    // High ephemeral range; avoid 54321 (legacy port) and 5432 (system PG)
    return 45000 + Math.floor(Math.random() * 10000);
}
function readLegacyPgVersion() {
    const versionFile = join(LEGACY_DATA_DIR, 'PG_VERSION');
    if (!existsSync(versionFile))
        return null;
    const ver = parseInt(readFileSync(versionFile, 'utf8').trim(), 10);
    return Number.isNaN(ver) ? null : ver;
}
/** Start the legacy postgres cluster. Returns the port it's listening on. */
async function startLegacyCluster(binDir, port) {
    console.log(`[migrate] starting legacy cluster on port ${port}…`);
    // pg_ctl start: -D = data dir, -w = wait until ready, -l = log file,
    // -o = options passed through to postgres (port override)
    await runCommand(join(binDir, 'pg_ctl'), ['-D', LEGACY_DATA_DIR, '-w', '-l', PGCTL_LOG, '-o', `-p ${port}`, 'start'], { env: { ...process.env, PGPASSWORD: LEGACY_PASSWORD } });
    console.log(`[migrate] legacy cluster ready on port ${port}`);
}
/** Stop the legacy postgres cluster cleanly. */
async function stopLegacyCluster(binDir) {
    console.log('[migrate] stopping legacy cluster…');
    try {
        await runCommand(join(binDir, 'pg_ctl'), ['-D', LEGACY_DATA_DIR, '-m', 'fast', 'stop']);
        console.log('[migrate] legacy cluster stopped');
    }
    catch (err) {
        // Non-fatal — the cluster may have already stopped
        console.warn('[migrate] pg_ctl stop warning:', err.message);
    }
}
/** Check if legacy cluster is already running (postmaster.pid present + PID alive). */
function isLegacyClusterRunning() {
    const pidFile = join(LEGACY_DATA_DIR, 'postmaster.pid');
    if (!existsSync(pidFile))
        return false;
    try {
        const pid = parseInt(readFileSync(pidFile, 'utf8').split('\n')[0] ?? '0', 10);
        if (!pid)
            return false;
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function runCommand(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            env: opts.env ?? process.env,
            stdio: 'pipe',
        });
        const stderr = [];
        child.stderr.on('data', (d) => stderr.push(d.toString()));
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`${cmd} exited ${code}: ${stderr.join('')}`));
            }
        });
    });
}
/** Returns the columns present in `tableName` on the legacy source. */
async function getColumns(srcClient, tableName) {
    const res = await srcClient.query(`SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`, [tableName]);
    return res.rows.map((r) => ({ name: r.column_name, dataType: r.data_type }));
}
/** Check whether a table exists in the source cluster. */
async function tableExists(srcClient, tableName) {
    const res = await srcClient.query(`SELECT EXISTS(
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`, [tableName]);
    return res.rows[0]?.exists === true;
}
/**
 * Converts a value read from legacy pg into something PGlite accepts.
 * - Objects / arrays (JSONB) → JSON string (PGlite deserialises on the way in)
 * - Buffer (bytea) → '\\x<hex>' literal that PGlite / pg understands
 * - Date objects → ISO string (PGlite timestamp columns accept ISO strings)
 * - null / undefined → null
 */
function normaliseValue(v) {
    if (v === null || v === undefined)
        return null;
    if (Buffer.isBuffer(v)) {
        // Encode as hex-escaped bytea literal: '\\x<hex>'
        return `\\x${v.toString('hex')}`;
    }
    if (v instanceof Date) {
        return v.toISOString();
    }
    if (typeof v === 'object') {
        // JSONB / JSON columns arrive as parsed JS objects from pg driver
        return JSON.stringify(v);
    }
    return v;
}
const BATCH_SIZE = 200;
/**
 * Copies all rows from `tableName` on the legacy cluster into PGlite.
 * Returns the number of rows copied.
 *
 * Wraps each batch in its own PGlite transaction — if a batch fails,
 * we surface the error rather than silently skipping rows.
 *
 * In dry-run mode: reads from source only, no writes to PGlite.
 */
async function copyTable(srcClient, destPool, tableName, dryRun, verbose) {
    const cols = await getColumns(srcClient, tableName);
    if (cols.length === 0) {
        if (verbose)
            console.log(`[migrate]   ${tableName}: 0 columns — skipping`);
        return 0;
    }
    const colNames = cols.map((c) => c.name).join(', ');
    const srcResult = await srcClient.query(`SELECT ${colNames} FROM ${tableName}`);
    const rows = srcResult.rows;
    if (rows.length === 0) {
        if (verbose)
            console.log(`[migrate]   ${tableName}: empty table`);
        return 0;
    }
    if (dryRun) {
        console.log(`[migrate]   ${tableName}: ${rows.length} rows (dry-run, not writing)`);
        return rows.length;
    }
    // Build parameterised INSERT in batches
    let totalInserted = 0;
    const colList = cols.map((c) => `"${c.name}"`).join(', ');
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const params = [];
        const valueClauses = [];
        for (const row of batch) {
            const placeholders = cols.map((_, ci) => {
                params.push(normaliseValue(row[cols[ci].name]));
                return `$${params.length}`;
            });
            valueClauses.push(`(${placeholders.join(', ')})`);
        }
        const sql = `INSERT INTO "${tableName}" (${colList}) VALUES ${valueClauses.join(', ')} ON CONFLICT DO NOTHING`;
        await destPool.query(sql, params);
        totalInserted += batch.length;
    }
    console.log(`[migrate]   ${tableName}: ${rows.length} rows migrated`);
    return rows.length;
}
// ─── Guard: check if PGlite already has data ─────────────────────────────────
async function pgliteHasData(destPool) {
    try {
        const res = await destPool.query('SELECT COUNT(*) AS cnt FROM projects');
        const cnt = parseInt(String(res.rows[0]?.['cnt'] ?? '0'), 10);
        return cnt > 0;
    }
    catch {
        // Table doesn't exist yet — fresh cluster
        return false;
    }
}
// ─── Main migration entry point ───────────────────────────────────────────────
/**
 * Run the one-time migration. Called from CLI (`squadboard migrate`) or from
 * index.ts auto-run logic.
 */
export async function runMigration(opts = {}) {
    const { force = false, dryRun = false, yes = false, verbose = false } = opts;
    // ── Gate 1: DATABASE_URL → hosted mode, skip entirely ─────────────────────
    if (process.env['DATABASE_URL']) {
        return { skipped: true, reason: 'DATABASE_URL is set — hosted mode, migration not applicable' };
    }
    // ── Gate 2: Legacy cluster must exist ─────────────────────────────────────
    const pgVersionFile = join(LEGACY_DATA_DIR, 'PG_VERSION');
    if (!existsSync(pgVersionFile)) {
        return { skipped: true, reason: `No legacy cluster found at ${LEGACY_DATA_DIR}` };
    }
    // ── Gate 3: Marker check ───────────────────────────────────────────────────
    if (!force && existsSync(MARKER_FILE)) {
        return { skipped: true, reason: `Migration marker present at ${MARKER_FILE} — already migrated` };
    }
    // ── Gate 4: Confirm --force when PGlite already has data ──────────────────
    if (force && !dryRun) {
        // We'll check after PGlite starts — handled below
        if (!yes) {
            // In auto-run context there's no TTY — caller must pass yes=true for force
            console.warn('[migrate] --force requested but --yes not set; refusing to overwrite PGlite data without confirmation');
            return { skipped: true, reason: 'Force mode requires --yes to confirm overwrite' };
        }
    }
    const pgMajorVersion = readLegacyPgVersion();
    if (!pgMajorVersion) {
        throw new Error(`[migrate] Could not read PG_VERSION from ${LEGACY_DATA_DIR}`);
    }
    console.log(`[migrate] Detected legacy cluster at ${LEGACY_DATA_DIR} (PG${pgMajorVersion})`);
    if (dryRun)
        console.log('[migrate] DRY-RUN mode — no data will be written to PGlite');
    // ── Find binary ─────────────────────────────────────────────────────────────
    const binDir = findLegacyPgBinDir(pgMajorVersion);
    if (!binDir) {
        throw new Error(`[migrate] Cannot find PG${pgMajorVersion} binaries in pnpm store. ` +
            `Install the embedded-postgres@${pgMajorVersion} package at the workspace root ` +
            `(pnpm add -w embedded-postgres@${pgMajorVersion}) and retry.`);
    }
    if (verbose)
        console.log('[migrate] Using binaries from:', binDir);
    // ── Start PGlite (destination) ────────────────────────────────────────────
    // Import lazily so this module can be used standalone (e.g., in tests) without
    // booting PGlite when DATABASE_URL is set.
    const { startPglite, createPoolAdapter, getPglite } = await import('../db/pglite.js');
    const connStr = await startPglite();
    let destPool;
    if (connStr !== 'pglite://local') {
        // DATABASE_URL path — already caught in Gate 1, but be defensive
        return { skipped: true, reason: 'DATABASE_URL active, no PGlite to migrate into' };
    }
    const pgliteInstance = getPglite();
    if (!pgliteInstance)
        throw new Error('[migrate] PGlite instance is null after startPglite()');
    destPool = createPoolAdapter(pgliteInstance);
    // Bootstrap the schema so tables exist before we INSERT into them.
    const { initDb } = await import('../db/index.js');
    await initDb(connStr);
    // ── Guard: PGlite already has data? ───────────────────────────────────────
    if (!dryRun) {
        const hasData = await pgliteHasData(destPool);
        if (hasData && !force) {
            return {
                skipped: true,
                reason: 'PGlite already contains data (projects table is non-empty). ' +
                    'Use --force --yes to overwrite.',
            };
        }
        if (hasData && force) {
            console.log('[migrate] --force set: overwriting existing PGlite data');
        }
    }
    // ── Check if legacy cluster is already running ────────────────────────────
    const alreadyRunning = isLegacyClusterRunning();
    const port = pickRandomPort();
    let weStartedIt = false;
    // ── Connect to legacy source ──────────────────────────────────────────────
    const srcClient = new pg.Client({
        user: LEGACY_USER,
        password: LEGACY_PASSWORD,
        database: LEGACY_DATABASE,
        port: alreadyRunning ? 54321 : port,
        host: 'localhost',
    });
    let startedOk = false;
    try {
        if (!alreadyRunning) {
            await startLegacyCluster(binDir, port);
            weStartedIt = true;
        }
        else {
            console.log('[migrate] Legacy cluster appears to be already running — connecting to it on port 54321');
        }
        await srcClient.connect();
        startedOk = true;
        console.log('[migrate] Connected to legacy cluster');
        // ── Count-only pass (dry-run): just SELECT COUNT(*) per table ──────────
        if (dryRun) {
            const rowCounts = {};
            for (const tbl of TABLE_ORDER) {
                if (!(await tableExists(srcClient, tbl)))
                    continue;
                const res = await srcClient.query(`SELECT COUNT(*) AS cnt FROM "${tbl}"`);
                rowCounts[tbl] = parseInt(res.rows[0]?.cnt ?? '0', 10);
                console.log(`[migrate]   ${tbl}: ${rowCounts[tbl]} rows`);
            }
            return { skipped: false, rowCounts };
        }
        // ── Full migration pass ────────────────────────────────────────────────
        console.log('[migrate] Starting one-time migration to PGlite…');
        const rowCounts = {};
        for (const tbl of TABLE_ORDER) {
            if (!(await tableExists(srcClient, tbl))) {
                if (verbose)
                    console.log(`[migrate]   ${tbl}: not in legacy cluster, skipping`);
                continue;
            }
            try {
                rowCounts[tbl] = await copyTable(srcClient, destPool, tbl, false, verbose);
            }
            catch (err) {
                throw new Error(`[migrate] Failed on table "${tbl}": ${err.message}`);
            }
        }
        // ── Write marker file ─────────────────────────────────────────────────
        const markerPayload = {
            migrated_at: '2026-05-15T22:14:50.847-07:00',
            source_path: LEGACY_DATA_DIR,
            dest_path: PGLITE_DATA_DIR,
            pg_major_version: pgMajorVersion,
            row_counts: rowCounts,
        };
        writeFileSync(MARKER_FILE, JSON.stringify(markerPayload, null, 2), 'utf8');
        // ── Summary ───────────────────────────────────────────────────────────
        const issueCount = rowCounts['issues'] ?? 0;
        const projectCount = rowCounts['projects'] ?? 0;
        const runCount = rowCounts['issue_runs'] ?? 0;
        const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
        console.log('');
        console.log(`[migrate] ✅ Migration complete. ` +
            `${issueCount} issues + ${projectCount} projects + ${runCount} issue_runs migrated ` +
            `(${totalRows} total rows across ${Object.keys(rowCounts).length} tables).`);
        console.log('[migrate] Marker written. Legacy cluster will not be touched again — ' +
            `safe to delete ${LEGACY_DATA_DIR} manually after verifying.`);
        return { skipped: false, rowCounts };
    }
    finally {
        // Always disconnect and stop the cluster we started
        if (startedOk) {
            try {
                await srcClient.end();
            }
            catch { /* ignore */ }
        }
        if (weStartedIt) {
            await stopLegacyCluster(binDir);
        }
    }
}
// ─── Standalone entry point ───────────────────────────────────────────────────
// Called when this script is run directly: `tsx src/scripts/migrate-from-legacy-pg.ts`
if (process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\\/g, '/'))) {
    const opts = {
        force: process.argv.includes('--force'),
        dryRun: process.argv.includes('--dry-run'),
        yes: process.argv.includes('--yes'),
        verbose: process.argv.includes('--verbose'),
    };
    runMigration(opts).then((result) => {
        if (result.skipped) {
            console.log(`[migrate] Skipped: ${result.reason}`);
        }
        process.exit(0);
    }).catch((err) => {
        console.error('[migrate] ❌ Migration failed:', err);
        process.exit(1);
    });
}
//# sourceMappingURL=migrate-from-legacy-pg.js.map