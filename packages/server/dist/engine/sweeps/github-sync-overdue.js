import { getDb, schema } from '../../db/index.js';
import { and, eq, or, isNull, lt } from 'drizzle-orm';
import { GitHubSync } from '../../github/sync.js';
const OVERDUE_AFTER_MS = 5 * 60_000; // 5 minutes
export const githubSyncOverdueSweep = {
    id: 'github-sync-overdue',
    intervalMs: 60_000,
    enabled: true,
    async run() {
        const db = getDb();
        const cutoff = new Date(Date.now() - OVERDUE_AFTER_MS);
        const projects = await db
            .select()
            .from(schema.projects)
            .where(and(eq(schema.projects.githubSyncEnabled, true), or(isNull(schema.projects.githubSyncLastAt), lt(schema.projects.githubSyncLastAt, cutoff))));
        let acted = 0;
        let errors = 0;
        for (const project of projects) {
            if (!project.githubOwner || !project.githubRepo)
                continue;
            try {
                const sync = await GitHubSync.fromProject(project.id, project);
                const since = project.githubSyncLastAt?.toISOString();
                await sync.pullChanges(since);
                acted += 1;
            }
            catch (err) {
                errors += 1;
                console.error(`[sweep:github-sync-overdue] pull failed for project ${project.id}:`, err);
            }
        }
        return { acted, errors };
    },
};
//# sourceMappingURL=github-sync-overdue.js.map