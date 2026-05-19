import { and, desc, eq, ilike, inArray, isNotNull, sql } from 'drizzle-orm';
import { getDb, getPool, schema } from '../db/index.js';

// ColumnStatus is widened to string — columns are now per-project dynamic.
// Validation against column_meta happens via assertColumnExists().
export type ColumnStatus = string;

export interface ListIssuesFilters {
  status?: ColumnStatus;
  labelId?: string;
  search?: string;
}

// ---------------------------------------------------------------------------
// Column validation helpers
// ---------------------------------------------------------------------------

/**
 * Throws a 400 error if `columnId` is not found in the project's column_meta.
 * Call this before any write that targets a column slug.
 */
export async function assertColumnExists(projectId: string, columnId: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ column_id: string }>(
    `SELECT column_id FROM column_meta WHERE project_id = $1 AND column_id = $2`,
    [projectId, columnId],
  );
  if (rows.length === 0) {
    throw Object.assign(
      new Error(`Column '${columnId}' does not exist for this project`),
      { status: 400 },
    );
  }
}

/**
 * Returns the slug of the project's default column (is_default=true).
 * Falls back to the lowest-position column, then to 'backlog' if the table is empty.
 */
async function getDefaultColumnId(projectId: string): Promise<string> {
  const pool = getPool();
  const { rows: defRows } = await pool.query<{ column_id: string }>(
    `SELECT column_id FROM column_meta
     WHERE project_id = $1 AND is_default = true
     ORDER BY position ASC LIMIT 1`,
    [projectId],
  );
  if (defRows.length > 0) return defRows[0].column_id;

  const { rows: posRows } = await pool.query<{ column_id: string }>(
    `SELECT column_id FROM column_meta WHERE project_id = $1 ORDER BY position ASC LIMIT 1`,
    [projectId],
  );
  return posRows.length > 0 ? posRows[0].column_id : 'backlog';
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export async function listIssues(projectId: string, filters: ListIssuesFilters = {}) {
  const db = getDb();
  const { issues, issueLabels, labels, issueRuns } = schema;

  const conditions = [
    eq(issues.projectId, projectId),
    eq(issues.archived, 0),
  ];

  if (filters.status) {
    conditions.push(eq(issues.status, filters.status));
  }
  if (filters.search) {
    conditions.push(ilike(issues.title, `%${filters.search}%`));
  }

  let rows = await db
    .select()
    .from(issues)
    .where(and(...conditions))
    .orderBy(issues.status, issues.position);

  if (filters.labelId) {
    const tagged = await db
      .select({ issueId: issueLabels.issueId })
      .from(issueLabels)
      .where(eq(issueLabels.labelId, filters.labelId));
    const taggedIds = new Set(tagged.map((r) => r.issueId));
    rows = rows.filter((r) => taggedIds.has(r.id));
  }

  // Batch-fetch labels for all issues
  const issueIds = rows.map((r) => r.id);
  const labelRows = issueIds.length > 0
    ? await db
        .select({ issueId: issueLabels.issueId, label: labels })
        .from(issueLabels)
        .innerJoin(labels, eq(issueLabels.labelId, labels.id))
        .where(inArray(issueLabels.issueId, issueIds))
    : [];

  const labelsByIssueId = new Map<string, typeof labels.$inferSelect[]>();
  for (const row of labelRows) {
    const existing = labelsByIssueId.get(row.issueId) ?? [];
    existing.push(row.label);
    labelsByIssueId.set(row.issueId, existing);
  }

  const assigneeIds = [...new Set(rows.map((r) => r.assigneeId).filter((id): id is string => Boolean(id)))];
  const assigneeRows = assigneeIds.length > 0
    ? await db
        .select({ id: schema.agents.id, name: schema.agents.name, role: schema.agents.role })
        .from(schema.agents)
        .where(inArray(schema.agents.id, assigneeIds))
    : [];
  const assigneesById = new Map(assigneeRows.map((agent) => [agent.id, agent]));

  // Stream G Phase 2A (G2.6): Batch-fetch the most recent worktree run with git data per issue.
  // Uses a raw SQL DISTINCT ON (issue_id) ordered by created_at DESC — the most efficient pattern
  // for "latest row per group" in Postgres without a lateral join.
  const githubByIssueId = new Map<string, GitHubBlock>();
  if (issueIds.length > 0) {
    const pool = getPool();
    const placeholders = issueIds.map((_, i) => `$${i + 1}`).join(', ');
    const { rows: gitRows } = await pool.query<{
      issue_id: string;
      id: string;
      git_branch: string | null;
      git_branch_url: string | null;
      pr_number: number | null;
      pr_url: string | null;
      pr_state: string | null;
      ci_state: string | null;
      ci_url: string | null;
      git_cache_refreshed_at: Date | null;
    }>(
      `SELECT DISTINCT ON (issue_id)
         issue_id, id,
         git_branch, git_branch_url,
         pr_number, pr_url, pr_state,
         ci_state, ci_url, git_cache_refreshed_at
       FROM issue_runs
       WHERE issue_id IN (${placeholders})
         AND workspace_strategy = 'worktree'
         AND git_branch IS NOT NULL
       ORDER BY issue_id, created_at DESC`,
      issueIds,
    );

    for (const r of gitRows) {
      const block: GitHubBlock = {};
      if (r.git_branch) {
        block.branch = r.git_branch;
        if (r.git_branch_url) block.branchUrl = r.git_branch_url;
      }
      if (r.pr_number) {
        block.pr = {
          number: r.pr_number,
          state: (r.pr_state ?? 'open') as GitHubBlock['pr'] extends infer P ? (P extends { state: infer S } ? S : never) : never,
          url: r.pr_url ?? '',
        };
      }
      if (r.ci_state) {
        block.ci = {
          state: r.ci_state as GitHubBlock['ci'] extends infer C ? (C extends { state: infer S } ? S : never) : never,
          url: r.ci_url ?? undefined,
        };
      }
      if (Object.keys(block).length > 0) {
        githubByIssueId.set(r.issue_id, block);

        // 5-minute soft TTL for CI state: trigger background refresh if stale
        if (r.pr_number && r.pr_state !== 'merged' && r.pr_state !== 'closed') {
          const refreshedAt = r.git_cache_refreshed_at ? new Date(r.git_cache_refreshed_at).getTime() : 0;
          const age = Date.now() - refreshedAt;
          if (age > 5 * 60 * 1_000) {
            // Fire-and-forget: refresh CI state in the background
            void refreshCiState(r.id, r.pr_number);
          }
        }
      }
    }
  }

  return rows.map((r) => ({
    ...r,
    labels: labelsByIssueId.get(r.id) ?? [],
    assignee: r.assigneeId ? (assigneesById.get(r.assigneeId) ?? null) : null,
    github: githubByIssueId.get(r.id) ?? null,
  }));
}

/**
 * G2.6 GitHub data block per card.
 */
export interface GitHubBlock {
  branch?: string;
  branchUrl?: string;
  pr?: {
    number: number;
    state: 'open' | 'draft' | 'merged' | 'closed';
    url: string;
  };
  ci?: {
    state: 'passing' | 'failing' | 'running' | 'unknown';
    url?: string;
  };
}

/**
 * Background CI refresh — called when the 5-min TTL expires on a run's cached CI state.
 * Runs `gh pr checks <prNumber> --json name,state,conclusion` and updates the run record.
 * Fire-and-forget; never throws.
 */
async function refreshCiState(runId: string, prNumber: number): Promise<void> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const db = getDb();
    const [run] = await db
      .select({ workspacePath: schema.issueRuns.workspacePath })
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.id, runId))
      .limit(1);

    if (!run?.workspacePath) return;

    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'checks', String(prNumber), '--json', 'name,state,conclusion'],
      { cwd: run.workspacePath, timeout: 30_000 },
    );

    interface CheckRow { name: string; state: string; conclusion: string }
    const checks: CheckRow[] = JSON.parse(stdout.trim()) as CheckRow[];

    let ciState: 'passing' | 'failing' | 'running' | 'unknown' = 'unknown';
    if (checks.length === 0) {
      ciState = 'unknown';
    } else if (checks.some((c) => c.state === 'IN_PROGRESS' || c.state === 'QUEUED')) {
      ciState = 'running';
    } else if (checks.every((c) => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED')) {
      ciState = 'passing';
    } else {
      ciState = 'failing';
    }

    await db
      .update(schema.issueRuns)
      .set({ ciState, gitCacheRefreshedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.issueRuns.id, runId));
  } catch {
    // Non-fatal — stale cache is acceptable
  }
}

