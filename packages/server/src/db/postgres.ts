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

export async function startEmbeddedPostgres(): Promise<string> {
  const startMs = Date.now();
  console.log(
    `[postgres] platform=${process.platform} arch=${process.arch} ` +
      `port=${PG_PORT} dataDir=${DATA_DIR}`,
  );

  // DATABASE_URL overrides embedded postgres entirely (useful for CI / production).
  const envUrl = process.env['DATABASE_URL'];
  if (envUrl) {
    console.log('[postgres] DATABASE_URL set — using provided connection');
    return envUrl;
  }

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
