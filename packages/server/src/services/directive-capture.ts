/**
 * services/directive-capture.ts — directive + dogfood capture parity.
 *
 * Captures a user directive to the legacy `.squad/decisions/inbox` markdown
 * path, ensures an inbox DB row exists, and best-effort calls the MCP capture
 * path so dogfood work can land on the board. MCP failures are fail-open: the
 * markdown + DB capture remain durable and the failure is returned/logged.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';

import { getDb, schema } from '../db/index.js';
import { resolveSquadDir } from './diagnostics.js';
import * as inboxService from './inbox.js';

export type DirectiveCapturePhase = 'intake' | 'closeout';
export type DirectiveCaptureStep = 'markdown' | 'mcp_capture' | 'db_capture';
export type DirectiveCaptureStepStatus = 'created' | 'deduped' | 'succeeded' | 'failed' | 'skipped';

export interface DirectiveCaptureAuditEntry {
  step: DirectiveCaptureStep;
  status: DirectiveCaptureStepStatus;
  detail?: string;
  error?: string;
}

export interface McpCaptureInput {
  prompt: string;
  projectId: string;
  idempotencyKey: string;
  phase: DirectiveCapturePhase;
  sourceType: string;
  sourceId: string;
  createdBy: string;
}

export type McpCaptureFn = (input: McpCaptureInput) => Promise<unknown>;

export interface CaptureDirectiveInput {
  projectId: string;
  directive: string;
  sourceType?: string | null;
  sourceId?: string | null;
  phase?: DirectiveCapturePhase | null;
  title?: string | null;
  createdBy?: string | null;
  userName?: string | null;
  now?: Date;
  callMcp?: boolean;
  mcpCapture?: McpCaptureFn | null;
}

export interface DirectiveCaptureIdentity {
  phase: DirectiveCapturePhase;
  sourceType: string;
  sourceId: string;
  directiveHash: string;
  idempotencyKey: string;
}

export interface DirectiveCaptureResult {
  idempotencyKey: string;
  directiveHash: string;
  phase: DirectiveCapturePhase;
  markdown: {
    filePath: string;
    status: 'created' | 'deduped';
  };
  inbox: {
    itemId: string;
    status: string;
    created: boolean;
  };
  mcp: {
    status: 'succeeded' | 'failed' | 'skipped';
    result?: unknown;
    error?: string;
  };
  audit: DirectiveCaptureAuditEntry[];
}

const DONE_PREFIX = /^done:\s*/i;

export function inferDirectiveCapturePhase(directive: string, explicit?: DirectiveCapturePhase | null): DirectiveCapturePhase {
  if (explicit) return explicit;
  return DONE_PREFIX.test(directive.trim()) ? 'closeout' : 'intake';
}

export function normaliseDirectiveForHash(directive: string): string {
  return directive.trim().replace(/\s+/g, ' ');
}

export function hashDirective(directive: string): string {
  return createHash('sha256').update(normaliseDirectiveForHash(directive)).digest('hex');
}

export function deriveDirectiveCaptureIdentity(input: {
  directive: string;
  sourceType?: string | null;
  sourceId?: string | null;
  phase?: DirectiveCapturePhase | null;
}): DirectiveCaptureIdentity {
  const phase = inferDirectiveCapturePhase(input.directive, input.phase);
  const sourceType = cleanSourcePart(input.sourceType, 'unknown-source');
  const sourceId = cleanSourcePart(input.sourceId, 'unknown-id');
  const directiveHash = hashDirective(input.directive);
  const keySeed = `${sourceType}\0${sourceId}\0${directiveHash}\0${phase}`;
  const idempotencyKey = createHash('sha256').update(keySeed).digest('hex').slice(0, 32);
  return { phase, sourceType, sourceId, directiveHash, idempotencyKey };
}

function cleanSourcePart(value: string | null | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  return trimmed || fallback;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'source';
}

function titleFromDirective(directive: string, title?: string | null): string {
  const explicit = title?.trim();
  if (explicit) return explicit.slice(0, 120);
  const withoutDone = directive.replace(DONE_PREFIX, '').trim();
  const compact = withoutDone.replace(/\s+/g, ' ');
  return (compact || 'User directive').slice(0, 120);
}

async function resolveProjectSquadDir(projectId: string): Promise<string> {
  const db = getDb();
  const [project] = await db
    .select({ path: schema.projects.path })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);

  if (!project?.path) {
    throw Object.assign(new Error(`project ${projectId} has no .squad path`), { status: 404 });
  }

  const resolved = await resolveSquadDir(project.path);
  if (!resolved.ok) {
    throw Object.assign(new Error(`project .squad path is not usable: ${resolved.reason}`), { status: 422 });
  }
  return resolved.squadDir;
}

function renderDirectiveMarkdown(input: {
  directive: string;
  title: string;
  createdAt: Date;
  userName: string;
  createdBy: string;
  projectId: string;
  identity: DirectiveCaptureIdentity;
}): string {
  const timestamp = input.createdAt.toISOString();
  return [
    `### ${timestamp}: User directive`,
    `**By:** ${input.userName} (via Copilot)`,
    `**What:** ${input.directive.trim()}`,
    `**Why:** User request — captured for team memory`,
    '',
    `**Title:** ${input.title}`,
    `**Phase:** ${input.identity.phase}`,
    `**Source:** ${input.identity.sourceType}:${input.identity.sourceId}`,
    `**Project:** ${input.projectId}`,
    `**Created-By:** ${input.createdBy}`,
    `**Directive-Hash:** sha256:${input.identity.directiveHash}`,
    `**Idempotency-Key:** ${input.identity.idempotencyKey}`,
    '',
  ].join('\n');
}

