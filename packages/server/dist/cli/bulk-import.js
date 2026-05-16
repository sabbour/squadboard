#!/usr/bin/env node
/**
 * packages/server/src/cli/bulk-import.ts
 *
 * Bulk-imports issues from a JSON file onto a Squadboard project board.
 * Invoked by bin/squad-bulk-import via `npx tsx`.
 *
 * Flags:
 *   --project-id <uuid>      (required)
 *   --file <path>            (required) JSON: Array<{id, title, description, status}>
 *   --status-map <map>       (default 'done:done,pending:backlog,in_progress:backlog,blocked:backlog')
 *   --key-prefix <str>       (default '') prepended to each row's id → idempotency key
 *   --dry-run                (flag)
 *   --body-footer <template> (default see below)
 *   --created-by <str>       (default 'bulk-import')
 *   --json                   (flag) machine-readable output
 *
 * Exit 0 on full success, 1 if any errors.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startPglite } from '../db/pglite.js';
import { initDb } from '../db/index.js';
import { bulkImportIssues } from '../services/bulk-import-issues.js';
// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const args = argv.slice(2);
    let projectId = '';
    let file = '';
    let statusMapStr = 'done:done,pending:backlog,in_progress:backlog,blocked:backlog';
    let keyPrefix = '';
    let dryRun = false;
    let bodyFooter = '';
    let createdBy = 'bulk-import';
    let jsonOutput = false;
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--project-id':
                projectId = args[++i];
                break;
            case '--file':
                file = args[++i];
                break;
            case '--status-map':
                statusMapStr = args[++i];
                break;
            case '--key-prefix':
                keyPrefix = args[++i];
                break;
            case '--dry-run':
                dryRun = true;
                break;
            case '--body-footer':
                bodyFooter = args[++i];
                break;
            case '--created-by':
                createdBy = args[++i];
                break;
            case '--json':
                jsonOutput = true;
                break;
        }
    }
    if (!projectId || !file) {
        console.error('Error: --project-id and --file are required.');
        process.exit(1);
    }
    const statusMap = new Map();
    for (const pair of statusMapStr.split(',')) {
        const [src, tgt] = pair.trim().split(':');
        if (!tgt || (tgt !== 'backlog' && tgt !== 'done')) {
            console.error(`Error: status-map target must be 'backlog' or 'done', got '${tgt}' for source '${src}'.`);
            process.exit(1);
        }
        statusMap.set(src.trim(), tgt);
    }
    return { projectId, file, statusMap, keyPrefix, dryRun, bodyFooter, createdBy, json: jsonOutput };
}
// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------
function mapStatus(src, statusMap) {
    if (!src)
        return statusMap.get('*') ?? 'backlog';
    return statusMap.get(src) ?? statusMap.get('*') ?? 'backlog';
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const opts = parseArgs(process.argv);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const defaultBodyFooter = `\n\n— Ported from ${opts.keyPrefix}{id} on ${today} (inert; not activated for pickup)`;
    const bodyFooterTemplate = opts.bodyFooter || defaultBodyFooter;
    // Load input file.
    const raw = await readFile(resolve(opts.file), 'utf8');
    let inputRows;
    try {
        inputRows = JSON.parse(raw);
    }
    catch (e) {
        console.error(`Error: could not parse JSON from ${opts.file}: ${e}`);
        process.exit(1);
    }
    // Bootstrap DB (connects to PGlite or DATABASE_URL).
    const connectionString = await startPglite();
    await initDb(connectionString);
    // Build items.
    const items = inputRows.map((row) => {
        const idempotencyKey = `${opts.keyPrefix}${row.id}`;
        const mappedStatus = mapStatus(row.status, opts.statusMap);
        const footerText = bodyFooterTemplate.replace('{id}', row.id);
        const body = ((row.description ?? '') + footerText).trim();
        const completedAt = mappedStatus === 'done' ? new Date() : null;
        return {
            idempotencyKey,
            title: row.title,
            body,
            status: mappedStatus,
            completedAt,
        };
    });
    // Run.
    const result = await bulkImportIssues({
        projectId: opts.projectId,
        items,
        dryRun: opts.dryRun,
        createdBy: opts.createdBy,
    });
    // Output.
    if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
    else {
        // Human table.
        const colW = [28, 8, 36, 60];
        const header = [
            'idempotencyKey'.padEnd(colW[0]),
            'action'.padEnd(colW[1]),
            'issueId'.padEnd(colW[2]),
            'error'.padEnd(colW[3]),
        ].join(' | ');
        const sep = colW.map((w) => '-'.repeat(w)).join('-+-');
        console.log(header);
        console.log(sep);
        for (const item of result.items) {
            const row = [
                item.idempotencyKey.slice(0, colW[0]).padEnd(colW[0]),
                (item.action).padEnd(colW[1]),
                (item.issueId ?? '').padEnd(colW[2]),
                (item.error ?? '').slice(0, colW[3]).padEnd(colW[3]),
            ].join(' | ');
            console.log(row);
        }
        console.log('');
        const dryTag = opts.dryRun ? ' (DRY RUN)' : '';
        console.log(`created=${result.created} skipped=${result.skipped} errors=${result.errors.length}${dryTag}`);
    }
    process.exit(result.errors.length > 0 ? 1 : 0);
}
main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
//# sourceMappingURL=bulk-import.js.map