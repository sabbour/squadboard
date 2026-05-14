import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const COMMON_DEV_DIRS = ['src', 'code', 'projects', 'dev', 'workspace'];
const SCAN_DEPTH = 3;
/**
 * Recursively scan a directory for .squad/ subdirectories up to maxDepth.
 */
async function scanForSquadDirs(dir, currentDepth, maxDepth, found) {
    if (currentDepth > maxDepth)
        return;
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    }
    catch {
        // Unreadable directory — skip silently
        return;
    }
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        if (entry.name === '.squad') {
            found.push(path.join(dir, '.squad'));
            continue; // Don't descend into .squad itself
        }
        // Skip hidden dirs and node_modules to avoid noise
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
        await scanForSquadDirs(path.join(dir, entry.name), currentDepth + 1, maxDepth, found);
    }
}
/**
 * Scan the filesystem for .squad/ directories.
 * Always checks home dir (depth 3) + common dev dirs; additional paths via settings.
 */
export async function discoverSquadDirectories(searchPaths) {
    const home = os.homedir();
    const roots = [
        home,
        ...COMMON_DEV_DIRS.map((d) => path.join(home, d)),
        ...searchPaths,
    ];
    const rawPaths = [];
    await Promise.all(roots.map((root) => scanForSquadDirs(root, 0, SCAN_DEPTH, rawPaths)));
    // Deduplicate
    const uniquePaths = [...new Set(rawPaths)];
    const results = await Promise.all(uniquePaths.map(async (squadPath) => {
        const validation = await validateSquadDir(squadPath);
        if (!validation.valid)
            return null;
        const members = await parseTeamRoster(squadPath).catch(() => []);
        const agentsDir = path.join(squadPath, 'agents');
        let agentCount = 0;
        try {
            const agentEntries = await fs.readdir(agentsDir, { withFileTypes: true });
            agentCount = agentEntries.filter((e) => e.isDirectory()).length;
        }
        catch {
            // No agents/ dir — that's okay
        }
        const hasDecisions = (await fs
            .access(path.join(squadPath, 'decisions.md'))
            .then(() => true)
            .catch(() => false)) ||
            (await fs
                .access(path.join(squadPath, 'decisions'))
                .then(() => true)
                .catch(() => false));
        const stat = await fs.stat(squadPath).catch(() => null);
        const lastModified = stat?.mtime ?? new Date();
        // Derive teamName from team.md first line or fallback to dirname of parent
        const teamName = members.length > 0
            ? path.basename(path.dirname(squadPath))
            : path.basename(path.dirname(squadPath));
        return {
            path: squadPath,
            teamName,
            agentCount,
            hasDecisions,
            lastModified,
        };
    }));
    return results.filter((r) => r !== null);
}
/**
 * Validate that a given path is a well-formed .squad/ directory (must have team.md).
 */
export async function validateSquadDir(squadPath) {
    const errors = [];
    // Must be a directory
    try {
        const stat = await fs.stat(squadPath);
        if (!stat.isDirectory()) {
            errors.push(`${squadPath} is not a directory`);
            return { valid: false, errors };
        }
    }
    catch {
        errors.push(`${squadPath} does not exist or is not accessible`);
        return { valid: false, errors };
    }
    // Must end in .squad (canonical name)
    if (path.basename(squadPath) !== '.squad') {
        errors.push(`Directory must be named ".squad" (got "${path.basename(squadPath)}")`);
    }
    // Must contain team.md
    const teamMdPath = path.join(squadPath, 'team.md');
    try {
        await fs.access(teamMdPath);
    }
    catch {
        errors.push(`Missing required file: team.md`);
    }
    return { valid: errors.length === 0, errors };
}
/**
 * Parse team.md to extract agent names and basic info.
 * Expects lines like: `- **Name** — Role` or `| Name | Role | Status |` (table form).
 */
export async function parseTeamRoster(squadPath) {
    const teamMdPath = path.join(squadPath, 'team.md');
    const content = await fs.readFile(teamMdPath, 'utf-8');
    const members = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        // Markdown list form: `- **Name** — Role` or `- **Name** (retired) — Role`
        const listMatch = trimmed.match(/^-\s+\*\*(.+?)\*\*(?:\s+\((.+?)\))?\s+[—–-]\s+(.+)$/);
        if (listMatch) {
            const [, name, qualifier, role] = listMatch;
            const status = qualifier?.toLowerCase().includes('retired') ? 'retired' : 'active';
            members.push({ name: name.trim(), role: role.trim(), status });
            continue;
        }
        // Table row form: `| Name | Role | active |`
        if (trimmed.startsWith('|') && !trimmed.startsWith('| ---') && !trimmed.startsWith('| Name')) {
            const cols = trimmed
                .split('|')
                .map((c) => c.trim())
                .filter(Boolean);
            if (cols.length >= 2) {
                const status = cols[2]?.toLowerCase().includes('retired') ? 'retired' : 'active';
                members.push({ name: cols[0], role: cols[1], status });
            }
        }
    }
    return members;
}
//# sourceMappingURL=squad-discovery.js.map