async function writeDecisionInboxFile(input: {
  squadDir: string;
  directive: string;
  title: string;
  createdAt: Date;
  userName: string;
  createdBy: string;
  projectId: string;
  identity: DirectiveCaptureIdentity;
}): Promise<{ filePath: string; status: 'created' | 'deduped' }> {
  const inboxDir = path.join(input.squadDir, 'decisions', 'inbox');
  await fs.mkdir(inboxDir, { recursive: true });

  const sourceSlug = slugify(`${input.identity.sourceType}-${input.identity.sourceId}`);
  const fileName = `copilot-directive-${input.identity.phase}-${sourceSlug}-${input.identity.directiveHash.slice(0, 12)}.md`;
  const filePath = path.join(inboxDir, fileName);

  try {
    await fs.access(filePath);
    return { filePath, status: 'deduped' };
  } catch {
    await fs.writeFile(filePath, renderDirectiveMarkdown(input), 'utf8');
    return { filePath, status: 'created' };
  }
}

async function defaultMcpCapture(input: McpCaptureInput): Promise<unknown> {
  const { capturePromptForTool } = await import('../mcp/server.js');
  return capturePromptForTool({
    prompt: input.prompt,
    projectId: input.projectId,
    hint: 'issue',
    useLlm: false,
    idempotencyKey: input.idempotencyKey,
    createdBy: input.createdBy,
  });
}

function isMcpErrorResult(result: unknown): result is { error: unknown; message?: unknown } {
  return Boolean(result && typeof result === 'object' && 'error' in result);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function captureDirective(input: CaptureDirectiveInput): Promise<DirectiveCaptureResult> {
  const directive = input.directive?.trim();
  if (!directive) {
    throw Object.assign(new Error('`directive` is required'), { status: 400 });
  }
  if (!input.projectId?.trim()) {
    throw Object.assign(new Error('`projectId` is required'), { status: 400 });
  }

  const projectId = input.projectId.trim();
  const createdAt = input.now ?? new Date();
  const createdBy = input.createdBy?.trim() || 'copilot-cli';
  const userName = input.userName?.trim() || 'user';
  const title = titleFromDirective(directive, input.title);
  const identity = deriveDirectiveCaptureIdentity({
    directive,
    sourceType: input.sourceType ?? createdBy,
    sourceId: input.sourceId ?? projectId,
    phase: input.phase,
  });
  const audit: DirectiveCaptureAuditEntry[] = [];

  const squadDir = await resolveProjectSquadDir(projectId);
  const markdown = await writeDecisionInboxFile({
    squadDir,
    directive,
    title,
    createdAt,
    userName,
    createdBy,
    projectId,
    identity,
  });
  audit.push({ step: 'markdown', status: markdown.status, detail: markdown.filePath });
  console.info(`[directive-capture] markdown ${markdown.status}: ${markdown.filePath}`);

  let mcp: DirectiveCaptureResult['mcp'] = { status: 'skipped' };
  if (input.callMcp !== false) {
    const mcpCapture = input.mcpCapture ?? defaultMcpCapture;
    try {
      const result = await mcpCapture({
        prompt: directive,
        projectId,
        idempotencyKey: identity.idempotencyKey,
        phase: identity.phase,
        sourceType: identity.sourceType,
        sourceId: identity.sourceId,
        createdBy,
      });
      if (isMcpErrorResult(result)) {
        const message = String(result.message ?? result.error);
        mcp = { status: 'failed', result, error: message };
        audit.push({ step: 'mcp_capture', status: 'failed', error: message });
        console.warn(`[directive-capture] MCP capture failed open for ${identity.idempotencyKey}: ${message}`);
      } else {
        mcp = { status: 'succeeded', result };
        audit.push({ step: 'mcp_capture', status: 'succeeded' });
      }
    } catch (err) {
      const message = errorMessage(err);
      mcp = { status: 'failed', error: message };
      audit.push({ step: 'mcp_capture', status: 'failed', error: message });
      console.warn(`[directive-capture] MCP capture failed open for ${identity.idempotencyKey}: ${message}`);
    }
  } else {
    audit.push({ step: 'mcp_capture', status: 'skipped' });
  }

  const { item, created } = await inboxService.createInboxItem({
    originalDraft: directive,
    suggestedProjectId: projectId,
    userId: null,
    idempotencyKey: identity.idempotencyKey,
    createdBy,
  });
  audit.push({
    step: 'db_capture',
    status: created ? 'created' : 'deduped',
    detail: item.id,
  });

  return {
    idempotencyKey: identity.idempotencyKey,
    directiveHash: identity.directiveHash,
    phase: identity.phase,
    markdown,
    inbox: { itemId: item.id, status: item.status, created },
    mcp,
    audit,
  };
}
