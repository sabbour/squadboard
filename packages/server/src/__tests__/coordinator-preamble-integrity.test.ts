/**
 * coordinator-preamble-integrity.test.ts — Tests for the opt-in preamble
 * integrity check added in W30 (C-4).
 *
 * 6 tests covering: env unset, matching hash, wrong hash, error shape,
 * empty-string env, whitespace-only env.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  loadCoordinatorPreamble,
  resetPreambleCache,
  CoordinatorPreambleIntegrityError,
} from "../coordinator/preamble.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "coord-integrity-test-"));
}

async function writeInRepoPreamble(root: string, content: string): Promise<string> {
  const squadDir = path.join(root, ".squad");
  await mkdir(squadDir, { recursive: true });
  const filePath = path.join(squadDir, "squadboard-coordinator.md");
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const PREAMBLE_CONTENT = "# Coordinator\n\nYou are the coordinator. kind: dispatch";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("preamble integrity check (COORDINATOR_PREAMBLE_SHA256)", () => {
  let tmpRoot: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    resetPreambleCache();
    savedEnv = process.env.COORDINATOR_PREAMBLE_SHA256;
    delete process.env.COORDINATOR_PREAMBLE_SHA256;
  });

  afterEach(async () => {
    resetPreambleCache();
    // Restore env
    if (savedEnv === undefined) {
      delete process.env.COORDINATOR_PREAMBLE_SHA256;
    } else {
      process.env.COORDINATOR_PREAMBLE_SHA256 = savedEnv;
    }
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = "";
    }
  });

  // 1. env unset → no check, returns preamble normally
  it("1. env unset — no integrity check, returns preamble", async () => {
    tmpRoot = await makeTmpDir();
    await writeInRepoPreamble(tmpRoot, PREAMBLE_CONTENT);

    // env is already deleted in beforeEach
    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("in-repo");
    expect(result.text).toBe(PREAMBLE_CONTENT);
  });

  // 2. env set + matching sha256 → returns preamble
  it("2. env set with matching sha256 — returns preamble", async () => {
    tmpRoot = await makeTmpDir();
    await writeInRepoPreamble(tmpRoot, PREAMBLE_CONTENT);

    process.env.COORDINATOR_PREAMBLE_SHA256 = sha256Hex(PREAMBLE_CONTENT);

    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("in-repo");
    expect(result.text).toBe(PREAMBLE_CONTENT);
  });

  // 3. env set + wrong sha256 → throws CoordinatorPreambleIntegrityError
  it("3. env set with wrong sha256 — throws CoordinatorPreambleIntegrityError", async () => {
    tmpRoot = await makeTmpDir();
    await writeInRepoPreamble(tmpRoot, PREAMBLE_CONTENT);

    process.env.COORDINATOR_PREAMBLE_SHA256 = "deadbeef".repeat(8); // 64 hex chars, definitely wrong

    await expect(
      loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true }),
    ).rejects.toBeInstanceOf(CoordinatorPreambleIntegrityError);
  });

  // 4. error includes both expected and actual hashes
  it("4. CoordinatorPreambleIntegrityError exposes expected and actual hashes", async () => {
    tmpRoot = await makeTmpDir();
    await writeInRepoPreamble(tmpRoot, PREAMBLE_CONTENT);

    const wrong = "cafebabe".repeat(8);
    process.env.COORDINATOR_PREAMBLE_SHA256 = wrong;

    let caught: CoordinatorPreambleIntegrityError | undefined;
    try {
      await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    } catch (err) {
      if (err instanceof CoordinatorPreambleIntegrityError) caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught!.expected).toBe(wrong);
    expect(caught!.actual).toBe(sha256Hex(PREAMBLE_CONTENT));
    expect(caught!.message).toContain(wrong);
    expect(caught!.message).toContain(sha256Hex(PREAMBLE_CONTENT));
  });

  // 5. env empty string → treated as unset (no check)
  it("5. env set to empty string — treated as unset, no check", async () => {
    tmpRoot = await makeTmpDir();
    await writeInRepoPreamble(tmpRoot, PREAMBLE_CONTENT);

    process.env.COORDINATOR_PREAMBLE_SHA256 = "";

    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("in-repo");
  });

  // 6. env whitespace-only → treated as unset (no check)
  it("6. env set to whitespace-only — treated as unset, no check", async () => {
    tmpRoot = await makeTmpDir();
    await writeInRepoPreamble(tmpRoot, PREAMBLE_CONTENT);

    process.env.COORDINATOR_PREAMBLE_SHA256 = "   \t  ";

    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("in-repo");
  });
});