export async function getIssue(projectId: string, id: string) {
  const db = getDb();
  const { issues, comments, issueLabels, labels, agents } = schema;

  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, id), eq(issues.projectId, projectId)));

  if (!issue) return null;

  const issueComments = await db
    .select()
    .from(comments)
    .where(eq(comments.issueId, id))
    .orderBy(comments.createdAt);

  const issueLabelsRows = await db
    .select({ label: labels })
    .from(issueLabels)
    .innerJoin(labels, eq(issueLabels.labelId, labels.id))
    .where(eq(issueLabels.issueId, id));

  const [assignee] = issue.assigneeId
    ? await db
        .select({ id: agents.id, name: agents.name, role: agents.role })
        .from(agents)
        .where(eq(agents.id, issue.assigneeId))
        .limit(1)
    : [];

  return {
    ...issue,
    comments: issueComments,
    labels: issueLabelsRows.map((r) => r.label),
    assignee: assignee ?? null,
  };
}

/**
 * Unified issue-creation handler. One handler, three adapters (MCP / HTTP / CLI).
 *
 * Idempotency: when `idempotencyKey` is provided the check matches on
 * `projectId + title == '[key] title'` — no time window. Without a key, a
 * 60-second soft dedup guards against runaway fan-out retries on the HTTP path.
 *
 * Column validation is the caller's responsibility (HTTP route calls
 * assertColumnExists before delegating here; MCP + CLI use inert statuses
 * that must pre-exist, or 'backlog' which always exists).
 */
