/**
 * services/irl-gallery.ts
 *
 * Fetches the Squad-IRL sample catalog from GitHub with a 10-minute in-process
 * cache. Each top-level directory in the repo that contains a `squad.config.ts`
 * is treated as one sample.
 *
 * Public API:
 *   listIrlSamples()       → metadata for every sample (cached)
 *   getIrlSample(slug)     → metadata + README + squad.config.ts + index.ts
 *   primeIrlGallery()      → optional prefetch on server start
 *
 * Errors are sticky-cached for a short window so a transient API failure
 * doesn't hammer GitHub on every request.
 */
const REPO_OWNER = 'bradygaster';
const REPO_NAME = 'Squad-IRL';
const REF = 'main';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min for success
const ERROR_CACHE_TTL_MS = 60 * 1000; // 1 min for failures
const summariesCache = { current: null };
const detailsCache = new Map();
function isFresh(cell) {
    return Boolean(cell && cell.expiresAt > Date.now());
}
// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function authHeaders() {
    const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
    const headers = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'squadboard-irl-gallery',
    };
    if (token)
        headers.Authorization = `Bearer ${token}`;
    return headers;
}
async function ghJson(path) {
    const url = `https://api.github.com${path}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
        throw new Error(`GitHub ${res.status} for ${path}: ${await res.text().catch(() => '')}`);
    }
    return (await res.json());
}
async function ghRaw(path) {
    const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REF}/${path}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'squadboard-irl-gallery' } });
    if (!res.ok) {
        if (res.status === 404)
            return '';
        throw new Error(`GitHub raw ${res.status} for ${path}`);
    }
    return await res.text();
}
// ---------------------------------------------------------------------------
// README parsing — extract title + blurb without pulling in a markdown lib
// ---------------------------------------------------------------------------
function extractTitleAndBlurb(readme, fallbackSlug) {
    const lines = readme.split(/\r?\n/);
    let title = '';
    let blurb = '';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line)
            continue;
        const h1 = line.match(/^#\s+(.+)$/);
        if (h1 && !title) {
            title = h1[1].trim();
            continue;
        }
        if (title && !line.startsWith('#') && !line.startsWith('!') && !line.startsWith('<')) {
            blurb = line.replace(/[*_`]/g, '').slice(0, 240);
            break;
        }
    }
    return {
        title: title || fallbackSlug.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' '),
        blurb,
    };
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function listIrlSamples(opts = {}) {
    if (!opts.force && isFresh(summariesCache.current)) {
        return summariesCache.current.value;
    }
    try {
        const top = await ghJson(`/repos/${REPO_OWNER}/${REPO_NAME}/contents?ref=${REF}`);
        const sampleDirs = top.filter((e) => e.type === 'dir' && !e.name.startsWith('.') && !e.name.startsWith('_'));
        // Fetch each dir listing in parallel + opportunistically grab README to
        // derive title/blurb. Limit concurrency to avoid hammering GitHub.
        const summaries = await mapWithConcurrency(sampleDirs, 6, async (dir) => {
            const entries = await ghJson(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${dir.name}?ref=${REF}`).catch(() => []);
            const files = entries.map((e) => e.name);
            const hasConfig = files.includes('squad.config.ts');
            const hasReadme = files.includes('README.md');
            let title = '';
            let blurb = '';
            if (hasReadme) {
                const readme = await ghRaw(`${dir.name}/README.md`).catch(() => '');
                const parsed = extractTitleAndBlurb(readme, dir.name);
                title = parsed.title;
                blurb = parsed.blurb;
            }
            else {
                title = dir.name.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
            }
            return {
                slug: dir.name,
                title,
                blurb,
                files,
                htmlUrl: dir.html_url,
                hasConfig,
            };
        });
        // Stable order: samples-with-config first, then by title.
        summaries.sort((a, b) => {
            if (a.hasConfig !== b.hasConfig)
                return a.hasConfig ? -1 : 1;
            return a.title.localeCompare(b.title);
        });
        summariesCache.current = {
            value: summaries,
            expiresAt: Date.now() + CACHE_TTL_MS,
            isError: false,
        };
        return summaries;
    }
    catch (err) {
        // On error, surface stale data if we have it; otherwise rethrow.
        if (summariesCache.current && !summariesCache.current.isError) {
            return summariesCache.current.value;
        }
        summariesCache.current = {
            value: [],
            expiresAt: Date.now() + ERROR_CACHE_TTL_MS,
            isError: true,
        };
        throw err;
    }
}
export async function getIrlSample(slug, opts = {}) {
    // Validate slug — must be a single-segment directory name.
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
        throw new Error('Invalid sample slug');
    }
    const cached = detailsCache.get(slug);
    if (!opts.force && isFresh(cached) && !cached.isError) {
        return cached.value;
    }
    // Make sure the slug exists in the catalog before fetching.
    const summaries = await listIrlSamples();
    const summary = summaries.find((s) => s.slug === slug);
    if (!summary)
        return null;
    try {
        const [readme, config, entry] = await Promise.all([
            summary.files.includes('README.md') ? ghRaw(`${slug}/README.md`) : Promise.resolve(''),
            summary.files.includes('squad.config.ts') ? ghRaw(`${slug}/squad.config.ts`) : Promise.resolve(''),
            summary.files.includes('index.ts') ? ghRaw(`${slug}/index.ts`) : Promise.resolve(''),
        ]);
        const detail = {
            ...summary,
            readme,
            config,
            entry,
        };
        detailsCache.set(slug, {
            value: detail,
            expiresAt: Date.now() + CACHE_TTL_MS,
            isError: false,
        });
        return detail;
    }
    catch (err) {
        if (cached && !cached.isError)
            return cached.value;
        detailsCache.set(slug, {
            value: { ...summary, readme: '', config: '', entry: '' },
            expiresAt: Date.now() + ERROR_CACHE_TTL_MS,
            isError: true,
        });
        throw err;
    }
}
/** Best-effort prefetch — never throws. Call once at startup if desired. */
export async function primeIrlGallery() {
    try {
        await listIrlSamples({ force: true });
    }
    catch (err) {
        console.warn('[irl-gallery] prime failed:', err.message);
    }
}
/** Test-only: clear caches. */
export function _resetIrlCacheForTests() {
    summariesCache.current = null;
    detailsCache.clear();
}
// ---------------------------------------------------------------------------
// Concurrency helper (no external dep)
// ---------------------------------------------------------------------------
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (cursor < items.length) {
            const idx = cursor++;
            results[idx] = await fn(items[idx], idx);
        }
    });
    await Promise.all(workers);
    return results;
}
//# sourceMappingURL=irl-gallery.js.map