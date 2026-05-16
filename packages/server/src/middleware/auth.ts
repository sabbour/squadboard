/**
 * auth.ts — Opt-in Bearer-token authentication middleware.
 *
 * Behaviour:
 *   - When SQUADBOARD_AUTH_TOKEN is unset → no-op (local dogfood default).
 *   - When set → every request must include `Authorization: Bearer <token>`.
 *     Mismatch or absence → 401 JSON response.
 *
 * MCP note: The HTTP MCP transport at /mcp must also carry the token when
 * SQUADBOARD_AUTH_TOKEN is set. The stdio MCP path is unaffected (it never
 * goes through this middleware layer).
 *
 * Health endpoint (/api/health) is exempt to allow load-balancer probes
 * without a token in hosted deployments.
 */

import type { Request, Response, NextFunction } from 'express';

const EXEMPT_PREFIXES = ['/api/health'];

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = process.env['SQUADBOARD_AUTH_TOKEN'];

  // No-op when env var is unset — preserves local dogfood loop.
  if (!token) {
    next();
    return;
  }

  // Health probes are exempt.
  if (EXEMPT_PREFIXES.some(prefix => req.path.startsWith(prefix))) {
    next();
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing Authorization: Bearer <token> header.' });
    return;
  }

  const presented = authHeader.slice('Bearer '.length);
  if (presented !== token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid token.' });
    return;
  }

  next();
}
