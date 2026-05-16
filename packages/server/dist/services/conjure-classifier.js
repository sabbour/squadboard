/**
 * services/conjure-classifier.ts — Phase 1 Conjure intent classifier.
 *
 * Conjure replaces the old free-form Capture inbox: the user types ANY
 * prose ("I need a tool that summarizes PDFs", "fix the login button on
 * Safari") and Conjure routes them to the right creation flow with a
 * pre-filled draft.
 *
 * Strategy = HYBRID (Option C from Hockney's spec):
 *   1. Rule-based scoring runs first (fast, deterministic, free).
 *   2. If top score >= CONFIDENCE_THRESHOLD → return immediately.
 *   3. Otherwise, optionally call the LLM (`runFormulator`) to disambiguate;
 *      the LLM call is wrapped in try/catch so a missing SDK / model never
 *      breaks the surface — we degrade to the best rule-based candidate.
 *
 * W22 surfaces 10 intents (per decisions-archive.md §2):
 *   project | issue | team | agent | skill | tool |
 *   ceremony | mcp-server | inbox-item | consult
 */
import { extractJsonObject, runFormulator } from './formulator.js';
export const ALL_INTENTS = [
    'project',
    'issue',
    'team',
    'agent',
    'skill',
    'tool',
    'ceremony',
    'mcp-server',
    'inbox-item',
    'consult',
];
const SIGNALS = {
    project: [
        { pattern: /\b(new\s+)?project\b/i, weight: 3 },
        { pattern: /\b(build|create|spin\s*up|start|launch)\s+(a|an|the|my)?\s*(new\s+)?(app|application|cli|website|site|service|platform|system|product|tool\s*chain|prototype|mvp)\b/i, weight: 3 },
        { pattern: /\bI\s+(want|need)\s+to\s+(build|make|create|ship)\b/i, weight: 2 },
        { pattern: /\b(MVP|prototype|monorepo|codebase|repo|repository)\b/i, weight: 2 },
        { pattern: /\b(app|application|website|platform|product)\b/i, weight: 1 },
    ],
    issue: [
        { pattern: /\b(bug|defect|broken|breaks|crash(?:es|ed|ing)?|regression|hotfix)\b/i, weight: 3 },
        { pattern: /\b(fix|resolve|debug|patch|repair)\s+(the|a|an|this|my|our)\b/i, weight: 3 },
        { pattern: /\b(does\s*n['’]?t|doesn'?t|won'?t|can'?t|cannot|fails?\s*to)\s+(work|load|render|start|build|run|compile|save|open)\b/i, weight: 3 },
        { pattern: /\b(error|exception|stack\s*trace|500|404|NPE|undefined)\b/i, weight: 2 },
        { pattern: /\b(safari|chrome|firefox|edge|mobile|ios|android)\b/i, weight: 1 },
        { pattern: /\b(button|link|input|form|page|modal|dropdown|nav|navbar)\b/i, weight: 1 },
        { pattern: /\b(todo|task|ticket|issue)\b/i, weight: 2 },
    ],
    team: [
        { pattern: /\b(I\s+need\s+a|hire\s+(me\s+)?a|put\s+together\s+a|assemble\s+a|cast\s+a)\s*(new\s+)?(team|squad|crew|cast|group|posse|panel|cohort)\b/i, weight: 4 },
        { pattern: /\b(team|squad|crew|cast|cohort)\b/i, weight: 2 },
        { pattern: /\b(hire|recruit|staff|build\s+a\s+team|build\s+me\s+a\s+team)\b/i, weight: 3 },
        { pattern: /\b(frontend|backend|full[-\s]?stack|design|qa|devops|security)\s+(team|group|crew|squad)\b/i, weight: 3 },
        { pattern: /\b\d+\s+(engineers?|developers?|designers?|people)\b/i, weight: 2 },
    ],
    agent: [
        { pattern: /\b(an?|one|single)\s+(ai\s+)?agent\b/i, weight: 4 },
        { pattern: /\bagent\s+(that|who|to|for|which)\b/i, weight: 3 },
        { pattern: /\b(an?\s+)?(ai|bot|copilot|assistant|persona|character)\s+(that|who|which|to|for)\b/i, weight: 3 },
        { pattern: /\b(watch(?:es|ing)?|monitor(?:s|ing)?|review(?:s|ing)?|automate(?:s|d)?)\s+(the|my|our|all)\b/i, weight: 2 },
        { pattern: /\b(role|persona)\b/i, weight: 1 },
        { pattern: /\b(hire|create|add)\s+(an?|one)\s+(ai|agent|bot|assistant)\b/i, weight: 3 },
    ],
    skill: [
        { pattern: /\b(reusable|shared)\s+(pattern|recipe|playbook|prompt|instruction|guide)\b/i, weight: 4 },
        { pattern: /\b(skill|how[-\s]?to|playbook|recipe|guide|cheat[-\s]?sheet)\b/i, weight: 3 },
        { pattern: /\b(pattern|template)\s+for\s+(handling|doing|writing|reviewing)\b/i, weight: 3 },
        { pattern: /\b(instruction|prompt)s?\s+for\s+(an?\s+)?agent\b/i, weight: 3 },
        { pattern: /\b(claude|copilot)\s+skill\b/i, weight: 4 },
    ],
    tool: [
        { pattern: /\b(MCP\s+server|model\s+context\s+protocol)\b/i, weight: 2 },
        { pattern: /\b(a|an)\s+(custom\s+)?(tool|script|utility|cli\s+command|function|helper)\b/i, weight: 3 },
        { pattern: /\btool\s+(that|to|for|which)\b/i, weight: 3 },
        { pattern: /\bscript\s+(that|to|for|which)\b/i, weight: 3 },
        { pattern: /\b(summarize|summarise|extract|parse|fetch|crawl|scrape|convert|transform|generate|format)\s+(pdf|html|json|markdown|csv|xml|file|files|docs|images?)\b/i, weight: 3 },
        { pattern: /\b(API|endpoint|webhook|integration)\b/i, weight: 1 },
        { pattern: /\b(function|callable|action)\s+the\s+(agent|model|llm)\s+can\s+call\b/i, weight: 4 },
    ],
    ceremony: [
        { pattern: /\b(new\s+)?ceremony\b/i, weight: 4 },
        { pattern: /\b(standup|stand[-\s]?up|daily\s+sync)\b/i, weight: 4 },
        { pattern: /\b(retrospective|retro)\b/i, weight: 4 },
        { pattern: /\b(sprint\s+(planning|review|kickoff)|planning\s+session|kickoff\s+meeting)\b/i, weight: 4 },
        { pattern: /\b(create|schedule|set\s+up|add)\s+(a|an)?\s*(ceremony|ritual|standup|meeting|sync)\b/i, weight: 3 },
        { pattern: /\b(recurring|weekly|daily|bi[-\s]?weekly)\s+(meeting|sync|session|ceremony)\b/i, weight: 3 },
        { pattern: /\b(post[\s-]?mortem|incident\s+review|blameless\s+retro)\b/i, weight: 3 },
    ],
    'mcp-server': [
        { pattern: /\b(MCP\s+server|model\s+context\s+protocol\s+server)\b/i, weight: 5 },
        { pattern: /\b(mcp[-\s]server|mcp\s+tool\s+server)\b/i, weight: 5 },
        { pattern: /\b(stdio|sse|http)\s+(transport|server|mcp)\b/i, weight: 4 },
        { pattern: /\b(register|add|create|connect)\s+(a|an|an?\s+)?(mcp|model\s+context\s+protocol)\s+server\b/i, weight: 5 },
        { pattern: /\bmcp\s+(integration|endpoint|host|daemon)\b/i, weight: 4 },
        { pattern: /\b(npx|uvx|node|python)\s+[^\s]+\s+(stdio|mcp)\b/i, weight: 3 },
    ],
    'inbox-item': [
        { pattern: /\b(capture|inbox|log\s+this|save\s+this|add\s+to\s+inbox)\b/i, weight: 4 },
        { pattern: /\b(make\s+a\s+note|note:|remember\s+this|jot\s+(this\s+)?down)\b/i, weight: 4 },
        { pattern: /\b(I\s+need\s+to\s+(think\s+about|look\s+into|revisit|follow\s+up\s+on))\b/i, weight: 3 },
        { pattern: /\b(reminder|remind\s+me|don'?t\s+forget|flag\s+this)\b/i, weight: 3 },
        { pattern: /\b(unstructured|rough\s+idea|brain\s*dump|not\s+sure\s+yet)\b/i, weight: 3 },
        { pattern: /\b(add\s+to\s+my\s+(list|backlog|notes?|to[-\s]?do))\b/i, weight: 3 },
    ],
    consult: [
        { pattern: /\b(consult|advice|advise|your\s+thoughts?\s+on)\b/i, weight: 4 },
        { pattern: /\b(help\s+me\s+(think\s+through|understand|figure\s+out|decide|plan))\b/i, weight: 4 },
        { pattern: /\b(what\s+do\s+you\s+think\s+(about|of))\b/i, weight: 4 },
        { pattern: /\b(I\s+want\s+to\s+(discuss|talk\s+(through|about)|chat\s+about|explore))\b/i, weight: 4 },
        { pattern: /\b(can\s+you\s+(help\s+me|explain|walk\s+me\s+through|analyze))\b/i, weight: 3 },
        { pattern: /\b(question:|ask:|should\s+I|how\s+should\s+I|trade[-\s]?off)\b/i, weight: 3 },
        { pattern: /\b(brainstorm|ideate|explore\s+options|pros\s+and\s+cons)\b/i, weight: 3 },
    ],
};
/** Run the rule-based scorer over `prompt`. Returns scores for ALL intents,
 * sorted by score desc. Pure / deterministic. */
function scorePromptByRules(prompt, hint) {
    const text = prompt;
    const scores = ALL_INTENTS.map((intent) => {
        let raw = 0;
        const matched = [];
        for (const sig of SIGNALS[intent]) {
            if (sig.pattern.test(text)) {
                raw += sig.weight;
                matched.push(sig.pattern.source);
            }
        }
        return { intent, rawScore: raw, matched };
    });
    if (hint && ALL_INTENTS.includes(hint)) {
        for (const s of scores) {
            if (s.intent === hint) {
                s.rawScore = s.rawScore * 1.5 + 1;
                s.matched.unshift('(user hint)');
            }
        }
    }
    scores.sort((a, b) => b.rawScore - a.rawScore);
    return scores;
}
/** Convert a raw score to a 0..1 confidence using a soft saturation curve. */
function rawScoreToConfidence(raw) {
    if (raw <= 0)
        return 0;
    const c = raw / (raw + 2.5);
    return Math.min(1, Math.max(0, c));
}
/** When all intents score 0 we still need to pick something — default to
 * `issue` per the team's locked-in design (board captures default to
 * issues when no clear signal exists). */
const AMBIGUOUS_DEFAULT = 'issue';
/** Confidence at or above this skips the LLM disambiguation call. */
const CONFIDENCE_THRESHOLD = 0.55;
// ---------------------------------------------------------------------------
// Draft builders
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'on', 'in', 'for', 'to', 'from', 'with', 'at', 'by', 'about', 'as', 'i', 'we', 'you', 'it', 'this', 'that', 'these', 'those', 'my', 'our', 'your', 'their', 'need', 'want', 'build', 'create', 'make', 'add', 'want', 'one', 'some', 'any',
]);
function firstSentence(prompt) {
    const m = prompt.match(/[^.!?\n]{1,160}([.!?]|\n|$)/);
    return (m ? m[0] : prompt).trim().replace(/[.!?]\s*$/, '');
}
function toKebab(s, max = 30) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .filter((w) => !STOPWORDS.has(w))
        .slice(0, 4)
        .join('-')
        .slice(0, max) || 'untitled';
}
function imperativeTitle(prompt, max = 80) {
    const sentence = firstSentence(prompt);
    const cleaned = sentence
        .replace(/^\s*(I\s+(want|need|would\s+like)\s+to|please|can\s+you|could\s+you|let['’]?s)\s+/i, '')
        .replace(/^\s*the\s+/i, '')
        .trim();
    const truncated = cleaned.length > max ? cleaned.slice(0, max - 1).trimEnd() + '…' : cleaned;
    return truncated.charAt(0).toUpperCase() + truncated.slice(1);
}
function detectKeywords(prompt, candidates) {
    const lower = prompt.toLowerCase();
    return candidates.filter((c) => lower.includes(c.toLowerCase()));
}
function buildIssueDraft(prompt) {
    const title = imperativeTitle(prompt);
    const labels = detectKeywords(prompt, ['bug', 'ui', 'backend', 'frontend', 'docs', 'performance', 'security']);
    if (/\b(bug|broken|breaks|crash|regression|hotfix|fix)\b/i.test(prompt) && !labels.includes('bug')) {
        labels.unshift('bug');
    }
    const priority = /\b(urgent|asap|production|blocker|critical|p0|p1)\b/i.test(prompt)
        ? 'high'
        : /\b(minor|nit|cleanup|nice\s*to\s*have)\b/i.test(prompt)
            ? 'low'
            : 'medium';
    return {
        title,
        body: prompt.trim(),
        suggestedLabels: labels,
        suggestedPriority: priority,
    };
}
function buildProjectDraft(prompt) {
    const name = toKebab(firstSentence(prompt));
    const description = imperativeTitle(prompt, 200);
    const tags = [];
    if (/\bcli\b/i.test(prompt))
        tags.push('cli');
    if (/\bweb(site)?|app(lication)?\b/i.test(prompt))
        tags.push('web');
    if (/\bmobile|ios|android\b/i.test(prompt))
        tags.push('mobile');
    if (/\bapi|backend|server\b/i.test(prompt))
        tags.push('backend');
    return {
        name,
        description,
        suggestedTags: tags,
    };
}
function buildTeamDraft(prompt) {
    const lower = prompt.toLowerCase();
    const roles = [];
    if (/frontend|react|ui|ux|design/i.test(prompt))
        roles.push('Frontend Developer');
    if (/backend|api|server|database/i.test(prompt))
        roles.push('Backend Developer');
    if (/devops|infra|deploy|ci|cd|kubernetes|docker/i.test(prompt))
        roles.push('DevOps Engineer');
    if (/qa|test|quality/i.test(prompt))
        roles.push('QA Engineer');
    if (/design(er)?|figma|wireframe|mock/i.test(prompt))
        roles.push('Designer');
    if (/security|auth|owasp|pen[-\s]?test/i.test(prompt))
        roles.push('Security Engineer');
    if (roles.length === 0) {
        roles.push('Backend Developer', 'Frontend Developer');
    }
    let universe = null;
    for (const u of ['ocean11', 'usual-suspects', 'parks-rec', 'parks-and-rec', 'office']) {
        if (lower.includes(u)) {
            universe = u;
            break;
        }
    }
    let projectType = 'web-app';
    if (/cli|command\s*line/i.test(prompt))
        projectType = 'cli';
    else if (/api|service|backend/i.test(prompt) && !/frontend|ui/i.test(prompt))
        projectType = 'api-service';
    else if (/mobile|ios|android/i.test(prompt))
        projectType = 'mobile-app';
    return {
        universe,
        roles,
        teamSize: Math.max(roles.length, 3),
        projectType,
    };
}
function buildAgentDraft(prompt) {
    const sentence = firstSentence(prompt);
    const role = imperativeTitle(sentence.replace(/^(an?|one)\s+(ai\s+)?agent\s+(that|who|which|to|for)\s+/i, ''), 40);
    const expertise = detectKeywords(prompt, [
        'TypeScript', 'Python', 'React', 'Node', 'AWS', 'Postgres', 'Docker',
        'Kubernetes', 'CI', 'security', 'testing', 'linting', 'docs', 'review',
    ]);
    const suggestedModel = /\b(complex|reasoning|hard|deep|opus)\b/i.test(prompt) ? 'claude-opus-4.6'
        : /\b(cheap|fast|simple|haiku)\b/i.test(prompt) ? 'claude-haiku-4.5'
            : 'auto';
    return {
        name: toKebab(role || 'agent'),
        role: role || 'AI Agent',
        expertise: expertise.length > 0 ? expertise : ['general'],
        suggestedModel,
    };
}
function buildSkillDraft(prompt) {
    const sentence = firstSentence(prompt);
    const cleaned = sentence
        .replace(/^\s*(a|an)\s+(reusable\s+)?(pattern|skill|how[-\s]?to|recipe|guide|playbook)\s+(for|on|to)\s+/i, '')
        .trim();
    return {
        name: toKebab(cleaned || 'skill'),
        description: imperativeTitle(cleaned || sentence, 120),
        body: prompt.trim(),
    };
}
function buildToolDraft(prompt) {
    const sentence = firstSentence(prompt);
    const cleaned = sentence
        .replace(/^\s*(a|an)\s+(custom\s+)?(tool|script|utility|function|mcp\s+server)\s+(that|to|for|which)\s+/i, '')
        .trim();
    // Very rough parameter inference: if prompt mentions a common input type,
    // sketch a tiny JSON-Schema fragment so the user has something to edit.
    const properties = {};
    if (/\bpdf\b/i.test(prompt))
        properties['pdfUrl'] = { type: 'string', description: 'URL of the PDF file' };
    if (/\bhtml|webpage|website\b/i.test(prompt))
        properties['url'] = { type: 'string', description: 'URL to fetch' };
    if (/\btext|prose\b/i.test(prompt))
        properties['text'] = { type: 'string', description: 'Input text' };
    if (Object.keys(properties).length === 0) {
        properties['input'] = { type: 'string', description: 'Tool input' };
    }
    const suggestedSchema = {
        type: 'object',
        properties,
        required: Object.keys(properties),
    };
    return {
        name: toKebab(cleaned || 'tool'),
        description: imperativeTitle(cleaned || sentence, 120),
        suggestedSchema,
        isMcpServer: /\bmcp\b/i.test(prompt),
    };
}
function buildCeremonyDraft(prompt) {
    const title = imperativeTitle(prompt);
    let triggerKind = 'manual';
    if (/\b(daily|every\s+day|each\s+day|weekday|monday|tuesday|wednesday|thursday|friday)\b/i.test(prompt)) {
        triggerKind = 'scheduled';
    }
    else if (/\b(on\s+merge|post[-\s]?merge|after\s+merge|pr\s+merged)\b/i.test(prompt)) {
        triggerKind = 'on-merge';
    }
    else if (/\b(sprint\s+(start|end|kickoff|review|planning)|beginning\s+of\s+sprint|end\s+of\s+sprint)\b/i.test(prompt)) {
        triggerKind = 'sprint-boundary';
    }
    return {
        name: toKebab(title || 'ceremony'),
        prose: prompt.trim(),
        triggerKind,
    };
}
function buildMcpServerDraft(prompt) {
    let transport = 'stdio';
    if (/\bsse\b/i.test(prompt))
        transport = 'sse';
    else if (/\bhttp\b/i.test(prompt))
        transport = 'http';
    const sentence = firstSentence(prompt);
    const cleaned = sentence
        .replace(/^\s*(a|an|register|add|create|connect)\s+(an?\s+)?(mcp\s+server|mcp-server|model\s+context\s+protocol\s+server)\s+(that|to|for|which|called|named)?\s*/i, '')
        .trim();
    const result = {
        name: toKebab(cleaned || 'mcp-server'),
        transport,
    };
    const cmdMatch = prompt.match(/\b(npx|uvx|node|python|deno|bun)\s+([\w@/.-]+(?:\s+[\w@/.-]+)*)/i);
    if (cmdMatch)
        result['command'] = cmdMatch[0].trim();
    const urlMatch = prompt.match(/https?:\/\/[^\s"']+/i);
    if (urlMatch)
        result['url'] = urlMatch[0];
    return result;
}
function buildInboxItemDraft(prompt) {
    const title = imperativeTitle(prompt);
    const suggestedLabels = detectKeywords(prompt, ['ui', 'backend', 'frontend', 'docs', 'idea', 'research', 'follow-up']);
    return {
        title,
        body: prompt.trim(),
        suggestedLabels: suggestedLabels.length > 0 ? suggestedLabels : undefined,
    };
}
function buildConsultDraft(prompt) {
    const topic = imperativeTitle(prompt, 80);
    return {
        topic,
        prompt: prompt.trim(),
    };
}
const DRAFT_BUILDERS = {
    project: buildProjectDraft,
    issue: buildIssueDraft,
    team: buildTeamDraft,
    agent: buildAgentDraft,
    skill: buildSkillDraft,
    tool: buildToolDraft,
    ceremony: buildCeremonyDraft,
    'mcp-server': buildMcpServerDraft,
    'inbox-item': buildInboxItemDraft,
    consult: buildConsultDraft,
};
// ---------------------------------------------------------------------------
// Routing table (intent → destination + presentation)
// ---------------------------------------------------------------------------
const ROUTING_TABLE = {
    project: { destination: '/projects/new', presentation: 'page' },
    issue: { destination: '/projects/:projectId/board?conjure=issue', presentation: 'modal' },
    team: { destination: '/projects/:projectId/agents?conjure=team', presentation: 'page' },
    agent: { destination: '/projects/:projectId/agents?conjure=agent', presentation: 'modal' },
    skill: { destination: '/projects/:projectId/skills?conjure=skill', presentation: 'page' },
    tool: { destination: '/projects/:projectId/tools?conjure=tool', presentation: 'page' },
    ceremony: { destination: '/projects/:projectId/ceremonies?conjure=ceremony', presentation: 'page' },
    'mcp-server': { destination: '/projects/:projectId/mcp?conjure=mcp-server', presentation: 'page' },
    'inbox-item': { destination: '/projects/:projectId/board?conjure=inbox-item', presentation: 'modal' },
    consult: { destination: '/consult?conjure=1', presentation: 'modal' },
};
function buildRouting(intent, scores) {
    const base = ROUTING_TABLE[intent];
    const fallbacks = scores
        .filter((s) => s.intent !== intent && s.rawScore > 0)
        .slice(0, 2)
        .map((s) => s.intent);
    return {
        destination: base.destination,
        presentation: base.presentation,
        fallbacks,
    };
}
// ---------------------------------------------------------------------------
// LLM disambiguation (Option C — only fires when rule-based is uncertain)
// ---------------------------------------------------------------------------
const LLM_SYSTEM_MESSAGE = 'You are an intent classifier for Squadboard. Given a user prompt, decide ' +
    'which of these 10 kinds of artifact they want to create: project, issue, ' +
    'team, agent, skill, tool, ceremony, mcp-server, inbox-item, consult. ' +
    'Return JSON only — no prose, no fences.';
function buildLlmPrompt(prompt, ctx) {
    const project = ctx?.currentProjectName
        ? `User is in project: "${ctx.currentProjectName}".`
        : 'User is not currently in a project.';
    const known = ctx?.knownProjectNames?.length
        ? `Known projects in workspace: ${ctx.knownProjectNames.join(', ')}.`
        : '';
    return `${project}${known ? '\n' + known : ''}

USER PROMPT:
"""
${prompt.trim()}
"""

Choose the best match from: project | issue | team | agent | skill | tool | ceremony | mcp-server | inbox-item | consult

Definitions:
- project    = a new app / system / codebase / MVP to build
- issue      = a bug, fix, or work item to track on the kanban board
- team       = hiring / assembling a multi-agent cast
- agent      = a single AI agent / role / persona
- skill      = a reusable instruction / pattern / how-to / playbook
- tool       = a callable function, script, or utility (not an MCP server)
- ceremony   = a recurring meeting or agile ritual (standup, retro, planning)
- mcp-server = a Model Context Protocol server (stdio/http/sse transport)
- inbox-item = a loose capture / note / reminder with no clear type yet
- consult    = the user wants a conversation / advice / brainstorm session

Return EXACTLY this JSON shape (top-3 candidates ordered by confidence desc):
{
  "intent": "<top choice>",
  "confidence": <number 0..1>,
  "rationale": "<one short sentence>",
  "candidates": [
    { "intent": "<1st>", "confidence": <number 0..1>, "reason": "<one short sentence>" },
    { "intent": "<2nd>", "confidence": <number 0..1>, "reason": "<one short sentence>" },
    { "intent": "<3rd>", "confidence": <number 0..1>, "reason": "<one short sentence>" }
  ]
}
If only one intent is plausible, return a candidates array with 1 entry.`;
}
async function classifyWithLlm(prompt, ctx) {
    try {
        const { raw } = await runFormulator({
            prompt: buildLlmPrompt(prompt, ctx),
            projectId: ctx?.currentProjectId ?? null,
            systemMessage: LLM_SYSTEM_MESSAGE,
        });
        const parsed = extractJsonObject(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return null;
        const obj = parsed;
        const intent = obj['intent'];
        if (typeof intent !== 'string' || !ALL_INTENTS.includes(intent)) {
            return null;
        }
        const conf = typeof obj['confidence'] === 'number' ? Math.min(1, Math.max(0, obj['confidence'])) : 0.6;
        const rationale = typeof obj['rationale'] === 'string' ? obj['rationale'].trim() : 'Classified by LLM.';
        // Parse candidates array if the LLM returned it.
        let candidates;
        if (Array.isArray(obj['candidates'])) {
            candidates = obj['candidates']
                .filter((c) => !!c && typeof c === 'object' && !Array.isArray(c))
                .filter((c) => typeof c['intent'] === 'string' && ALL_INTENTS.includes(c['intent']))
                .map((c) => ({
                intent: c['intent'],
                confidence: typeof c['confidence'] === 'number' ? Math.min(1, Math.max(0, c['confidence'])) : 0,
                reason: typeof c['reason'] === 'string' ? c['reason'].trim() : '',
            }))
                .slice(0, 3);
        }
        return { intent: intent, confidence: conf, rationale, candidates };
    }
    catch (err) {
        console.warn('[conjure] LLM disambiguation failed, falling back to rule-based:', err.message);
        return null;
    }
}
// ---------------------------------------------------------------------------
// Helpers — candidate list construction
// ---------------------------------------------------------------------------
/** Build up to `limit` candidates from rule scores, pre-building their drafts. */
function ruleBasedCandidates(scores, prompt, limit = 3) {
    return scores
        .filter((s) => s.rawScore > 0)
        .slice(0, limit)
        .map((s) => ({
        intent: s.intent,
        confidence: rawScoreToConfidence(s.rawScore),
        reason: `Rule-based signal (score=${s.rawScore.toFixed(1)}, ${s.matched.length} pattern${s.matched.length === 1 ? '' : 's'} hit).`,
        draft: DRAFT_BUILDERS[s.intent](prompt),
    }));
}
/** Merge LLM-returned candidates with rule-based fallback up to `limit` total. */
function mergeCandidates(llm, ruleScores, prompt, limit = 3) {
    // If the LLM gave us a structured candidates list, use it (trust the model).
    if (llm.candidates && llm.candidates.length > 0) {
        return llm.candidates.slice(0, limit).map((c) => ({
            intent: c.intent,
            confidence: c.confidence,
            reason: c.reason || llm.rationale,
            draft: DRAFT_BUILDERS[c.intent](prompt),
        }));
    }
    // Otherwise, LLM gave us only the top pick — complement with rule-based.
    const result = [{
            intent: llm.intent,
            confidence: llm.confidence,
            reason: llm.rationale,
            draft: DRAFT_BUILDERS[llm.intent](prompt),
        }];
    for (const s of ruleScores) {
        if (result.length >= limit)
            break;
        if (s.intent === llm.intent || s.rawScore <= 0)
            continue;
        result.push({
            intent: s.intent,
            confidence: rawScoreToConfidence(s.rawScore),
            reason: `Rule-based signal (score=${s.rawScore.toFixed(1)}).`,
            draft: DRAFT_BUILDERS[s.intent](prompt),
        });
    }
    return result;
}
// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------
export async function classifyAndDraft(req) {
    // Accept `prose` (new canonical name) or `prompt` (backward-compat alias).
    const rawInput = req.prose ?? req.prompt ?? '';
    const prompt = rawInput.trim();
    if (!prompt) {
        throw Object.assign(new Error('prose (or prompt) is required'), { status: 400 });
    }
    if (prompt.length > 10_000) {
        throw Object.assign(new Error('prose exceeds 10,000 characters'), { status: 413 });
    }
    // Build a unified context from either the nested `context` object or flat fields.
    const ctx = {
        currentProjectId: req.projectId ?? req.context?.currentProjectId ?? null,
        currentProjectName: req.projectName ?? req.context?.currentProjectName ?? null,
        knownProjectNames: req.knownProjectNames ?? req.context?.knownProjectNames ?? [],
    };
    const useLlm = req.useLlm !== false;
    const scores = scorePromptByRules(prompt, req.hint ?? null);
    const top = scores[0];
    const ruleConfidence = rawScoreToConfidence(top.rawScore);
    const allZero = scores.every((s) => s.rawScore === 0);
    const ruleIntent = allZero ? AMBIGUOUS_DEFAULT : top.intent;
    // Fast path: rule-based is confident enough — return immediately.
    // candidates = [winner] only (spec: "single high-confidence match").
    if (ruleConfidence >= CONFIDENCE_THRESHOLD) {
        const draft = DRAFT_BUILDERS[ruleIntent](prompt);
        const rationale = `Rule-based match (score=${top.rawScore.toFixed(1)}, ${top.matched.length} signal${top.matched.length === 1 ? '' : 's'} hit).`;
        const winner = { intent: ruleIntent, confidence: ruleConfidence, reason: rationale, draft };
        return {
            intent: ruleIntent,
            confidence: ruleConfidence,
            draft,
            candidates: [winner],
            routing: buildRouting(ruleIntent, scores),
            rationale,
            strategy: 'rule-based',
        };
    }
    // Slow path: ambiguous → ask the LLM.
    if (useLlm) {
        const llm = await classifyWithLlm(prompt, ctx);
        if (llm) {
            const draft = DRAFT_BUILDERS[llm.intent](prompt);
            const candidates = mergeCandidates(llm, scores, prompt, 3);
            return {
                intent: llm.intent,
                confidence: llm.confidence,
                draft,
                candidates,
                routing: buildRouting(llm.intent, scores),
                rationale: llm.rationale,
                strategy: 'llm',
            };
        }
    }
    // Final fallback: best rule guess (or AMBIGUOUS_DEFAULT) with low confidence.
    const draft = DRAFT_BUILDERS[ruleIntent](prompt);
    const candidates = allZero
        ? [{ intent: ruleIntent, confidence: 0.2, reason: `Defaulted to "${AMBIGUOUS_DEFAULT}" (no clear signals).`, draft }]
        : ruleBasedCandidates(scores, prompt, 3);
    const rationale = allZero
        ? `Prompt was ambiguous — defaulted to "${AMBIGUOUS_DEFAULT}". User can override via fallbacks.`
        : `Rule-based best guess (low confidence, ${top.matched.length} signal${top.matched.length === 1 ? '' : 's'} hit).`;
    return {
        intent: ruleIntent,
        confidence: allZero ? 0.2 : ruleConfidence,
        draft,
        candidates,
        routing: buildRouting(ruleIntent, scores),
        rationale,
        strategy: 'rule-based',
    };
}
// ---------------------------------------------------------------------------
// Test-only exports — let unit tests reach the rule scorer without spinning
// up the SDK. Not part of the documented API.
// ---------------------------------------------------------------------------
export const __test__ = {
    scorePromptByRules,
    rawScoreToConfidence,
    buildRouting,
    DRAFT_BUILDERS,
    CONFIDENCE_THRESHOLD,
    AMBIGUOUS_DEFAULT,
};
//# sourceMappingURL=conjure-classifier.js.map