export async function createIssue(input: {
  projectId: string;
  title: string;
  body?: string;
  status?: 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done';
  position?: number;
  archived?: boolean;
  completedAt?: Date | null;
  assigneeId?: string | null;
  labels?: string[];           // label IDs
  idempotencyKey?: string;
  createdBy?: string;          // 'user' | 'cli' | 'mcp' | 'bulk-import'
}): Promise<{ created: boolean; id: string; issue?: typeof schema.issues.$inferSelect; idempotencyKey?: string }> {
  const db = getDb();
  const { issues, issueLabels } = schema;

  if (!input.title?.trim()) {
    throw Object.assign(new Error('`title` is required'), { status: 400 });
  }

  const rawTitle = input.title.trim();
  const insertTitle = input.idempotencyKey
    ? `[${input.idempotencyKey}] ${rawTitle}`
    : rawTitle;

  // I7: Column-based idempotency — check (project_id, idempotency_key) index first.
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.projectId, input.projectId),
          eq(issues.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (existing) {
      return { created: false, id: existing.id, issue: existing, idempotencyKey: input.idempotencyKey };
    }
  } else {
    // Soft 60-second dedup guard for callers without an explicit key.
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    const [recent] = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.projectId, input.projectId),
          eq(issues.title, insertTitle),
          eq(issues.archived, 0),
          sql`${issues.createdAt} >= ${sixtySecondsAgo}`,
        ),
      )
      .limit(1);

    if (recent) {
      console.warn(
        `[createIssue] dedup hit — returning existing issue ${recent.id} ` +
        `(title="${insertTitle}", project=${input.projectId}). Possible duplicate caller.`,
      );
      return { created: false, id: recent.id, issue: recent };
    }
  }

  const status = input.status ?? 'backlog';

  // Compute position: explicit > max+1 in target column.
  let position: number;
  if (input.position !== undefined) {
    position = input.position;
  } else {
    const [maxRow] = await db
      .select({ maxPos: sql<number>`COALESCE(MAX(${issues.position}), -1)` })
      .from(issues)
      .where(and(eq(issues.projectId, input.projectId), eq(issues.status, status), eq(issues.archived, 0)));
    position = (maxRow?.maxPos ?? -1) + 1;
  }

  // completedAt: set when status='done' explicitly or caller supplies it.
  const completedAt =
    input.completedAt !== undefined
      ? input.completedAt
      : status === 'done'
        ? new Date()
        : null;

  const [created] = await db
    .insert(issues)
    .values({
      projectId: input.projectId,
      title: insertTitle,
      body: input.body ?? '',
      status,
      assigneeId: input.assigneeId ?? null,
      position,
      archived: input.archived ? 1 : 0,
      completedAt: completedAt ?? undefined,
      createdBy: input.createdBy ?? 'user',
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    })
    .returning();

  // Insert label associations if provided.
  if (input.labels && input.labels.length > 0) {
    await db.insert(issueLabels).values(
      input.labels.map((labelId) => ({ issueId: created.id, labelId })),
    );
  }

  return { created: true, id: created.id, issue: created, idempotencyKey: input.idempotencyKey };
}

