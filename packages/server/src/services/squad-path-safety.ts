import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
export const PACKAGES_ROOT = path.join(REPO_ROOT, 'packages');

const ALLOWED_PACKAGES_SCAFFOLD_PREFIXES = [
  path.join(PACKAGES_ROOT, 'e2e', '.e2e-workspaces'),
  path.join(PACKAGES_ROOT, 'server', '.squad', 'test-runs'),
];

export function isPathWithin(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel));
}

export function normalizeSquadPath(inputPath: string): string {
  const resolved = path.resolve(inputPath.trim());
  return path.basename(resolved) === '.squad'
    ? resolved
    : path.join(resolved, '.squad');
}

export function containingSquadDir(inputPath: string): string | null {
  let current = path.resolve(inputPath);
  for (let depth = 0; depth < 20; depth++) {
    if (path.basename(current) === '.squad') return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export function isInternalSquadWorkspacePath(inputPath: string): boolean {
  const squadPath = normalizeSquadPath(inputPath);
  const projectRoot = path.dirname(squadPath);
  if (!isPathWithin(PACKAGES_ROOT, projectRoot)) return false;
  return !ALLOWED_PACKAGES_SCAFFOLD_PREFIXES.some((prefix) => isPathWithin(prefix, projectRoot));
}

export function isInternalSquadCharterPath(inputPath: string): boolean {
  const squadDir = containingSquadDir(inputPath);
  return squadDir ? isInternalSquadWorkspacePath(squadDir) : false;
}

export function assertSelectableSquadWorkspace(inputPath: string): string {
  const squadPath = normalizeSquadPath(inputPath);
  if (isInternalSquadWorkspacePath(squadPath)) {
    throw Object.assign(
      new Error(
        `Refusing to register internal Squadboard workspace ${squadPath}. ` +
        'Choose a project workspace outside this monorepo package tree.',
      ),
      { status: 422, code: 'internal_squad_workspace' },
    );
  }
  return squadPath;
}

/**
 * Guard user-driven scaffolding from accidentally creating projects inside the
 * Squadboard monorepo's package tree. E2E and unit-test scratch roots are the
 * only repo-internal exceptions.
 */
export function assertSafeSquadScaffoldTarget(inputPath: string): string {
  const squadPath = normalizeSquadPath(inputPath);
  const projectRoot = path.dirname(squadPath);
  if (
    isPathWithin(PACKAGES_ROOT, projectRoot)
    && !ALLOWED_PACKAGES_SCAFFOLD_PREFIXES.some((prefix) => isPathWithin(prefix, projectRoot))
  ) {
    throw Object.assign(
      new Error(
        `Refusing to create a Squadboard project under the repository packages/ directory: ${projectRoot}. ` +
        'Choose an absolute workspace path outside this monorepo, or use the E2E workspace root for tests.',
      ),
      { status: 422, code: 'protected_packages_path' },
    );
  }
  return squadPath;
}
