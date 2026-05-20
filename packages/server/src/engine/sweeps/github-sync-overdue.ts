/**
 * sweeps/github-sync-overdue.ts — Phase 3 Heartbeat
 *
 * Finds GitHub-connected projects whose last successful pull
 * (githubSyncLastAt) is more than 5 minutes ago and triggers an incremental
 * pull for each. Projects with no lastSyncAt (never synced) are also
 * included.
 *
 * Note: the existing startSyncLoop() mechanism handles per-project polling
 * loops. This sweep is a catch-up layer for projects whose sync loop may
 * have been skipped (e.g. because the loop wasn't started yet, or the
 * project was just enabled). It does NOT start a new loop; it triggers a
 * one-off pull directly.
 *
 * Runs every 120 s by default.
 */
import type { Sweep, SweepResult } from '../heartbeat.js';
import { getDb, schema } from '../../db/index.js';
import { and, eq, or, isNull, lt } from 'drizzle-orm';
import { GitHubSync } from '../../github/sync.js';

const OVERDUE_AFTER_MS = 5 * 60_000; // 5 minutes

export const githubSyncOverdueSweep: Sweep = {
  id: 'github-sync-overdue',
  label: 'GitHub sync',
  description: 'Runs catch-up pulls for GitHub-connected projects whose sync loop is overdue.',
  scope: 'project',
  intervalMs: 120_000,
  enabled: true,

  async run(): Promise<SweepResult> {
    const db = getDb();
    const cutoff = new Date(Date.now() - OVERDUE_AFTER_MS);

    const projects = await db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.githubSyncEnabled, true),
          or(
            isNull(schema.projects.githubSyncLastAt),
            lt(schema.projects.githubSyncLastAt, cutoff),
          ),
        ),
      );

    let acted = 0;
    let errors = 0;
    const projectIds: string[] = [];

    for (const project of projects) {
      if (!project.githubOwner || !project.githubRepo) continue;
      projectIds.push(project.id);
      try {
        const sync = await GitHubSync.fromProject(project.id, project);
        const since = project.githubSyncLastAt?.toISOString();
        await sync.pullChanges(since);
        acted += 1;
      } catch (err) {
        errors += 1;
        console.error(`[sweep:github-sync-overdue] pull failed for project ${project.id}:`, err);
      }
    }

    return { acted, errors, projectIds };
  },
};
