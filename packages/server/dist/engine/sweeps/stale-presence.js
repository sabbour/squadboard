import { sweepStalePresence } from '../../realtime/presence.js';
const MAX_PRESENCE_AGE_MS = 60_000; // 60 seconds
export const stalePresenceSweep = {
    id: 'stale-presence',
    intervalMs: 30_000,
    enabled: true,
    async run() {
        const evicted = sweepStalePresence(MAX_PRESENCE_AGE_MS);
        return { acted: evicted, errors: 0 };
    },
};
//# sourceMappingURL=stale-presence.js.map