export async function updateIssue(projectId: string, id: string, data: {
  title?: string;
  body?: string;
  status?: ColumnStatus;
  assigneeId?: string | null;
}) {
  const db = getDb();
  const { issues } = schema;

  const [existing] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, id), eq(issues.projectId, projectId)));

  if (!existing || existing.archived === 1) return null;

  const patch: Partial<typeof issues.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (data.title !== undefined) patch.title = data.title.trim();
  if (data.body !== undefined) patch.body = data.body;
  if (data.status !== undefined) patch.status = data.status;
  if ('assigneeId' in data) patch.assigneeId = data.assigneeId ?? undefined;

  const [updated] = await db
    .update(issues)
    .set(patch)
    .where(eq(issues.id, id))
    .returning();

  return updated;
}

export async function archiveIssue(projectId: string, id: string) {
  const db = getDb();
  const { issues } = schema;

  const [existing] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, id), eq(issues.projectId, projectId)));

  if (!existing) return null;

  const [updated] = await db
    .update(issues)
    .set({ archived: 1, updatedAt: new Date() })
    .where(eq(issues.id, id))
    .returning();

  return updated;
}

export async function moveIssue(projectId: string, id: string, newStatus: ColumnStatus, position?: number) {
  const db = getDb();
  const { issues } = schema;

  // Validate the target column exists for this project.
  await assertColumnExists(projectId, newStatus);

  const [existing] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, id), eq(issues.projectId, projectId)));

  if (!existing || existing.archived === 1) return null;

  // Determine target position
  let targetPosition: number;
  if (position !== undefined && position >= 0) {
    targetPosition = position;
  } else {
    const [maxRow] = await db
      .select({ maxPos: sql<number>`COALESCE(MAX(${issues.position}), -1)` })
      .from(issues)
      .where(and(eq(issues.projectId, projectId), eq(issues.status, newStatus), eq(issues.archived, 0)));
    targetPosition = (maxRow?.maxPos ?? -1) + 1;
  }

  // Shift items in the target column at or above targetPosition to make room
  if (existing.status !== newStatus || existing.position !== targetPosition) {
    await db
      .update(issues)
      .set({ position: sql`${issues.position} + 1` })
      .where(
        and(
          eq(issues.projectId, projectId),
          eq(issues.status, newStatus),
          eq(issues.archived, 0),
          sql`${issues.position} >= ${targetPosition}`,
          sql`${issues.id} != ${id}`,
        ),
      );
  }

  const [moved] = await db
    .update(issues)
    .set({ status: newStatus, position: targetPosition, updatedAt: new Date() })
    .where(eq(issues.id, id))
    .returning();

  // Compact positions in the old column if the issue moved columns
  if (existing.status !== newStatus) {
    await compactPositions(projectId, existing.status);
  }

  return moved;
}

