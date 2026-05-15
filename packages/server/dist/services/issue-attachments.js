/**
 * Issue Attachments Service
 *
 * Stores image attachments as BYTEA in PostgreSQL (transactional, local-first,
 * 5 MB cap keeps individual rows reasonable). Content column is excluded from
 * list/create return shapes — only the byte-serve endpoint reads it.
 *
 * Cascade behaviour: `ON DELETE CASCADE` on issue_id means hard-deleting an
 * issue automatically removes all its attachments. Soft-deleted issues
 * (archived=1) keep their attachments until the issue is hard-deleted.
 */
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
]);
// ---------------------------------------------------------------------------
// Typed errors — route handlers map these to API contract responses
// ---------------------------------------------------------------------------
export class AttachmentError extends Error {
    code;
    constructor(code, message) {
        super(message ?? code);
        this.code = code;
        this.name = 'AttachmentError';
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Strips path separators and limits filename to 255 chars (POSIX safe).
 */
function sanitizeFilename(raw) {
    return raw.replace(/[/\\]/g, '_').slice(0, 255) || 'attachment';
}
/**
 * Asserts the issue exists and belongs to the given project.
 * Throws AttachmentError on mismatch.
 */
async function assertIssueOwnership(projectId, issueId) {
    const db = getDb();
    const [row] = await db
        .select({ id: schema.issues.id })
        .from(schema.issues)
        .where(and(eq(schema.issues.id, issueId), eq(schema.issues.projectId, projectId)))
        .limit(1);
    if (!row)
        throw new AttachmentError('invalid_issue');
}
/**
 * Builds the public URL for an attachment (relative path used in markdown).
 */
function buildUrl(projectId, issueId, attachmentId) {
    return `/api/projects/${projectId}/issues/${issueId}/attachments/${attachmentId}`;
}
function toRecord(row, projectId, issueId) {
    return {
        id: row.id,
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        url: buildUrl(projectId, issueId, row.id),
        createdAt: row.createdAt.toISOString(),
    };
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Validates and persists a new attachment.
 * Returns the record shape (no content field).
 */
export async function createAttachment(projectId, issueId, file) {
    if (!ALLOWED_MIME_TYPES.has(file.mimeType)) {
        throw new AttachmentError('unsupported_type');
    }
    if (file.content.byteLength > MAX_BYTES) {
        throw new AttachmentError('image_too_large');
    }
    await assertIssueOwnership(projectId, issueId);
    const db = getDb();
    const [row] = await db
        .insert(schema.issueAttachments)
        .values({
        issueId,
        filename: sanitizeFilename(file.filename),
        mimeType: file.mimeType,
        sizeBytes: file.content.byteLength,
        content: file.content,
    })
        .returning({
        id: schema.issueAttachments.id,
        filename: schema.issueAttachments.filename,
        mimeType: schema.issueAttachments.mimeType,
        sizeBytes: schema.issueAttachments.sizeBytes,
        createdAt: schema.issueAttachments.createdAt,
    });
    return toRecord(row, projectId, issueId);
}
/**
 * Returns all attachments for an issue (no content bytes).
 */
export async function listAttachments(projectId, issueId) {
    await assertIssueOwnership(projectId, issueId);
    const db = getDb();
    const rows = await db
        .select({
        id: schema.issueAttachments.id,
        filename: schema.issueAttachments.filename,
        mimeType: schema.issueAttachments.mimeType,
        sizeBytes: schema.issueAttachments.sizeBytes,
        createdAt: schema.issueAttachments.createdAt,
    })
        .from(schema.issueAttachments)
        .where(eq(schema.issueAttachments.issueId, issueId));
    return rows.map((r) => toRecord(r, projectId, issueId));
}
/**
 * Fetches the raw bytes for streaming to the client.
 * Returns null when not found or ownership check fails.
 */
export async function getAttachmentBytes(projectId, issueId, attachmentId) {
    const db = getDb();
    const [issue] = await db
        .select({ id: schema.issues.id })
        .from(schema.issues)
        .where(and(eq(schema.issues.id, issueId), eq(schema.issues.projectId, projectId)))
        .limit(1);
    if (!issue)
        return null;
    const [row] = await db
        .select({
        mimeType: schema.issueAttachments.mimeType,
        sizeBytes: schema.issueAttachments.sizeBytes,
        content: schema.issueAttachments.content,
    })
        .from(schema.issueAttachments)
        .where(and(eq(schema.issueAttachments.id, attachmentId), eq(schema.issueAttachments.issueId, issueId)))
        .limit(1);
    if (!row)
        return null;
    return { mimeType: row.mimeType, sizeBytes: row.sizeBytes, content: row.content };
}
/**
 * Deletes an attachment. Returns true if a row was deleted, false if not found.
 */
export async function deleteAttachment(projectId, issueId, attachmentId) {
    const db = getDb();
    const [issue] = await db
        .select({ id: schema.issues.id })
        .from(schema.issues)
        .where(and(eq(schema.issues.id, issueId), eq(schema.issues.projectId, projectId)))
        .limit(1);
    if (!issue)
        return false;
    const deleted = await db
        .delete(schema.issueAttachments)
        .where(and(eq(schema.issueAttachments.id, attachmentId), eq(schema.issueAttachments.issueId, issueId)))
        .returning({ id: schema.issueAttachments.id });
    return deleted.length > 0;
}
//# sourceMappingURL=issue-attachments.js.map