/**
 * auth.ts — Opt-in Bearer-token authentication middleware.
 *
 * Behaviour:
 *   - When SQUADBOARD_AUTH_TOKEN is unset → no-op (local dogfood default).
 *   - When set → every request must include `Authorization: Bearer <token>`.
 *   - Accepts either the legacy shared bearer token OR an HS256 JWT signed
 *     with `SQUADBOARD_AUTH_TOKEN`.
 *   - Missing or invalid tokens → 401 JSON response.
 *
 * MCP note: The HTTP MCP transport at /mcp must also carry the token when
 * SQUADBOARD_AUTH_TOKEN is set. The stdio MCP path is unaffected (it never
 * goes through this middleware layer).
 *
 * Health endpoint (/api/health) is exempt to allow load-balancer probes
 * without a token in hosted deployments.
 */

import type { Request, Response, NextFunction } from 'express';
import { extractBearerToken, verifyPresentedToken } from './auth-token.js';

const EXEMPT_PREFIXES = ['/api/health'];

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Health probes are exempt.
  if (EXEMPT_PREFIXES.some(prefix => req.path.startsWith(prefix))) {
    next();
    return;
  }

  const verification = await verifyPresentedToken(extractBearerToken(req.headers['authorization']));
  if (!verification.authEnabled) {
    next();
    return;
  }

  if (!verification.ok) {
    res.status(401).json({ error: 'Unauthorized', message: verification.message ?? 'Invalid token.' });
    return;
  }

  next();
}