async function compactPositions(projectId: string, status: ColumnStatus) {
  const db = getDb();
  const { issues } = schema;

  const rows = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.projectId, projectId), eq(issues.status, status), eq(issues.archived, 0)))
    .orderBy(issues.position);

  for (let i = 0; i < rows.length; i++) {
    await db
      .update(issues)
      .set({ position: i })
      .where(eq(issues.id, rows[i].id));
  }
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

export async function bulkAction(
  projectId: string,
  action: 'move' | 'label' | 'archive',
  issueIds: string[],
  payload?: { status?: ColumnStatus; labelIds?: string[] },
) {
  const db = getDb();
  const { issues, issueLabels } = schema;

  if (!issueIds.length) return { affected: 0 };

  // Verify all issues belong to this project
  const owned = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.projectId, projectId), inArray(issues.id, issueIds)));

  const validIds = owned.map((r) => r.id);
  if (!validIds.length) return { affected: 0 };

  if (action === 'archive') {
    await db
      .update(issues)
      .set({ archived: 1, updatedAt: new Date() })
      .where(inArray(issues.id, validIds));
    return { affected: validIds.length };
  }

  if (action === 'move') {
    const newStatus = payload?.status;
    if (!newStatus) throw Object.assign(new Error('`status` required for move action'), { status: 400 });
    for (const issueId of validIds) {
      await moveIssue(projectId, issueId, newStatus);
    }
    return { affected: validIds.length };
  }

  if (action === 'label') {
    const labelIds = payload?.labelIds;
    if (!labelIds) throw Object.assign(new Error('`labelIds` required for label action'), { status: 400 });
    for (const issueId of validIds) {
      // Replace all labels on these issues
      await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
      if (labelIds.length) {
        await db.insert(issueLabels).values(labelIds.map((labelId) => ({ issueId, labelId })));
      }
    }
    return { affected: validIds.length };
  }

  throw Object.assign(new Error(`Unknown action: ${action as string}`), { status: 400 });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export type CommentAuthorKind = 'human' | 'agent' | 'system';

export interface CommentInput {
  body: string;
  authorKind?: CommentAuthorKind;
  authorRef?: string | null;
  authorId?: string | null;
  mentions?: string[];
}

export async function listComments(issueId: string) {
  const db = getDb();
  // Enrich with agent metadata for `authorKind = 'agent'` comments so the
  // client doesn't have to join in JS. Human + system rows pass through as-is.
  const rows = await db
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.issueId, issueId))
    .orderBy(schema.comments.createdAt);

  const agentIds = Array.from(
    new Set(
      rows
        .filter((r) => r.authorKind === 'agent' && typeof r.authorRef === 'string' && r.authorRef.length > 0)
        .map((r) => r.authorRef as string),
    ),
  );

  let agentMap = new Map<string, { id: string; name: string; role: string }>();
  if (agentIds.length > 0) {
    // authorRef may be either an agent UUID or an agent name (mention dispatch
    // writes the agent name as authorRef). Look up by both.
    const byId = await db
      .select({ id: schema.agents.id, name: schema.agents.name, role: schema.agents.role })
      .from(schema.agents)
      .where(inArray(schema.agents.id, agentIds.filter((s) => /^[0-9a-f-]{36}$/i.test(s))));
    const byName = await db
      .select({ id: schema.agents.id, name: schema.agents.name, role: schema.agents.role })
      .from(schema.agents)
      .where(inArray(schema.agents.name, agentIds.filter((s) => !/^[0-9a-f-]{36}$/i.test(s))));
    agentMap = new Map([...byId, ...byName].flatMap((a) => [
      [a.id, a],
      [a.name, a],
    ]));
  }

  return rows.map((r) => {
    const isAgent = r.authorKind === 'agent';
    const agent = isAgent && r.authorRef ? agentMap.get(r.authorRef) : undefined;
    return {
      ...r,
      authorName: agent?.name ?? (r.authorKind === 'human' ? 'You' : null),
      authorRole: agent?.role ?? null,
      agentId: agent?.id ?? null,
    };
  });
}

