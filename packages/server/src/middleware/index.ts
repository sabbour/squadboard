/**
 * middleware/index.ts — Security middleware barrel.
 *
 * Export order matches recommended mount order in index.ts:
 *   1. authMiddleware  — establishes identity (rejects unknown callers first)
 *   2. csrfMiddleware  — defends against in-session replay (assumes identity known)
 */

export { authMiddleware } from './auth.js';
export { csrfMiddleware } from './csrf.js';
