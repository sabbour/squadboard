/**
 * middleware-auth.test.ts — Unit tests for authMiddleware.
 *
 * Tests:
 *   1. No-op when SQUADBOARD_AUTH_TOKEN is unset.
 *   2. Rejects requests with no Authorization header when token is set.
 *   3. Rejects requests with a wrong token.
 *   4. Accepts requests with the correct token.
 *   5. Health endpoint is exempt even when token is set.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<{ path: string; headers: Record<string, string> }> = {}): Request {
  return {
    path: overrides.path ?? '/api/projects',
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

describe('authMiddleware', () => {
  const originalEnv = process.env['SQUADBOARD_AUTH_TOKEN'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['SQUADBOARD_AUTH_TOKEN'];
    } else {
      process.env['SQUADBOARD_AUTH_TOKEN'] = originalEnv;
    }
  });

  it('is a no-op (calls next) when SQUADBOARD_AUTH_TOKEN is unset', () => {
    delete process.env['SQUADBOARD_AUTH_TOKEN'];
    const next = vi.fn();
    const req = makeReq();
    const res = makeRes();
    authMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(0); // never set
  });

  it('rejects with 401 when token is set and Authorization header is absent', () => {
    process.env['SQUADBOARD_AUTH_TOKEN'] = 'secret-token';
    const next = vi.fn();
    const req = makeReq({ headers: {} });
    const res = makeRes();
    authMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('rejects with 401 when token is set and wrong token is presented', () => {
    process.env['SQUADBOARD_AUTH_TOKEN'] = 'secret-token';
    const next = vi.fn();
    const req = makeReq({ headers: { authorization: 'Bearer wrong-token' } });
    const res = makeRes();
    authMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('accepts and calls next when the correct token is presented', () => {
    process.env['SQUADBOARD_AUTH_TOKEN'] = 'secret-token';
    const next = vi.fn();
    const req = makeReq({ headers: { authorization: 'Bearer secret-token' } });
    const res = makeRes();
    authMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('exempts /api/health even when token is set and no auth header is provided', () => {
    process.env['SQUADBOARD_AUTH_TOKEN'] = 'secret-token';
    const next = vi.fn();
    const req = makeReq({ path: '/api/health', headers: {} });
    const res = makeRes();
    authMiddleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(0);
  });
});
