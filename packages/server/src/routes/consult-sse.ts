/**
 * routes/consult-sse.ts — W28 J3
 *
 * Registers `GET /api/consult/:sessionId/stream` on the existing consultRouter.
 * Returns `text/event-stream` with the same delta shape as the WS consult path.
 *
 * Resume: pass `Last-Event-Id` header (browser EventSource does this
 * automatically on reconnect) or `?lastEventId=<seq>` for manual retries.
 */

import type { Request, Response } from 'express';
import { streamConsultSSE } from '../sdk/sse-stream.js';

export function handleConsultSSE(req: Request, res: Response): void {
  const { sessionId } = req.params as { sessionId: string };

  // Browser EventSource sets Last-Event-Id on reconnect; manual retry uses QS.
  const lastEventId =
    (req.headers['last-event-id'] as string | undefined) ??
    (req.query['lastEventId'] as string | undefined) ??
    null;

  streamConsultSSE(sessionId, lastEventId, res);
}
