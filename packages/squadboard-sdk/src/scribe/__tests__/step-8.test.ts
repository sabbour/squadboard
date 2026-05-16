/**
 * @sabbour/squadboard-sdk — scribe/__tests__/step-8.test.ts
 *
 * Vitest tests for the step-8 HEALTH REPORT artifact writer.
 * Uses a temp directory (within the test runner's tmp) for file writes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeHealthReport,
  type HealthReportOptions,
} from '../steps/step-8-health-report.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sdk-step8-test-'));
}

const BASE_OPTS: Omit<HealthReportOptions, 'teamRoot' | 'dateOverride'> = {
  waveNumber: 20,
  sessionId: 'test-sess-abc123',
  backlogBefore: { total: 10, done: 2, inProgress: 3, blocked: 1, pending: 4 },
  backlogAfter:  { total: 9,  done: 5, inProgress: 2, blocked: 1, pending: 1 },
  spawnSummaries: [
    { name: 'kobayashi', plainLanguageSummary: 'Shipped SDK step-8 + dedupe CLI.', commitSha: 'abc12345' },
    { name: 'verbal',    plainLanguageSummary: 'Fixed UI card flicker bug.' },
  ],
  lineage: [
    { spawnName: 'kobayashi', todosClosed: ['sdk-step8-primitive', 'dedupe-cli'] },
    { spawnName: 'verbal',    todosClosed: ['card-flicker-fix'] },
  ],
  defects: ['Build warning: unused import in routes/issues.ts'],
  nextWaveTodos: [
    { id: 'p1-publish', title: 'Publish npm package', status: 'blocked', blockedReason: 'Awaiting Ahmed approval' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('writeHealthReport (step 8)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes the artifact to the correct path', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    expect(result.path).toBe(
      join(tmpDir, '.squad', 'health', '2026-05-16', 'wave-20-test-sess-abc123.md'),
    );
  });

  it('creates parent directories automatically', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    const content = await readFile(result.path, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('content includes all 6 required sections', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    expect(result.content).toContain('## (a) Wave Summary');
    expect(result.content).toContain('## (b) Backlog Delta');
    expect(result.content).toContain('## (c) Lineage Tree');
    expect(result.content).toContain('## (d) Defects Observed');
    expect(result.content).toContain('## (e) Spawn Summaries (Verbatim)');
    expect(result.content).toContain('## (f) Next-Wave Recommendations');
  });

  it('wave summary section has correct spawn count', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    expect(result.content).toContain('**Spawns**: 2');
    expect(result.content).toContain('**Wave**: 20');
  });

  it('backlog delta section shows before/after counts', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    // Before total=10, after total=9
    expect(result.content).toContain('10');
    expect(result.content).toContain('9');
  });

  it('lineage tree contains spawn names and closed todos', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    expect(result.content).toContain('kobayashi');
    expect(result.content).toContain('sdk-step8-primitive');
    expect(result.content).toContain('dedupe-cli');
    expect(result.content).toContain('card-flicker-fix');
  });

  it('defects section lists observed defects', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    expect(result.content).toContain('Build warning');
  });

  it('spawn summaries section contains verbatim summaries with commit SHA', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    expect(result.content).toContain('Shipped SDK step-8 + dedupe CLI.');
    expect(result.content).toContain('abc12345');
    expect(result.content).toContain('Fixed UI card flicker bug.');
  });

  it('next-wave section surfaces blocked todos', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    expect(result.content).toContain('BLOCKED');
    expect(result.content).toContain('p1-publish');
    expect(result.content).toContain('Awaiting Ahmed approval');
  });

  it('uses wave-unknown when waveNumber=0', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      waveNumber: 0,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    expect(basename(dirname(result.path))).toBe('2026-05-16');
    expect(basename(result.path)).toContain('wave-unknown');
  });

  it('returns same content that was written to disk', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    const onDisk = await readFile(result.path, 'utf8');
    expect(onDisk).toBe(result.content);
  });

  it('handles empty spawnSummaries gracefully', async () => {
    const result = await writeHealthReport({
      ...BASE_OPTS,
      spawnSummaries: [],
      lineage: [],
      defects: [],
      nextWaveTodos: [],
      teamRoot: tmpDir,
      dateOverride: '2026-05-16',
    });

    expect(result.content).toContain('No spawns this wave');
    expect(result.content).toContain('None reported');
    expect(result.content).toContain('Board is clear');
  });
});
