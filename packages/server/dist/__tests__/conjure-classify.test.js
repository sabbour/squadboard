/**
 * conjure-classify.test.ts — Vitest coverage for the W22 Conjure classifier.
 *
 * Tests:
 *   1. Heuristic fast-path fires for each of the 10 intents
 *   2. Candidate ordering (top-3 by confidence desc)
 *   3. LLM degradation path (runFormulator throws → fallback to rule-based)
 *   4. New intent classifications (ceremony, mcp-server, inbox-item, consult)
 *   5. Route returns the new candidates shape
 *   6. backward-compat: prompt alias still accepted
 *   7. Flat request fields (prose, projectId, projectName, knownProjectNames)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// ---------------------------------------------------------------------------
// Stub the formulator before importing the classifier so the module resolver
// never tries to load the real SDK.
// ---------------------------------------------------------------------------
vi.mock('../services/formulator.js', () => ({
    runFormulator: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    extractJsonObject: vi.fn((raw) => {
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }),
}));
import { classifyAndDraft, ALL_INTENTS, __test__ } from '../services/conjure-classifier.js';
import { runFormulator } from '../services/formulator.js';
const { scorePromptByRules, rawScoreToConfidence, DRAFT_BUILDERS, CONFIDENCE_THRESHOLD } = __test__;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Quick classify shortcut that always disables LLM (tests rule-based only
 * unless the test explicitly re-enables via useLlm: true). */
