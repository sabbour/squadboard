import { describe, it, expect, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { extractRequestToken, verifyPresentedToken } from '../middleware/auth-token.js';

describe('auth-token helpers', () => {
  const originalEnv = process.env['SQUADBOARD_AUTH_TOKEN'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['SQUADBOARD_AUTH_TOKEN'];
    } else {
      process.env['SQUADBOARD_AUTH_TOKEN'] = originalEnv;
    }
  });

  it('prefers the Authorization header over the query token', () => {
    const token = extractRequestToken({
      headers: { authorization: 'Bearer header-token' },
      url: '/api/ws?token=query-token',
    });
    expect(token).toBe('header-token');
  });

  it('extracts the query token when no Authorization header is present', () => {
    const token = extractRequestToken({
      headers: {},
      url: '/api/ws?token=query-token',
    });
    expect(token).toBe('query-token');
  });

  it('verifies JWTs and returns the scoped projectId claim', async () => {
    process.env['SQUADBOARD_AUTH_TOKEN'] = 'secret-token';
    const jwt = await new SignJWT({ projectId: 'project-123', userId: 'viewer-7' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('viewer-7')
      .sign(new TextEncoder().encode('secret-token'));

    const verification = await verifyPresentedToken(jwt);

    expect(verification.ok).toBe(true);
    expect(verification.token?.mode).toBe('jwt');
    expect(verification.token?.projectId).toBe('project-123');
    expect(verification.token?.subject).toBe('viewer-7');
  });

  it('accepts the legacy shared bearer token for REST compatibility', async () => {
    process.env['SQUADBOARD_AUTH_TOKEN'] = 'secret-token';

    const verification = await verifyPresentedToken('secret-token');

    expect(verification.ok).toBe(true);
    expect(verification.token?.mode).toBe('legacy');
    expect(verification.token?.projectId).toBeNull();
  });
});
