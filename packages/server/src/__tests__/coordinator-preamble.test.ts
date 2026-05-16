/**
 * coordinator-preamble.test.ts — MC-2 (Jude, W29)
 *
 * Tests for:
 *   - packages/server/src/coordinator/preamble-builtin.ts  (BUILT_IN_PREAMBLE constant)
 *   - packages/server/src/coordinator/preamble.ts          (hybrid loader)
 *
 * Coverage:
 *   1.  BUILT_IN_PREAMBLE is a non-empty string
 *   2.  BUILT_IN_PREAMBLE contains the output schema keyword "kind"
 *   3.  Loader returns built-in when in-repo path does not exist
 *   4.  Loader returns in-repo content when file exists with content
 *   5.  Loader returns built-in when in-repo file is empty (whitespace-only)
 *   6.  Loader returns built-in when in-repo file read throws (mocked error)
 *   7.  Cache returns the same object on second call (no forceReload)
 *   8.  forceReload bypasses the cache
 *   9.  resetPreambleCache clears cached state
 *   10. PreambleSource fields are all populated correctly
 *   11. loadedAt is a valid ISO 8601 timestamp
 *   12. squadRoot option lets you point at an arbitrary directory for testing
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { BUILT_IN_PREAMBLE } from "../coordinator/preamble-builtin.js";
import {
  loadCoordinatorPreamble,
  resetPreambleCache,
  getCachedPreamble,
} from "../coordinator/preamble.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh temp directory for one test and return its path. */
async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "coord-preamble-test-"));
}

/** Write the in-repo preamble file inside a temp root. */
async function writeInRepoPreamble(root: string, content: string): Promise<string> {
  const squadDir = path.join(root, ".squad");
  await mkdir(squadDir, { recursive: true });
  const filePath = path.join(squadDir, "squadboard-coordinator.md");
  await writeFile(filePath, content, "utf8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("BUILT_IN_PREAMBLE constant", () => {
  it("1. is a non-empty string", () => {
    expect(typeof BUILT_IN_PREAMBLE).toBe("string");
    expect(BUILT_IN_PREAMBLE.trim().length).toBeGreaterThan(0);
  });

  it('2. contains "kind" (output schema keyword)', () => {
    expect(BUILT_IN_PREAMBLE).toContain("kind");
  });
});

describe("loadCoordinatorPreamble — built-in fallback", () => {
  let tmpRoot: string;

  afterEach(async () => {
    resetPreambleCache();
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("3. returns built-in when in-repo path does not exist", async () => {
    tmpRoot = await makeTmpDir();
    // No .squad/squadboard-coordinator.md written
    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("built-in");
    expect(result.text).toBe(BUILT_IN_PREAMBLE);
    expect(result.path).toBeUndefined();
  });

  it("4. returns in-repo content when file exists with content", async () => {
    tmpRoot = await makeTmpDir();
    const customText = "# Custom Preamble\n\nYou are a custom coordinator.";
    const filePath = await writeInRepoPreamble(tmpRoot, customText);

    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("in-repo");
    expect(result.text).toBe(customText);
    expect(result.path).toBe(filePath);
  });

  it("5. returns built-in when in-repo file is whitespace-only", async () => {
    tmpRoot = await makeTmpDir();
    await writeInRepoPreamble(tmpRoot, "   \n\t\n  ");

    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("built-in");
    expect(result.text).toBe(BUILT_IN_PREAMBLE);
  });
});

describe("loadCoordinatorPreamble — read failure fallback", () => {
  let tmpRoot: string;
  let restrictedFile: string | null = null;

  beforeEach(() => {
    resetPreambleCache();
  });

  afterEach(async () => {
    // Restore permissions before rm() so cleanup doesn't fail
    if (restrictedFile) {
      await chmod(restrictedFile, 0o644).catch(() => undefined);
      restrictedFile = null;
    }
    resetPreambleCache();
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("6. returns built-in when in-repo file read throws a permission error", async () => {
    tmpRoot = await makeTmpDir();
    const filePath = await writeInRepoPreamble(tmpRoot, "real content");

    // Make the file unreadable so readFile throws EACCES
    await chmod(filePath, 0o000);
    restrictedFile = filePath;

    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("built-in");
    expect(result.text).toBe(BUILT_IN_PREAMBLE);
  });
});

describe("loadCoordinatorPreamble — caching behaviour", () => {
  let tmpRoot: string;

  afterEach(async () => {
    resetPreambleCache();
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("7. second call without forceReload returns the cached object (same reference)", async () => {
    tmpRoot = await makeTmpDir();
    const first = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    const second = await loadCoordinatorPreamble({ squadRoot: tmpRoot });
    expect(second).toBe(first); // same object reference
  });

  it("8. forceReload bypasses the cache and returns a fresh object", async () => {
    tmpRoot = await makeTmpDir();
    const first = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    const second = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    // Both are valid results but a fresh object is returned
    expect(second).not.toBe(first);
    expect(second.source).toBe(first.source);
  });

  it("9. resetPreambleCache clears cached state", async () => {
    tmpRoot = await makeTmpDir();
    await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(getCachedPreamble()).not.toBeNull();
    resetPreambleCache();
    expect(getCachedPreamble()).toBeNull();
  });
});

describe("loadCoordinatorPreamble — PreambleSource shape", () => {
  let tmpRoot: string;

  afterEach(async () => {
    resetPreambleCache();
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("10. built-in result has correct source, text, no path", async () => {
    tmpRoot = await makeTmpDir();
    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("built-in");
    expect(result.text).toBe(BUILT_IN_PREAMBLE);
    expect(result.path).toBeUndefined();
    expect(typeof result.loadedAt).toBe("string");
  });

  it("10b. in-repo result has correct source, text, and path", async () => {
    tmpRoot = await makeTmpDir();
    const content = "# In-repo preamble\n\nYou are a coordinator.";
    const filePath = await writeInRepoPreamble(tmpRoot, content);

    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("in-repo");
    expect(result.text).toBe(content);
    expect(result.path).toBe(filePath);
    expect(typeof result.loadedAt).toBe("string");
  });

  it("11. loadedAt is a valid ISO 8601 timestamp", async () => {
    tmpRoot = await makeTmpDir();
    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    const date = new Date(result.loadedAt);
    expect(isNaN(date.getTime())).toBe(false);
    expect(result.loadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("12. squadRoot option lets you point at an arbitrary directory", async () => {
    tmpRoot = await makeTmpDir();
    const customContent = "# Arbitrary root preamble\n\nCustom content for test.";
    await writeInRepoPreamble(tmpRoot, customContent);

    const result = await loadCoordinatorPreamble({ squadRoot: tmpRoot, forceReload: true });
    expect(result.source).toBe("in-repo");
    expect(result.text).toBe(customContent);
    expect(result.path).toContain(tmpRoot);
  });
});
