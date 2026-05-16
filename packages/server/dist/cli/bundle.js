#!/usr/bin/env node
/**
 * packages/server/src/cli/bundle.ts
 *
 * CLI surface for the Squadboard Bundle system.
 *
 * Usage:
 *   squadboard bundle apply <path-or-url> [flags]
 *
 * Flags:
 *   --dry-run                Validate and show what would be applied — no writes
 *   --overwrite              Overwrite existing resources on conflict (default: skip)
 *   --project-id <uuid>      Apply into an existing project instead of creating one
 *   --json                   Machine-readable JSON output
 *
 * Exit 0 on success, 1 if any errors.
 *
 * Examples:
 *   npx tsx src/cli/bundle.ts apply ./bundles/default-software-project/squad-bundle.json
 *   npx tsx src/cli/bundle.ts apply https://example.com/bundles/my-team/squad-bundle.json
 *   npx tsx src/cli/bundle.ts apply ./bundle.json --dry-run
 *   npx tsx src/cli/bundle.ts apply ./bundle.json --overwrite --project-id <uuid>
 */
import { startPglite } from '../db/pglite.js';
import { initDb } from '../db/index.js';
import { applyBundle, loadBundle } from '../services/bundle-loader.js';
function parseArgs(argv) {
    const args = argv.slice(2);
    const subcommand = args[0] ?? '';
    const pathOrUrl = args[1] ?? '';
    let dryRun = false;
    let overwrite = false;
    let projectId = '';
    let json = false;
    for (let i = 2; i < args.length; i++) {
        const a = args[i];
        if (a === '--dry-run') {
            dryRun = true;
        }
        else if (a === '--overwrite') {
            overwrite = true;
        }
        else if (a === '--json') {
            json = true;
        }
        else if (a === '--project-id' && args[i + 1]) {
            projectId = args[++i];
        }
        else {
            process.stderr.write(`Unknown flag: ${a}\n`);
        }
    }
    return { subcommand, pathOrUrl, dryRun, overwrite, projectId, json };
}
function usage() {
    process.stdout.write(`
squadboard bundle — Manage project configuration bundles

Usage:
  squadboard bundle apply <path-or-url> [flags]

Flags:
  --dry-run            Validate and enumerate changes without writing
  --overwrite          Overwrite existing resources (default: skip with warning)
  --project-id <uuid>  Apply into an existing project
  --json               Output machine-readable JSON result

Examples:
  bundle apply ./bundles/default-software-project/squad-bundle.json
  bundle apply ./bundle.json --dry-run
  bundle apply https://example.com/my-bundle.json --overwrite
`);
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const args = parseArgs(process.argv);
    if (!args.subcommand || args.subcommand === '--help' || args.subcommand === 'help') {
        usage();
        process.exit(0);
    }
    if (args.subcommand !== 'apply') {
        process.stderr.write(`Unknown subcommand: ${args.subcommand}\nRun with --help for usage.\n`);
        process.exit(1);
    }
    if (!args.pathOrUrl) {
        process.stderr.write('Error: path-or-url is required\n');
        usage();
        process.exit(1);
    }
    // Boot DB.
    const pglite = await startPglite();
    await initDb(pglite);
    // Load bundle.
    let bundle;
    try {
        bundle = await loadBundle(args.pathOrUrl);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (args.json) {
            process.stdout.write(JSON.stringify({ errors: [msg] }, null, 2) + '\n');
        }
        else {
            process.stderr.write(`Error loading bundle: ${msg}\n`);
        }
        process.exit(1);
    }
    if (!args.json) {
        process.stdout.write(`Applying bundle "${bundle.bundle.manifest.name}" v${bundle.bundle.manifest.version}` +
            (args.dryRun ? ' (DRY RUN)' : '') +
            '\n');
    }
    // Apply bundle.
    const result = await applyBundle(bundle.bundle, {
        dryRun: args.dryRun,
        overwriteExisting: args.overwrite,
        projectId: args.projectId || undefined,
        bundleDir: bundle.bundleDir,
    });
    if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
    else {
        if (result.applied.length > 0) {
            process.stdout.write('\n✅ Applied:\n');
            for (const item of result.applied) {
                process.stdout.write(`  • ${item}\n`);
            }
        }
        if (result.skipped.length > 0) {
            process.stdout.write('\n⏭  Skipped:\n');
            for (const item of result.skipped) {
                process.stdout.write(`  • ${item}\n`);
            }
        }
        if (result.warnings.length > 0) {
            process.stdout.write('\n⚠️  Warnings:\n');
            for (const w of result.warnings) {
                process.stdout.write(`  • ${w}\n`);
            }
        }
        if (result.errors.length > 0) {
            process.stdout.write('\n❌ Errors:\n');
            for (const e of result.errors) {
                process.stdout.write(`  • ${e}\n`);
            }
        }
        const projectNote = result.meta.projectId ? ` (project ${result.meta.projectId})` : '';
        process.stdout.write(`\nDone${projectNote}: ${result.applied.length} applied, ${result.skipped.length} skipped, ` +
            `${result.warnings.length} warnings, ${result.errors.length} errors.\n`);
    }
    process.exit(result.errors.length > 0 ? 1 : 0);
}
main().catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=bundle.js.map