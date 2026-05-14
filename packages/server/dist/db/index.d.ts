import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;
type Db = DrizzleDb;
/**
 * Initialise the Drizzle DB connection. Must be called after
 * `startEmbeddedPostgres()` resolves. Also bootstraps the schema
 * so Demo 1 works without a separate `pnpm db:push` step.
 */
export declare function initDb(connectionString: string): Promise<void>;
/**
 * Returns the raw pg Pool (for raw-SQL transactions that Drizzle can't handle).
 * Throws if called before `initDb()`.
 */
export declare function getPool(): Pool;
/**
 * Returns the initialised Drizzle DB instance.
 * Throws if called before `initDb()`.
 */
export declare function getDb(): Db;
export declare function closeDb(): Promise<void>;
export { schema };
//# sourceMappingURL=index.d.ts.map