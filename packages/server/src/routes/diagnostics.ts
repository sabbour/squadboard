/**
 * routes/diagnostics.ts — Phase 3 Doctor
 *
 * GET /api/diagnostics                   — server-wide health checks; 5s cache
 * GET /api/projects/:id/diagnostics      — project-scoped variant; 5s cache per projectId
 *
 * Both respond with: { checks: DiagnosticResult[], generatedAt: string, durationMs: number }
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { runDiagnostics } from '../services/diagnostics.js';
import type { DiagnosticResult } from '../services/diagnostics.js';

const router = Router({ mergeParams: true });

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  payload: DiagnosticsResponse;
  expiresAt: number;
}

interface DiagnosticsResponse {
  checks: DiagnosticResult[];
  generatedAt: string;
  durationMs: number;
}

const CACHE_TTL_MS = 5_000;
const projectCache = new Map<string, CacheEntry>();

// Mutable ref so we can update the global cache without top-level let shadowing
const globalCacheRef = { value: null as CacheEntry | null };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getDiagnostics(projectId?: string): Promise<DiagnosticsResponse> {
  const now = Date.now();

  if (projectId) {
    const cached = projectCache.get(projectId);
    if (cached && cached.expiresAt > now) return cached.payload;
  } else {
    const cached = globalCacheRef.value;
    if (cached && cached.expiresAt > now) return cached.payload;
  }

  const start = Date.now();
  const checks = await runDiagnostics({ projectId });
  const durationMs = Date.now() - start;
  const payload: DiagnosticsResponse = {
    checks,
    generatedAt: new Date().toISOString(),
    durationMs,
  };
  const entry: CacheEntry = { payload, expiresAt: now + CACHE_TTL_MS };

  if (projectId) {
    projectCache.set(projectId, entry);
  } else {
    globalCacheRef.value = entry;
  }

  return payload;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/** GET /api/diagnostics */
export const diagnosticsRouter = Router();
diagnosticsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await getDiagnostics();
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** GET /api/projects/:id/diagnostics */
export const projectDiagnosticsRouter = Router({ mergeParams: true });
projectDiagnosticsRouter.get('/', async (req: Request, res: Response) => {
  const rawId = req.params['id'];
  const projectId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }
  try {
    const result = await getDiagnostics(projectId);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
