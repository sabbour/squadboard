/**
 * csrf.ts — Same-origin / Sec-Fetch-Site CSRF enforcement for state-changing routes.
 *
 * Behaviour:
 *   - Only applied to state-changing methods: POST, PUT, PATCH, DELETE.
 *   - When SQUADBOARD_DISABLE_CSRF=1 → no-op (local-only escape hatch).
 *   - Primary check: Sec-Fetch-Site header (sent by modern browsers).
 *     Allowed values: "same-origin", "same-site", absent (non-browser clients,
 *     e.g. MCP HTTP, CLI tools, curl — these don't set Sec-Fetch-Site).
 *     Rejected value: "cross-site".
 *   - Secondary check (browsers that send Origin but not Sec-Fetch-Site):
 *     Origin header must match the request host when present.
 *
 * MCP / CLI note: Non-browser clients (MCP HTTP transport, curl, node-fetch,
 * the squadboard CLI) do NOT set Sec-Fetch-Site, so they pass through freely.
 * This is intentional — CSRF is a browser-replay attack vector.
 */

import type { Request, Response, NextFunction } from 'express';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Escape hatch for local / automated environments.
  if (process.env['SQUADBOARD_DISABLE_CSRF'] === '1') {
    next();
    return;
  }

  // Only guard state-changing methods.
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next();
    return;
  }

  const secFetchSite = req.headers['sec-fetch-site'];

  if (secFetchSite !== undefined) {
    // Modern browsers always send this header. Reject cross-site requests.
    if (secFetchSite === 'cross-site') {
      res.status(403).json({ error: 'Forbidden', message: 'CSRF check failed: cross-site request rejected.' });
      return;
    }
    // "same-origin", "same-site", "none" (navigation) are all acceptable.
    next();
    return;
  }

  // Older browsers / non-browser clients that send Origin but not Sec-Fetch-Site.
  const origin = req.headers['origin'];
  if (origin) {
    const requestHost = req.headers['host'];
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      res.status(403).json({ error: 'Forbidden', message: 'CSRF check failed: malformed Origin header.' });
      return;
    }
    // Allow localhost cross-port: Electron dev renderer runs at :5173, server
    // at :3000. Both are localhost — same trust domain, not a CSRF vector.
    const requestHostname = requestHost?.split(':')[0];
    const isSameLocalhost =
      originUrl.hostname === 'localhost' && requestHostname === 'localhost';
    if (!isSameLocalhost && originUrl.host !== requestHost) {
      res.status(403).json({ error: 'Forbidden', message: 'CSRF check failed: Origin does not match host.' });
      return;
    }
  }

  // No Sec-Fetch-Site, no Origin → non-browser client (MCP, CLI, curl). Allow.
  next();
}
