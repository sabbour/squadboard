/**
 * routes/conjure.ts — POST /api/conjure/classify
 *
 * Phase 1 surface for the Conjure smart-create flow. Takes a free-form
 * prompt, classifies into one of 6 intents (project|issue|team|agent|
 * skill|tool), and returns a pre-filled draft + routing recommendation.
 *
 * The classifier strategy is hybrid (rule-based first, optional LLM
 * disambiguation for ambiguous prompts) — see services/conjure-classifier.ts
 * and .squad/decisions/inbox/hockney-conjure-classify.md.
 */
import { Router } from 'express';
import { classifyAndDraft, ALL_INTENTS } from '../services/conjure-classifier.js';
const router = Router();
// POST /api/conjure/classify
// Body: { prompt: string, context?: { currentProjectId?, currentProjectName? }, hint?: ConjureIntent, useLlm?: boolean }
router.post('/classify', async (req, res) => {
    try {
        const body = (req.body ?? {});
        if (typeof body.prompt !== 'string') {
            res.status(400).json({ ok: false, error: '`prompt` is required and must be a string' });
            return;
        }
        const hint = typeof body.hint === 'string' && ALL_INTENTS.includes(body.hint)
            ? body.hint
            : null;
        const ctxIn = body.context && typeof body.context === 'object' && !Array.isArray(body.context)
            ? body.context
            : null;
        const context = ctxIn
            ? {
                currentProjectId: typeof ctxIn['currentProjectId'] === 'string' ? ctxIn['currentProjectId'] : null,
                currentProjectName: typeof ctxIn['currentProjectName'] === 'string' ? ctxIn['currentProjectName'] : null,
            }
            : null;
        const useLlm = body.useLlm === false ? false : true;
        const result = await classifyAndDraft({
            prompt: body.prompt,
            context,
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