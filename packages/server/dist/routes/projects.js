import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
const BUNDLE_TEMPLATES = {
    'library-or-sdk-project': {
        bundleId: 'library-or-sdk-project',
        bundleName: 'Library / SDK Project',
        description: 'Kanban for library/SDK development: triage through release.',
        team: [
            { name: 'Lead', role: 'Library Lead' },
            { name: 'Implementer', role: 'Core Implementer' },
            { name: 'Docs', role: 'Documentation Writer' },
            { name: 'Tester', role: 'QA / Test Engineer' },
        ],
        ceremonies: [
            { name: 'API RFC', cadence: 'on-demand' },
            { name: 'Version Bump', cadence: 'on-demand' },
            { name: 'Release Notes', cadence: 'on-release' },
        ],
        columns: [
            { slug: 'triage', label: 'Triage' },
            { slug: 'api-design', label: 'API Design' },
            { slug: 'impl', label: 'Impl' },
            { slug: 'docs', label: 'Docs' },
            { slug: 'release', label: 'Release' },
        ],
        skills: ['code-review', 'changelog-writer', 'semver-advisor'],
    },
    'default-software-project': {
        bundleId: 'default-software-project',
        bundleName: 'Default Software Project',
        description: 'General-purpose software project with standard Kanban flow.',
        team: [
            { name: 'Lead', role: 'Tech Lead' },
            { name: 'Dev', role: 'Developer' },
            { name: 'Reviewer', role: 'Code Reviewer' },
        ],
        ceremonies: [
            { name: 'Sprint Planning', cadence: 'weekly' },
            { name: 'Retro', cadence: 'biweekly' },
        ],
        columns: [
            { slug: 'backlog', label: 'Backlog' },
            { slug: 'in-progress', label: 'In Progress' },
            { slug: 'review', label: 'Review' },
            { slug: 'done', label: 'Done' },
        ],
        skills: ['code-review', 'pr-summarizer', 'issue-formulator'],
    },
    'research-spike': {
        bundleId: 'research-spike',
        bundleName: 'Research Spike',
        description: 'Time-boxed research or exploration project.',
        team: [
            { name: 'Researcher', role: 'Lead Researcher' },
            { name: 'Analyst', role: 'Data Analyst' },
        ],
        ceremonies: [
            { name: 'Findings Review', cadence: 'on-demand' },
            { name: 'Spike Debrief', cadence: 'on-completion' },
        ],
        columns: [
            { slug: 'questions', label: 'Questions' },
            { slug: 'investigating', label: 'Investigating' },
            { slug: 'findings', label: 'Findings' },
            { slug: 'done', label: 'Done' },
        ],
        skills: ['web-search', 'summarizer', 'report-writer'],
    },
    'content-writing-project': {
        bundleId: 'content-writing-project',
        bundleName: 'Content Writing Project',
        description: 'Content creation pipeline: ideation through publication.',
        team: [
            { name: 'Writer', role: 'Lead Writer' },
            { name: 'Editor', role: 'Editor' },
            { name: 'Publisher', role: 'Content Publisher' },
        ],
        ceremonies: [
            { name: 'Editorial Standup', cadence: 'weekly' },
            { name: 'Content Calendar Review', cadence: 'monthly' },
        ],
        columns: [
            { slug: 'ideas', label: 'Ideas' },
            { slug: 'drafting', label: 'Drafting' },
            { slug: 'editing', label: 'Editing' },
            { slug: 'published', label: 'Published' },
        ],
        skills: ['blog-writer', 'seo-advisor', 'proofreader'],
    },
    'ops-runbook-project': {
        bundleId: 'ops-runbook-project',
        bundleName: 'Ops / Incident Runbook',
        description: 'Incident response and operational runbook management.',
        team: [
            { name: 'On-Call', role: 'On-Call Engineer' },
            { name: 'SRE', role: 'Site Reliability Engineer' },
            { name: 'Incident Commander', role: 'Incident Commander' },
        ],
        ceremonies: [
            { name: 'Incident Postmortem', cadence: 'on-incident' },
            { name: 'Runbook Review', cadence: 'monthly' },
        ],
        columns: [
            { slug: 'alert', label: 'Alert' },
            { slug: 'triaging', label: 'Triaging' },
            { slug: 'mitigating', label: 'Mitigating' },
            { slug: 'resolved', label: 'Resolved' },
        ],
        skills: ['incident-responder', 'postmortem-writer', 'alert-analyzer'],
    },
    'bug-bash-project': {
        bundleId: 'bug-bash-project',
        bundleName: 'Bug Bash Project',
        description: 'Structured bug-bash and QA validation campaign.',
        team: [
            { name: 'QA Lead', role: 'QA Lead' },
            { name: 'Tester', role: 'Tester' },
            { name: 'Dev', role: 'Developer' },
        ],
        ceremonies: [
            { name: 'Bug Triage', cadence: 'daily' },
            { name: 'Bash Summary', cadence: 'on-completion' },
        ],
        columns: [
            { slug: 'found', label: 'Found' },
            { slug: 'reproducing', label: 'Reproducing' },
            { slug: 'fixing', label: 'Fixing' },
            { slug: 'verified', label: 'Verified' },
        ],
        skills: ['bug-reporter', 'repro-writer', 'severity-classifier'],
    },
};
/** Keyword sets that map to a bundleId, in priority order. */
const KEYWORD_MAP = [
    { keywords: ['rust', 'cargo', 'crate', 'npm', 'pypi', 'pip', 'gem', 'nuget', 'library', 'sdk', 'package', 'cli', 'command-line', 'module'], bundleId: 'library-or-sdk-project' },
    { keywords: ['writing', 'blog', 'content', 'article', 'newsletter', 'editorial', 'copywriting', 'post', 'publication'], bundleId: 'content-writing-project' },
    { keywords: ['research', 'spike', 'analysis', 'explore', 'investigation', 'data', 'ml', 'machine learning', 'ai', 'experiment', 'python', 'jupyter', 'notebook'], bundleId: 'research-spike' },
    { keywords: ['ops', 'devops', 'infra', 'infrastructure', 'incident', 'runbook', 'sre', 'monitoring', 'cloud', 'kubernetes', 'k8s', 'docker', 'ci/cd', 'deployment'], bundleId: 'ops-runbook-project' },
    { keywords: ['bug', 'test', 'qa', 'quality', 'bash', 'regression', 'testing', 'validation'], bundleId: 'bug-bash-project' },
    { keywords: ['node', 'express', 'react', 'next', 'typescript', 'javascript', 'web', 'api', 'http', 'rest', 'graphql', 'app', 'application', 'backend', 'frontend', 'go', 'golang', 'java', 'kotlin', 'swift', 'c#', 'dotnet', 'php', 'ruby', 'rails'], bundleId: 'default-software-project' },
];
function detectBundle(description) {
    const lower = description.toLowerCase();
    for (const { keywords, bundleId } of KEYWORD_MAP) {
        const matched = keywords.filter((kw) => lower.includes(kw));
        if (matched.length > 0) {
            return { bundleId, matchedKeywords: matched };
        }
    }
    return { bundleId: 'default-software-project', matchedKeywords: [] };
}
const router = Router();
router.get('/', async (_req, res) => {
    const db = getDb();
    const rows = await db.select().from(schema.projects);
    res.json(rows);
});
router.post('/', async (req, res) => {
    const { name, path } = req.body;
    if (!name || !path) {
        res.status(400).json({ error: '`name` and `path` are required' });
        return;
    }
    const db = getDb();
    const [created] = await db
        .insert(schema.projects)
        .values({ name, path })
        .returning();
    res.status(201).json(created);
});
router.get('/:id', async (req, res) => {
    const db = getDb();
    const [project] = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, req.params.id));
    if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
    }
    res.json(project);
});
router.patch('/:id', async (req, res) => {
    const { defaultModel, costModel } = (req.body ?? {});
    const updates = {};
    if (defaultModel !== undefined) {
        let normalized = null;
        if (typeof defaultModel === 'string') {
            const trimmed = defaultModel.trim();
            if (trimmed === '' || trimmed.toLowerCase() === 'auto') {
                normalized = null;
            }
            else {
                normalized = trimmed;
            }
        }
        updates.defaultModel = normalized;
    }
    // Stream D — D6: cost model toggle. 'usd' | 'gh_multipliers' | null (use env default).
    if (costModel !== undefined) {
        if (costModel === null || costModel === '') {
            updates.costModel = null;
        }
        else if (costModel === 'usd' || costModel === 'gh_multipliers') {
            updates.costModel = costModel;
        }
        else {
            res.status(400).json({ error: "costModel must be 'usd', 'gh_multipliers', or null" });
            return;
        }
    }
    if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'No supported fields to update' });
        return;
    }
    const db = getDb();
    const [updated] = await db
        .update(schema.projects)
        .set(updates)
        .where(eq(schema.projects.id, req.params.id))
        .returning();
    if (!updated) {
        res.status(404).json({ error: 'Project not found' });
        return;
    }
    res.json(updated);
});
router.delete('/:id', async (req, res) => {
    const db = getDb();
    const deleted = await db
        .delete(schema.projects)
        .where(eq(schema.projects.id, req.params.id))
        .returning();
    if (deleted.length === 0) {
        res.status(404).json({ ok: false, error: 'Project not found' });
        return;
    }
    res.status(204).send();
});
// ---------------------------------------------------------------------------
// POST /suggest  — O1 Wave 20
// Static keyword-keyed stub. Verbal can wire in an LLM call later.
// ---------------------------------------------------------------------------
router.post('/suggest', (req, res) => {
    const { description = '' } = (req.body ?? {});
    if (typeof description !== 'string') {
        res.status(400).json({ error: '`description` must be a string' });
        return;
    }
    const { bundleId, matchedKeywords } = detectBundle(description);
    const template = BUNDLE_TEMPLATES[bundleId] ?? BUNDLE_TEMPLATES['default-software-project'];
    const suggestion = {
        ...template,
        matchedKeywords,
    };
    res.json(suggestion);
});
export default router;
//# sourceMappingURL=projects.js.map