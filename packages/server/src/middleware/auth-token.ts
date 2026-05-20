import type { IncomingMessage } from 'node:http';
import { jwtVerify, type JWTPayload } from 'jose';

export interface VerifiedAuthToken {
  rawToken: string;
  projectId: string | null;
  subject: string | null;
  payload: JWTPayload | null;
  mode: 'jwt' | 'legacy';
}

export interface AuthVerificationResult {
  ok: boolean;
  authEnabled: boolean;
  token: VerifiedAuthToken | null;
  message?: string;
}

const encoder = new TextEncoder();

function getConfiguredAuthToken(): string | null {
  const token = process.env['SQUADBOARD_AUTH_TOKEN']?.trim();
  return token ? token : null;
}

export function isAuthEnabled(): boolean {
  return getConfiguredAuthToken() !== null;
}

export function extractBearerToken(headerValue: string | string[] | undefined): string | null {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw || !raw.startsWith('Bearer ')) return null;
  const token = raw.slice('Bearer '.length).trim();
  return token || null;
}

export function extractRequestToken(req: Pick<IncomingMessage, 'headers' | 'url'>): string | null {
  const headerToken = extractBearerToken(req.headers['authorization']);
  if (headerToken) return headerToken;
  if (!req.url) return null;
  const url = new URL(req.url, 'http://localhost');
  const queryToken = url.searchParams.get('token')?.trim();
  return queryToken || null;
}

function getProjectIdClaim(payload: JWTPayload): string | null {
  const projectId = payload['projectId'];
  if (typeof projectId === 'string' && projectId.trim()) return projectId;
  const legacyProjectId = payload['project_id'];
  if (typeof legacyProjectId === 'string' && legacyProjectId.trim()) return legacyProjectId;
  return null;
}

export async function verifyPresentedToken(presentedToken: string | null): Promise<AuthVerificationResult> {
  const configuredToken = getConfiguredAuthToken();
  if (!configuredToken) {
    return { ok: true, authEnabled: false, token: null };
  }

  if (!presentedToken) {
    return {
      ok: false,
      authEnabled: true,
      token: null,
      message: 'Missing Authorization: Bearer <token> header or ?token=<token> query parameter.',
    };
  }

  if (presentedToken === configuredToken) {
    return {
      ok: true,
      authEnabled: true,
      token: {
        rawToken: presentedToken,
        projectId: null,
        subject: null,
        payload: null,
        mode: 'legacy',
      },
    };
  }

  try {
    const { payload } = await jwtVerify(presentedToken, encoder.encode(configuredToken), {
      algorithms: ['HS256'],
    });
    return {
      ok: true,
      authEnabled: true,
      token: {
        rawToken: presentedToken,
        projectId: getProjectIdClaim(payload),
        subject: typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub : null,
        payload,
        mode: 'jwt',
      },
    };
  } catch {
    return {
      ok: false,
      authEnabled: true,
      token: null,
      message: 'Invalid token.',
    };
  }
}