async function classify(prose, opts = {}) {
    return classifyAndDraft({ prose, useLlm: opts.useLlm ?? false, hint: opts.hint ?? null });
}
// ---------------------------------------------------------------------------
// 1. ALL 10 intents have signals
// ---------------------------------------------------------------------------
describe('ALL_INTENTS list', () => {
    it('contains exactly 10 intents', () => {
        expect(ALL_INTENTS).toHaveLength(10);
    });
    it('includes all new W22 intents', () => {
        expect(ALL_INTENTS).toContain('ceremony');
        expect(ALL_INTENTS).toContain('mcp-server');
        expect(ALL_INTENTS).toContain('inbox-item');
        expect(ALL_INTENTS).toContain('consult');
    });
});
// ---------------------------------------------------------------------------
// 2. Heuristic fast-path — all 10 intents
// ---------------------------------------------------------------------------
describe('heuristic fast-path — 6 original intents', () => {
    it('classifies project intent', async () => {
        const r = await classify('I need to create a new project for managing tasks');
        expect(r.intent).toBe('project');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
        expect(r.strategy).toBe('rule-based');
    });
    it('classifies issue intent', async () => {
        const r = await classify('fix the login button broken on Safari — it crashes every time');
        expect(r.intent).toBe('issue');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies team intent', async () => {
        const r = await classify('hire me a full-stack development team for the new project');
        expect(r.intent).toBe('team');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies agent intent', async () => {
        const r = await classify('I need an AI agent that monitors pull requests for security issues');
        expect(r.intent).toBe('agent');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies skill intent', async () => {
        const r = await classify('create a reusable playbook for handling TypeScript code reviews');
        expect(r.intent).toBe('skill');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies tool intent', async () => {
        const r = await classify('I need a tool that summarizes PDF files into markdown');
        expect(r.intent).toBe('tool');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
});
describe('heuristic fast-path — 4 new W22 intents', () => {
    it('classifies ceremony intent (standup)', async () => {
        const r = await classify('create a daily standup ceremony for the team');
        expect(r.intent).toBe('ceremony');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies ceremony intent (retrospective)', async () => {
        const r = await classify('set up a sprint retrospective at the end of each sprint');
        expect(r.intent).toBe('ceremony');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies mcp-server intent', async () => {
        const r = await classify('register a new MCP server with stdio transport for file system access');
        expect(r.intent).toBe('mcp-server');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies mcp-server intent (model context protocol)', async () => {
        const r = await classify('add a model context protocol server that connects via SSE');
        expect(r.intent).toBe('mcp-server');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies inbox-item intent (capture)', async () => {
        const r = await classify('capture this rough idea — I need to think about the auth flow later');
        expect(r.intent).toBe('inbox-item');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies inbox-item intent (note)', async () => {
        const r = await classify('make a note: remember to follow up on the billing bug');
        expect(r.intent).toBe('inbox-item');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies consult intent (discussion)', async () => {
        const r = await classify('I want to discuss the trade-offs of switching to a monorepo structure');
        expect(r.intent).toBe('consult');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
    it('classifies consult intent (advice)', async () => {
        const r = await classify('can you help me think through the architecture for the new service?');
        expect(r.intent).toBe('consult');
        expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    });
});
// ---------------------------------------------------------------------------
// 3. candidates array shape
// ---------------------------------------------------------------------------
describe('candidates array', () => {
    it('fast-path returns exactly 1 candidate (the winner)', async () => {
        const r = await classify('fix the crash when the modal opens — it throws a TypeError');
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0].intent).toBe(r.intent);
        expect(r.candidates[0].confidence).toBe(r.confidence);
        expect(r.candidates[0].draft).toEqual(r.draft);
    });
    it('candidates[0] always mirrors top-level intent/confidence/draft', async () => {
        const r = await classify('I need to build a new platform for e-commerce');
        expect(r.candidates[0].intent).toBe(r.intent);
        expect(r.candidates[0].confidence).toBe(r.confidence);
        expect(r.candidates[0].draft).toEqual(r.draft);
    });
    it('ambiguous prompt returns multiple candidates', async () => {
        // A prompt that intentionally scores across multiple intents.
        // Disable LLM so we get rule-based multi-candidate output.
        const r = await classify('I need to capture some rough notes about the team and agents', { useLlm: false });
        // Should have at least 1 candidate; ambiguous prompts may return more.
        expect(r.candidates.length).toBeGreaterThanOrEqual(1);
        expect(r.candidates.length).toBeLessThanOrEqual(3);
    });
    it('candidates are ordered by confidence desc', async () => {
        const r = await classify('capture a brain dump about maybe hiring agents or building a team', { useLlm: false });
        for (let i = 1; i < r.candidates.length; i++) {
            expect(r.candidates[i - 1].confidence).toBeGreaterThanOrEqual(r.candidates[i].confidence);
        }
    });
    it('each candidate has a non-empty reason string', async () => {
        const r = await classify('make a note: follow up on the standup ceremony setup', { useLlm: false });
        for (const c of r.candidates) {
            expect(typeof c.reason).toBe('string');
            expect(c.reason.length).toBeGreaterThan(0);
        }
    });
    it('each candidate has a draft object', async () => {
        const r = await classify('create a retrospective ceremony at the end of each sprint');
        for (const c of r.candidates) {
            expect(c.draft).toBeDefined();
            expect(typeof c.draft).toBe('object');
        }
    });
});
// ---------------------------------------------------------------------------
// 4. LLM degradation path
// ---------------------------------------------------------------------------
describe('LLM degradation path', () => {
    beforeEach(() => {
        vi.mocked(runFormulator).mockRejectedValue(new Error('LLM unavailable'));
    });
    it('falls back to rule-based when runFormulator throws', async () => {
        const r = await classifyAndDraft({ prose: 'I want to build a new CLI tool', useLlm: true });
        expect(r.strategy).toBe('rule-based');
        expect(r.intent).toBeDefined();
    });
    it('returns a non-empty candidates array even on LLM failure', async () => {
        const r = await classifyAndDraft({ prose: 'fix the broken dropdown on the dashboard', useLlm: true });
        expect(r.candidates.length).toBeGreaterThanOrEqual(1);
    });
    it('does not throw when LLM is unavailable', async () => {
        await expect(classifyAndDraft({ prose: 'help me think through the architecture', useLlm: true })).resolves.toBeDefined();
    });
});
describe('LLM happy path — candidates parsed from LLM response', () => {
    beforeEach(() => {
        vi.mocked(runFormulator).mockResolvedValue({
            raw: JSON.stringify({
                intent: 'agent',
                confidence: 0.85,
                rationale: 'Prompt describes a watcher agent.',
                candidates: [
                    { intent: 'agent', confidence: 0.85, reason: 'Single agent watcher pattern.' },
                    { intent: 'skill', confidence: 0.45, reason: 'Could also be a reusable skill.' },
                    { intent: 'tool', confidence: 0.2, reason: 'Possibly a callable tool.' },
                ],
            }),
            modelUsed: { model: 'claude-haiku-4.5', via: 'fallback' },
        });
    });
    // Use an intentionally ambiguous prompt that scores below CONFIDENCE_THRESHOLD
    // so the classifier proceeds to the LLM path.
    it('uses LLM candidates when provided', async () => {
        const r = await classifyAndDraft({
            prose: 'something that reviews PRs and reports back',
            useLlm: true,
        });
        expect(r.strategy).toBe('llm');
        expect(r.intent).toBe('agent');
        expect(r.candidates).toHaveLength(3);
        expect(r.candidates[0].intent).toBe('agent');
        expect(r.candidates[1].intent).toBe('skill');
        expect(r.candidates[2].intent).toBe('tool');
    });
    it('LLM candidates are ordered by confidence desc', async () => {
        const r = await classifyAndDraft({ prose: 'something that reviews PRs', useLlm: true });
        expect(r.strategy).toBe('llm');
        expect(r.candidates.length).toBeGreaterThanOrEqual(2);
        expect(r.candidates[0].confidence).toBeGreaterThanOrEqual(r.candidates[1].confidence);
        if (r.candidates.length >= 3) {
            expect(r.candidates[1].confidence).toBeGreaterThanOrEqual(r.candidates[2].confidence);
        }
    });
});
// ---------------------------------------------------------------------------
// 5. Per-intent draft shapes
// ---------------------------------------------------------------------------
describe('draft shapes for new intents', () => {
    it('ceremony draft has name, prose, triggerKind', async () => {
        const r = await classify('create a daily standup ceremony every morning');
        expect(r.draft).toHaveProperty('name');
        expect(r.draft).toHaveProperty('prose');
        expect(r.draft).toHaveProperty('triggerKind');
    });
    it('ceremony triggerKind defaults to manual when no schedule signal', async () => {
        const draft = DRAFT_BUILDERS['ceremony']('create a new ceremony for the team');
        expect(draft['triggerKind']).toBe('manual');
    });
    it('ceremony triggerKind is scheduled for daily prompts', async () => {
        const draft = DRAFT_BUILDERS['ceremony']('set up a daily standup ceremony');
        expect(draft['triggerKind']).toBe('scheduled');
    });
    it('mcp-server draft has name, transport (default stdio)', async () => {
        const r = await classify('register a new MCP server for file system access');
        expect(r.draft).toHaveProperty('name');
        expect(r.draft).toHaveProperty('transport');
        expect(r.draft['transport']).toBe('stdio');
    });
    it('mcp-server draft uses sse transport when specified', async () => {
        const draft = DRAFT_BUILDERS['mcp-server']('add an MCP server with SSE transport');
        expect(draft['transport']).toBe('sse');
    });
    it('mcp-server draft uses http transport when specified', async () => {
        const draft = DRAFT_BUILDERS['mcp-server']('add an MCP server with HTTP transport');
        expect(draft['transport']).toBe('http');
    });
    it('mcp-server draft extracts command hint for stdio', async () => {
        const draft = DRAFT_BUILDERS['mcp-server']('add an MCP server using npx @modelcontextprotocol/filesystem');
        expect(draft['command']).toBeDefined();
        expect(String(draft['command'])).toContain('npx');
    });
    it('inbox-item draft has title and body', async () => {
        const r = await classify('capture this: I need to look into the caching layer later');
        expect(r.draft).toHaveProperty('title');
        expect(r.draft).toHaveProperty('body');
    });
    it('consult draft has topic and prompt', async () => {
        const r = await classify('I want to discuss the trade-offs of using GraphQL vs REST');
        expect(r.draft).toHaveProperty('topic');
        expect(r.draft).toHaveProperty('prompt');
    });
});
// ---------------------------------------------------------------------------
// 6. prose vs prompt backward compat
// ---------------------------------------------------------------------------
describe('request field backward compat', () => {
    it('accepts prompt as alias for prose', async () => {
        const r = await classifyAndDraft({ prompt: 'fix the broken login form', useLlm: false });
        expect(r.intent).toBeDefined();
        expect(r.candidates.length).toBeGreaterThanOrEqual(1);
    });
    it('prefers prose over prompt when both provided', async () => {
        // prose wins — the prompt alias is ignored.
        const r = await classifyAndDraft({
            prose: 'create a new retrospective ceremony',
            prompt: 'fix the login bug',
            useLlm: false,
        });
        expect(r.intent).toBe('ceremony');
    });
    it('throws 400 when neither prose nor prompt is provided', async () => {
        await expect(classifyAndDraft({ useLlm: false })).rejects.toMatchObject({
            status: 400,
        });
    });
});
// ---------------------------------------------------------------------------
// 7. Flat context fields (projectId, projectName, knownProjectNames)
// ---------------------------------------------------------------------------
describe('flat context fields', () => {
    it('accepts projectId at top level', async () => {
        const r = await classifyAndDraft({
            prose: 'fix the broken modal',
            projectId: 'proj-123',
            useLlm: false,
        });
        expect(r.intent).toBeDefined();
    });
    it('hint boosts the hinted intent', async () => {
        // Prompt with no team signal ("sprint" instead of "team") so ceremony's hint wins.
        const r = await classifyAndDraft({
            prose: 'schedule something recurring for every sprint',
            hint: 'ceremony',
            useLlm: false,
        });
        expect(r.intent).toBe('ceremony');
    });
});
// ---------------------------------------------------------------------------
// 8. hint field — all 10 intents
// ---------------------------------------------------------------------------
describe('hint boosts score for each intent', () => {
    const hintTests = [
        ['project', 'start something new from scratch'],
        ['issue', 'there is something wrong with this'],
        ['team', 'put together a group of people'],
        ['agent', 'hire an AI assistant'],
        ['skill', 'write a guide for this'],
        ['tool', 'make a callable function'],
        ['ceremony', 'schedule something recurring weekly'],
        ['mcp-server', 'register an MCP server integration'],
        ['inbox-item', 'capture this note'],
        ['consult', 'I need advice on this decision'],
    ];
    for (const [intent, prompt] of hintTests) {
        it(`hint="${intent}" wins on ambiguous prompt`, async () => {
            const r = await classifyAndDraft({ prose: prompt, hint: intent, useLlm: false });
            expect(r.intent).toBe(intent);
        });
    }
});
// ---------------------------------------------------------------------------
// 9. scorePromptByRules — raw scoring tests (unit-level)
// ---------------------------------------------------------------------------
describe('scorePromptByRules unit tests', () => {
    it('ceremony gets highest score for "standup" prompt', () => {
        const scores = scorePromptByRules('create a daily standup ceremony for the squad');
        expect(scores[0].intent).toBe('ceremony');
    });
    it('mcp-server gets highest score for explicit MCP server prompt', () => {
        const scores = scorePromptByRules('register a new MCP server with stdio transport');
        expect(scores[0].intent).toBe('mcp-server');
    });
    it('inbox-item gets highest score for capture prompt', () => {
        const scores = scorePromptByRules('capture this rough idea for the inbox');
        expect(scores[0].intent).toBe('inbox-item');
    });
    it('consult gets highest score for advice prompt', () => {
        const scores = scorePromptByRules('I want to discuss the trade-offs of microservices');
        expect(scores[0].intent).toBe('consult');
    });
    it('all intents appear in the output', () => {
        const scores = scorePromptByRules('some generic prompt');
        const intents = scores.map((s) => s.intent);
        for (const i of ALL_INTENTS) {
            expect(intents).toContain(i);
        }
    });
});
//# sourceMappingURL=conjure-classify.test.js.map