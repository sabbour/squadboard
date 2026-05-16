/**
 * sdk/direct-response.ts — W28 J5
 *
 * Wraps the SDK DirectResponseHandler for the Consult send-path.
 *
 * Lives here (NOT in model-defaults.ts) to avoid lane conflict with Hockney
 * who owns model-defaults.ts. This module is the single import point for
 * DirectResponseHandler throughout the server codebase.
 *
 * Usage:
 *   const result = tryDirectResponse(userMessage, sdkContext);
 *   if (result) { // emit quick reply, skip LLM }
 */

import type { SdkCoordinatorContext } from '../services/coordinator-context.js';

// ---------------------------------------------------------------------------
// SDK import (dynamic to keep startup fast when SDK is unavailable)
// ---------------------------------------------------------------------------

type DirectResponseHandlerClass = {
  new (customPatterns?: unknown[]): {
    shouldHandleDirectly(message: string, config?: unknown): boolean;
    handleDirect(message: string, context: unknown): DirectResponseResultShape;
  };
};

export interface DirectResponseResultShape {
  response: string;
  category: 'status' | 'help' | 'config' | 'roster' | 'greeting';
  confidence: 'high' | 'medium';
}

let handlerInstance: InstanceType<DirectResponseHandlerClass> | null = null;
let initAttempted = false;

async function getHandler(): Promise<InstanceType<DirectResponseHandlerClass> | null> {
  if (initAttempted) return handlerInstance;
  initAttempted = true;
  try {
    const mod = await import('@bradygaster/squad-sdk/coordinator');
    const Handler = (mod as unknown as { DirectResponseHandler: DirectResponseHandlerClass })
      .DirectResponseHandler;
    handlerInstance = new Handler();
  } catch (err) {
    console.warn('[direct-response] SDK DirectResponseHandler unavailable:', err instanceof Error ? err.message : String(err));
    handlerInstance = null;
  }
  return handlerInstance;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether `message` should be handled directly (no LLM spawn).
 * Returns a DirectResponseResult if matched, or null if the LLM should handle it.
 *
 * Short-circuits: status / help / config / roster / greeting categories.
 */
export async function tryDirectResponse(
  message: string,
  context: SdkCoordinatorContext,
): Promise<DirectResponseResultShape | null> {
  const handler = await getHandler();
  if (!handler) return null;

  try {
    if (!handler.shouldHandleDirectly(message, context.config)) {
      return null;
    }
    return handler.handleDirect(message, context);
  } catch (err) {
    console.warn('[direct-response] handler error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Re-exported for testing / introspection.
 */
export { getHandler as _getDirectResponseHandler };
