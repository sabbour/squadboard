import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PACKAGES_ROOT,
  REPO_ROOT,
  assertSelectableSquadWorkspace,
  assertSafeSquadScaffoldTarget,
  isInternalSquadCharterPath,
  isInternalSquadWorkspacePath,
  normalizeSquadPath,
} from '../services/squad-path-safety.js';

describe('squad path safety', () => {
  it('treats the repo root .squad as selectable dogfood state', () => {
    expect(isInternalSquadWorkspacePath(path.join(REPO_ROOT, '.squad'))).toBe(false);
    expect(assertSelectableSquadWorkspace(REPO_ROOT)).toBe(path.join(REPO_ROOT, '.squad'));
  });

  it('blocks direct package .squad directories from project selection', () => {
    const serverSquad = path.join(PACKAGES_ROOT, 'server', '.squad');

    expect(isInternalSquadWorkspacePath(serverSquad)).toBe(true);
    expect(() => assertSelectableSquadWorkspace(serverSquad)).toThrow(/internal Squadboard workspace/);
    expect(isInternalSquadCharterPath(path.join(serverSquad, 'agents', 'issue-classifier', 'charter.md'))).toBe(true);
  });

  it('still allows test scratch scaffolds under the approved server test-runs root', () => {
    const testRunRoot = path.join(PACKAGES_ROOT, 'server', '.squad', 'test-runs', 'example-project');

    expect(assertSafeSquadScaffoldTarget(testRunRoot)).toBe(path.join(testRunRoot, '.squad'));
    expect(isInternalSquadWorkspacePath(normalizeSquadPath(testRunRoot))).toBe(false);
  });
});
