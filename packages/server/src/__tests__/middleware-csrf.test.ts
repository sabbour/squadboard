/**
 * middleware-csrf.test.ts — Unit tests for csrfMiddleware.
 *
 * Tests:
 *   1. No-op on GET requests (safe method).
 *   2. Rejects POST with Sec-Fetch-Site: cross-site → 403.
 *   3. Accepts POST with Sec-Fetch-Site: same-origin.
 *   4. Accepts POST with Sec-Fetch-Site: same-site.
 *   5. Accepts POST with no Sec-Fetch-Site and no Origin (non-browser/MCP/CLI).
 *   6. Accepts POST with matching Origin (no Sec-Fetch-Site).
 *   7. Rejects POST with mismatched Origin (no Sec-Fetch-Site).
 *   8. Honors SQUADBOARD_DISABLE_CSRF=1 — no-op on cross-site POST.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { csrfMiddleware } from '../middleware/csrf.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: {
  method?: string;
  headers?: Record<string, string>;
} = {}): Request {
  return {
    method: overrides.method ?? 'POST',
    headers: overrides.headers ?? {},
  } as unknown as Request;
}

function makeRes() {
  const res = {
    _status: 0,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('csrfMiddleware', () => {
  const originalDisable = process.env['SQUADBOARD_DISABLE_CSRF'];

  afterEach(() => {
    if (originalDisable === undefined) {
      delete process.env['SQUADBOARD_DISABLE_CSRF'];
    } else {
      process.env['SQUADBOARD_DISABLE_CSRF'] = originalDisable;
    }
  });

  it('is a no-op (calls next) for GET requests', () => {
    delete process.env['SQUADBOARD_DISABLE_CSRF'];
    const next = vi.fn();
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    csrfMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects POST with Sec-Fetch-Site: cross-site with 403', () => {
    delete process.env['SQUADBOARD_DISABLE_CSRF'];
    const next = vi.fn();
    const req = makeReq({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } });
    const res = makeRes();
    csrfMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it('accepts POST with Sec-Fetch-Site: same-origin', () => {
    delete process.env['SQUADBOARD_DISABLE_CSRF'];
    const next = vi.fn();
    const req = makeReq({ method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
    const res = makeRes();
    csrfMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts POST with Sec-Fetch-Site: same-site', () => {
    delete process.env['SQUADBOARD_DISABLE_CSRF'];
    const next = vi.fn();
    const req = makeReq({ method: 'POST', headers: { 'sec-fetch-site': 'same-site' } });
    const res = makeRes();
    csrfMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts POST with no Sec-Fetch-Site and no Origin (non-browser: MCP, CLI, curl)', () => {
    delete process.env['SQUADBOARD_DISABLE_CSRF'];
    const next = vi.fn();
    const req = makeReq({ method: 'POST', headers: {} });
    const res = makeRes();
    csrfMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts POST when Origin host matches request host (no Sec-Fetch-Site)', () => {
    delete process.env['SQUADBOARD_DISABLE_CSRF'];
    const next = vi.fn();
    const req = makeReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    });
    const res = makeRes();
    csrfMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects POST when Origin host does not match request host (no Sec-Fetch-Site)', () => {
    delete process.env['SQUADBOARD_DISABLE_CSRF'];
    const next = vi.fn();
    const req = makeReq({
      method: 'POST',
      headers: { origin: 'https://evil.example.com', host: 'localhost:3000' },
    });
    const res = makeRes();
    csrfMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it('is a no-op for cross-site POST when SQUADBOARD_DISABLE_CSRF=1', () => {
    process.env['SQUADBOARD_DISABLE_CSRF'] = '1';
    const next = vi.fn();
    const req = makeReq({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } });
    const res = makeRes();
    csrfMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });
});
