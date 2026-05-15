import { getDb, schema } from '../../db/index.js';
import { and, eq, lt } from 'drizzle-orm';
const IDLE_AFTER_MS = 10 * 60_000; // 10 minutes
export const idleLiveSessionsSweep = {
    id: 'idle-live-sessions',
    intervalMs: 60_000,
    enabled: true,
    async run() {
        const db = getDb();
        const cutoff = new Date(Date.now() - IDLE_AFTER_MS);
        const result = await db
            .update(schema.liveSessions)
            .set({ status: 'idle', updatedAt: new Date() })
            .where(and(eq(schema.liveSessions.status, 'active'), 
        // updatedAt is the proxy for last activity — no separate lastActivityAt column.
        lt(schema.liveSessions.updatedAt, cutoff)))
            .returning({ id: schema.liveSessions.id });
        return { acted: result.length, errors: 0 };
    },
};
//# sourceMappingURL=idle-live-sessions.js.map