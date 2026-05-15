import { and, eq, ilike, inArray, sql } from 'drizzle-orm';
import { getDb, getPool, schema } from '../db/index.js';
// ---------------------------------------------------------------------------
// Column validation helpers
// ---------------------------------------------------------------------------
/**
 * Throws a 400 error if `columnId` is not found in the project's column_meta.
 * Call this before any write that targets a column slug.
 */
export async function assertColumnExists(projectId, columnId) {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT column_id FROM column_meta WHERE project_id = $1 AND column_id = $2`, [projectId, columnId]);
    if (rows.length === 0) {
        throw Object.assign(new Error(`Column '${columnId}' does not exist for this project`), { status: 400 });
    }
}
/**
 * Returns the slug of the project's default column (is_default=true).
 * Falls back to the lowest-position column, then to 'backlog' if the table is empty.
 */
async function getDefaultColumnId(projectId) {
    const pool = getPool();
    const { rows: defRows } = await pool.query(`SELECT column_id FROM column_meta
     WHERE project_id = $1 AND is_default = true
     ORDER BY position ASC LIMIT 1`, [projectId]);
    if (defRows.length > 0)
        return defRows[0].column_id;
    const { rows: posRows } = await pool.query(`SELECT column_id FROM column_meta WHERE project_id = $1 ORDER BY position ASC LIMIT 1`, [projectId]);
    return posRows.length > 0 ? posRows[0].column_id : 'backlog';
}
// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------
export async function listIssues(projectId, filters = {}) {
    const db = getDb();
    const { issues, issueLabels, labels } = schema;
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
    const labelsByIssueId = new Map();
    for (const row of labelRows) {
        const existing = labelsByIssueId.get(row.issueId) ?? [];
        existing.push(row.label);
        labelsByIssueId.set(row.issueId, existing);
    }
    return rows.map((r) => ({ ...r, labels: labelsByIssueId.get(r.id) ?? [] }));
}
export async function getIssue(projectId, id) {
    const db = getDb();
    const { issues, comments, issueLabels, labels } = schema;
    const [issue] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.id, id), eq(issues.projectId, projectId)));
    if (!issue)
        return null;
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
    return {
        ...issue,
        comments: issueComments,
        labels: issueLabelsRows.map((r) => r.label),
    };
}
export async function createIssue(projectId, data) {
    const db = getDb();
    const { issues } = schema;
    if (!data.title?.trim()) {
        throw Object.assign(new Error('`title` is required'), { status: 400 });
    }
    const title = data.title.trim();
    // Default to the project's is_default column; fall back to position-0 then 'backlog'.
    const status = data.status ?? await getDefaultColumnId(projectId);
    // Validate the target column exists in this project's column_meta.
    await assertColumnExists(projectId, status);
    // Dedup guard: return any non-archived issue with the same (projectId, title)
    // created in the last 60 seconds instead of inserting a duplicate. This is a
    // soft guard against runaway fan-out retries — it does NOT replace a unique index.
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    const [recent] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.projectId, projectId), eq(issues.title, title), eq(issues.archived, 0), sql `${issues.createdAt} >= ${sixtySecondsAgo}`))
        .limit(1);
    if (recent) {
        console.warn(`[createIssue] dedup hit — returning existing issue ${recent.id} ` +
            `(title="${title}", project=${projectId}). Possible duplicate caller.`);
        return recent;
    }
    // Find max position in target column
    const [maxRow] = await db
        .select({ maxPos: sql `COALESCE(MAX(${issues.position}), -1)` })
        .from(issues)
        .where(and(eq(issues.projectId, projectId), eq(issues.status, status), eq(issues.archived, 0)));
    const position = (maxRow?.maxPos ?? -1) + 1;
    const [created] = await db
        .insert(issues)
        .values({
        projectId,
        title,
        body: data.body ?? '',
        status,
        assigneeId: data.assigneeId ?? null,
        position,
    })
        .returning();
    return created;
}
export async function updateIssue(projectId, id, data) {
    const db = getDb();
    const { issues } = schema;
    const [existing] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.id, id), eq(issues.projectId, projectId)));
    if (!existing || existing.archived === 1)
        return null;
    const patch = {
        updatedAt: new Date(),
    };
    if (data.title !== undefined)
        patch.title = data.title.trim();
    if (data.body !== undefined)
        patch.body = data.body;
    if (data.status !== undefined)
        patch.status = data.status;
    if ('assigneeId' in data)
        patch.assigneeId = data.assigneeId ?? undefined;
    const [updated] = await db
        .update(issues)
        .set(patch)
        .where(eq(issues.id, id))
        .returning();
    return updated;
}
export async function archiveIssue(projectId, id) {
    const db = getDb();
    const { issues } = schema;
    const [existing] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.id, id), eq(issues.projectId, projectId)));
    if (!existing)
        return null;
    const [updated] = await db
        .update(issues)
        .set({ archived: 1, updatedAt: new Date() })
        .where(eq(issues.id, id))
        .returning();
    return updated;
}
export async function moveIssue(projectId, id, newStatus, position) {
    const db = getDb();
    const { issues } = schema;
    // Validate the target column exists for this project.
    await assertColumnExists(projectId, newStatus);
    const [existing] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.id, id), eq(issues.projectId, projectId)));
    if (!existing || existing.archived === 1)
        return null;
    // Determine target position
    let targetPosition;
    if (position !== undefined && position >= 0) {
        targetPosition = position;
    }
    else {
        const [maxRow] = await db
            .select({ maxPos: sql `COALESCE(MAX(${issues.position}), -1)` })
            .from(issues)
            .where(and(eq(issues.projectId, projectId), eq(issues.status, newStatus), eq(issues.archived, 0)));
        targetPosition = (maxRow?.maxPos ?? -1) + 1;
    }
    // Shift items in the target column at or above targetPosition to make room
    if (existing.status !== newStatus || existing.position !== targetPosition) {
        await db
            .update(issues)
            .set({ position: sql `${issues.position} + 1` })
            .where(and(eq(issues.projectId, projectId), eq(issues.status, newStatus), eq(issues.archived, 0), sql `${issues.position} >= ${targetPosition}`, sql `${issues.id} != ${id}`));
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
async function compactPositions(projectId, status) {
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
export async function bulkAction(projectId, action, issueIds, payload) {
    const db = getDb();
    const { issues, issueLabels } = schema;
    if (!issueIds.length)
        return { affected: 0 };
    // Verify all issues belong to this project
    const owned = await db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.projectId, projectId), inArray(issues.id, issueIds)));
    const validIds = owned.map((r) => r.id);
    if (!validIds.length)
        return { affected: 0 };
    if (action === 'archive') {
        await db
            .update(issues)
            .set({ archived: 1, updatedAt: new Date() })
            .where(inArray(issues.id, validIds));
        return { affected: validIds.length };
    }
    if (action === 'move') {
        const newStatus = payload?.status;
        if (!newStatus)
            throw Object.assign(new Error('`status` required for move action'), { status: 400 });
        for (const issueId of validIds) {
            await moveIssue(projectId, issueId, newStatus);
        }
        return { affected: validIds.length };
    }
    if (action === 'label') {
        const labelIds = payload?.labelIds;
        if (!labelIds)
            throw Object.assign(new Error('`labelIds` required for label action'), { status: 400 });
        for (const issueId of validIds) {
            // Replace all labels on these issues
            await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
            if (labelIds.length) {
                await db.insert(issueLabels).values(labelIds.map((labelId) => ({ issueId, labelId })));
            }
        }
        return { affected: validIds.length };
    }
    throw Object.assign(new Error(`Unknown action: ${action}`), { status: 400 });
}
export async function listComments(issueId) {
    const db = getDb();
    // Enrich with agent metadata for `authorKind = 'agent'` comments so the
    // client doesn't have to join in JS. Human + system rows pass through as-is.
    const rows = await db
        .select()
        .from(schema.comments)
        .where(eq(schema.comments.issueId, issueId))
        .orderBy(schema.comments.createdAt);
    const agentIds = Array.from(new Set(rows
        .filter((r) => r.authorKind === 'agent' && typeof r.authorRef === 'string' && r.authorRef.length > 0)
        .map((r) => r.authorRef)));
    let agentMap = new Map();
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
export async function addComment(issueId, input, legacyAuthorId) {
    // Backward-compat: callers that passed (issueId, body, authorId) still work.
    const payload = typeof input === 'string'
        ? { body: input, authorId: legacyAuthorId ?? null }
        : input;
    if (!payload.body?.trim()) {
        throw Object.assign(new Error('`body` is required'), { status: 400 });
    }
    const authorKind = payload.authorKind ?? 'human';
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
export async function appendSystemComment(opts) {
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
        eventPayload: (opts.eventPayload ?? {}),
    })
        .returning();
    return created;
}
export async function deleteComment(issueId, commentId) {
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
export async function listLabels(projectId) {
    const db = getDb();
    return db
        .select()
        .from(schema.labels)
        .where(eq(schema.labels.projectId, projectId))
        .orderBy(schema.labels.name);
}
export async function createLabel(projectId, name, color) {
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
export async function setIssueLabels(projectId, issueId, labelIds) {
    const db = getDb();
    const { issues, issueLabels } = schema;
    const [issue] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.projectId, projectId)));
    if (!issue || issue.archived === 1)
        return null;
    await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
    if (labelIds.length) {
        await db.insert(issueLabels).values(labelIds.map((labelId) => ({ issueId, labelId })));
    }
    return { issueId, labelIds };
}
//# sourceMappingURL=issues.js.map