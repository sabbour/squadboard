import { Router } from 'express';
export const modelsRouter = Router();
function classifyVendor(id) {
    if (id.startsWith('claude'))
        return 'anthropic';
    if (id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3'))
        return 'openai';
    if (id.startsWith('gemini'))
        return 'google';
    return 'other';
}
function classifyTier(id, multiplier) {
    const lower = id.toLowerCase();
    if (lower.includes('opus'))
        return 'powerful';
    if (lower.includes('mini') || lower.includes('haiku') || lower.includes('nano'))
        return 'fast';
    if (typeof multiplier === 'number' && multiplier >= 5)
        return 'powerful';
    if (typeof multiplier === 'number' && multiplier <= 0.5)
        return 'fast';
    return 'balanced';
}
let cache = null;
const CACHE_TTL_MS = 10 * 60 * 1000;
const FALLBACK_MODELS = [
    { id: 'auto', label: 'auto (agent decides)', vendor: 'other', tier: 'balanced' },
    { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', vendor: 'anthropic', tier: 'balanced' },
    { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', vendor: 'anthropic', tier: 'fast' },
    { id: 'claude-opus-4.5', label: 'Claude Opus 4.5', vendor: 'anthropic', tier: 'powerful' },
    { id: 'gpt-4.1', label: 'GPT-4.1', vendor: 'openai', tier: 'balanced' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini', vendor: 'openai', tier: 'fast' },
];
async function fetchModelsFromSdk() {
    const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
    const { SquadClient } = await import('@bradygaster/squad-sdk/client');
    const client = new SquadClient({
        ...(token ? { githubToken: token } : { useLoggedInUser: true }),
    });
    await client.connect();
    try {
        const sdkModels = await client.listModels();
        const mapped = sdkModels.map((m) => ({
            id: m.id,
            label: m.name ?? m.id,
            vendor: classifyVendor(m.id),
            tier: classifyTier(m.id, m.billing?.multiplier),
            multiplier: m.billing?.multiplier,
            contextWindow: m.capabilities?.limits?.max_context_window_tokens,
            supportsVision: m.capabilities?.supports?.vision,
            supportsReasoningEffort: m.capabilities?.supports?.reasoningEffort,
            policyState: m.policy?.state,
        }));
        // Always include 'auto' synthetic option for the UI.
        return [
            { id: 'auto', label: 'auto (agent decides)', vendor: 'other', tier: 'balanced' },
            ...mapped,
        ];
    }
    finally {
        await client.disconnect().catch(() => { });
    }
}
async function getModels(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cache && cache.expiresAt > now) {
        return { models: cache.data, source: 'cache' };
    }
    try {
        const fresh = await fetchModelsFromSdk();
        cache = { data: fresh, expiresAt: now + CACHE_TTL_MS };
        return { models: fresh, source: 'sdk' };
    }
    catch (err) {
        console.warn('[models] listModels() failed, returning fallback', err);
        return {
            models: FALLBACK_MODELS,
            source: 'fallback',
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
modelsRouter.get('/', async (req, res) => {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const { models, source, error } = await getModels(refresh);
    res.json({ ok: true, data: models, source, ...(error ? { warning: error } : {}) });
});
//# sourceMappingURL=models.js.map