export async function addComment(issueId: string, input: CommentInput | string, legacyAuthorId?: string) {
  // Backward-compat: callers that passed (issueId, body, authorId) still work.
  const payload: CommentInput =
    typeof input === 'string'
      ? { body: input, authorId: legacyAuthorId ?? null }
      : input;

  if (!payload.body?.trim()) {
    throw Object.assign(new Error('`body` is required'), { status: 400 });
  }
  const authorKind: CommentAuthorKind = payload.authorKind ?? 'human';
  if (!['human', 'agent', 'system'].includes(authorKind)) {
    throw Object.assign(new Error('`authorKind` must be human|agent|system'), { status: 400 });
  }
  const mentions = Array.isArray(payload.mentions) ? payload.mentions.filter((m) => typeof m === 'string') : [];

  const db = getDb();
  const [created] = await db
    .insert(schema.comments)
    .values({
      issueId,
      body: payload.body.trim(),
      authorId: payload.authorId ?? null,
      authorKind,
      authorRef: payload.authorRef ?? null,
      mentions,
    })
    .returning();
  return created;
}

/**
 * Append a structured `system` comment to an issue thread.
 *
 * Use for run-lifecycle events, deliverable submissions, review verdicts,
 * heartbeat notifications, etc. The body is the human-readable summary
 * shown inline; eventKind + eventPayload give the UI enough metadata to
 * render the entry with the right icon and link to the underlying thing.
 *
 * Idempotent at the call-site: heartbeats that fire repeatedly should
 * gate their own emit with a marker (see review-timeout-sweep).
 */
export async function appendSystemComment(opts: {
  issueId: string;
  eventKind: string;
  summary: string;
  eventPayload?: Record<string, unknown>;
  authorRef?: string | null;
}) {
  const db = getDb();
  const [created] = await db
    .insert(schema.comments)
    .values({
      issueId: opts.issueId,
      body: opts.summary,
      authorId: null,
      authorKind: 'system',
      authorRef: opts.authorRef ?? opts.eventKind,
      mentions: [],
      eventKind: opts.eventKind,
      eventPayload: (opts.eventPayload ?? {}) as Record<string, unknown>,
    })
    .returning();
  return created;
}

export async function deleteComment(issueId: string, commentId: string) {
  const db = getDb();
  const [deleted] = await db
    .delete(schema.comments)
    .where(and(eq(schema.comments.id, commentId), eq(schema.comments.issueId, issueId)))
    .returning();
  return deleted ?? null;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export async function listLabels(projectId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.labels)
    .where(eq(schema.labels.projectId, projectId))
    .orderBy(schema.labels.name);
}

export async function createLabel(projectId: string, name: string, color?: string) {
  if (!name?.trim()) {
    throw Object.assign(new Error('`name` is required'), { status: 400 });
  }
  const db = getDb();
  const [created] = await db
    .insert(schema.labels)
    .values({ projectId, name: name.trim(), color: color ?? '#388bfd' })
    .returning();
  return created;
}

export async function setIssueLabels(projectId: string, issueId: string, labelIds: string[]) {
  const db = getDb();
  const { issues, issueLabels } = schema;

  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.projectId, projectId)));

  if (!issue || issue.archived === 1) return null;

  await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));

  if (labelIds.length) {
    await db.insert(issueLabels).values(labelIds.map((labelId) => ({ issueId, labelId })));
  }

  return { issueId, labelIds };
}
