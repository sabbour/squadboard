import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = join(homedir(), '.squadboard', 'data');
const PG_PORT = 54_321;
const PG_USER = 'squadboard';
const PG_PASSWORD = 'squadboard';
const PG_DATABASE = 'squadboard';

let pg: EmbeddedPostgres | null = null;

/**
 * Returns true when the thrown value is the embedded-postgres "init script
 * exited with code 127" sentinel — which means the postgres binary could not
 * be loaded due to missing shared libraries (e.g. libpq.so.5, libicuuc.so.60
 * on linux/arm64).  The library throws a plain string, not an Error.
 */
function isEmbeddedBinaryFailure(err: unknown): boolean {
  const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  return msg.includes('exited with code 127');
}

/**
 * Attempts to connect to a Postgres instance that is already running on the
 * given host/port.  Returns true if the connection succeeds, false otherwise.
 */
async function isPostgresReachable(
  host: string,
  port: number,
  user: string,
  password: string,
): Promise<boolean> {
  const client = new Client({
    host,
    port,
    user,
    password,
    database: 'postgres',
    connectionTimeoutMillis: 2_000,
  });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

export async function startEmbeddedPostgres(): Promise<string> {
  const startMs = Date.now();
  console.log(
    `[postgres] platform=${process.platform} arch=${process.arch} ` +
      `port=${PG_PORT} dataDir=${DATA_DIR}`,
  );

  // ── Path 1: explicit DATABASE_URL overrides everything ──────────────────
  const envUrl = process.env['DATABASE_URL'];
  if (envUrl) {
    console.log('[postgres] DATABASE_URL set — skipping embedded postgres, using provided connection');
    return envUrl;
  }

  // ── Path 2: try the embedded binary ─────────────────────────────────────
  try {
    pg = new EmbeddedPostgres({
      databaseDir: DATA_DIR,
      user: PG_USER,
      password: PG_PASSWORD,
      port: PG_PORT,
      persistent: true,
    });

    await pg.initialise();
    await pg.start();
    await ensureDatabase();

    const elapsed = Date.now() - startMs;
    console.log(`[postgres] started in ${elapsed}ms`);
    return getConnectionString();
  } catch (err: unknown) {
    if (!isEmbeddedBinaryFailure(err)) {
      // Real unexpected error — surface it immediately.
      throw err;
    }
    pg = null;
    console.warn(
      `[postgres] embedded-postgres binary cannot run on ${process.platform}/${process.arch} ` +
        '(init script exited 127 — likely missing libpq.so.5 or libicuuc.so.60). ' +
        'Falling back to system Postgres…',
    );
  }

  // ── Path 3: embedded binary unavailable — check if Postgres is already
  //    running on our configured port ───────────────────────────────────────
  const reachable = await isPostgresReachable('localhost', PG_PORT, PG_USER, PG_PASSWORD);
  if (reachable) {
    console.log(`[postgres] found existing Postgres on port ${PG_PORT}, using it`);
    await ensureDatabase();
    return getConnectionString();
  }

  // ── Path 4: nothing works — emit a clear, actionable error ───────────────
  throw new Error(
    `[postgres] embedded-postgres is not available for ${process.platform}/${process.arch} ` +
      '(missing system shared libraries libpq.so.5 and/or libicuuc.so.60).\n\n' +
      'To run Squadboard on linux/arm64, choose one of:\n' +
      '  • Set DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/squadboard\n' +
      '    and ensure Postgres is running (e.g. sudo apt install postgresql)\n' +
      `  • Or start Postgres manually on port ${PG_PORT} with user "${PG_USER}" / password "${PG_PASSWORD}"`,
  );
}

/**
 * Ensures the squadboard database exists. Safe to call on repeated starts.
 */
async function ensureDatabase(): Promise<void> {
  const client = new Client({
    host: 'localhost',
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: 'postgres',
  });

  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${PG_DATABASE}`);
    console.log(`[postgres] database '${PG_DATABASE}' created`);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('already exists')
    ) {
      console.log(`[postgres] database '${PG_DATABASE}' already exists`);
    } else {
      throw err;
    }
  } finally {
    await client.end();
  }
}

export function getConnectionString(): string {
  return `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DATABASE}`;
}

export async function stopEmbeddedPostgres(): Promise<void> {
  if (pg) {
    await pg.stop();
    pg = null;
    console.log('[postgres] stopped');
  }
}

function registerShutdownHandlers(): void {
  const shutdown = (signal: string) => {
    console.log(`[postgres] received ${signal}, shutting down`);
    stopEmbeddedPostgres()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error('[postgres] error during shutdown:', err);
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

registerShutdownHandlers();
