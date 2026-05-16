/**
 * routes/conjure.ts — POST /api/conjure/classify
 *
 * W22: Extended to 10 intents + top-3 candidates (see decisions-archive.md §5).
 * Accepts both the new flat request shape and the old nested context shape.
 *
 * Wire notes for Keyser-w22 (ConjureModal integration):
 *   - Send `prose` (preferred) or `prompt` (backward-compat alias) for the user input.
 *   - Send `projectId` / `projectName` flat (preferred) or nest them in `context`.
 *   - Response now includes `candidates: ConjureCandidate[]` (up to 3).
 *   - Top-level `intent`, `confidence`, `draft` are still present (= candidates[0]).
 */
import { Router } from 'express';
import { classifyAndDraft, ALL_INTENTS } from '../services/conjure-classifier.js';
const router = Router();
// POST /api/conjure/classify
// Body: {
//   prose: string,          ← preferred W22 field name
//   prompt?: string,        ← backward-compat alias
//   hint?: ConjureIntent,
//   projectId?: string,
//   projectName?: string,
//   knownProjectNames?: string[],
//   context?: { currentProjectId?, currentProjectName? },  ← old shape
//   useLlm?: boolean
// }
router.post('/classify', async (req, res) => {
    try {
        const body = (req.body ?? {});
        // Accept `prose` (new) or `prompt` (old alias). One of them must be a non-empty string.
        const prose = typeof body['prose'] === 'string' ? body['prose']
            : typeof body['prompt'] === 'string' ? body['prompt']
                : null;
        if (!prose) {
            res.status(400).json({ ok: false, error: '`prose` (or `prompt`) is required and must be a string' });
            return;
        }
        const hint = typeof body['hint'] === 'string' && ALL_INTENTS.includes(body['hint'])
            ? body['hint']
            : null;
        // Flat context fields (W22 preferred shape).
        const projectId = typeof body['projectId'] === 'string' ? body['projectId'] : null;
        const projectName = typeof body['projectName'] === 'string' ? body['projectName'] : null;
        const knownProjectNames = Array.isArray(body['knownProjectNames'])
            ? body['knownProjectNames'].filter((x) => typeof x === 'string')
            : undefined;
        // Nested context (old shape — still accepted for backward compat).
        const ctxIn = body['context'] && typeof body['context'] === 'object' && !Array.isArray(body['context'])
            ? body['context']
            : null;
        const context = ctxIn
            ? {
                currentProjectId: typeof ctxIn['currentProjectId'] === 'string' ? ctxIn['currentProjectId'] : null,
                currentProjectName: typeof ctxIn['currentProjectName'] === 'string' ? ctxIn['currentProjectName'] : null,
            }
            : null;
        const useLlm = body['useLlm'] === false ? false : true;
        const result = await classifyAndDraft({
            prose,
            context,
            projectId,
            projectName,
            knownProjectNames,
            hint,
            useLlm,
        });
        res.json({ ok: true, data: result });
    }
    catch (err) {
        const status = err.status ?? 500;
        if (status >= 500)
            console.error('[conjure/classify] unhandled:', err);
        res.status(status).json({
            ok: false,
            error: err instanceof Error ? err.message : 'Internal server error',
        });
    }
});
export default router;
//# sourceMappingURL=conjure.js.map