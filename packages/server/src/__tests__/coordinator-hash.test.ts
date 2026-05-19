/**
 * coordinator-hash.test.ts — unit tests for hash.ts (W29 MC-4).
 */

import { describe, it, expect } from "vitest";
import { stableStringify, sha256Hex, hashCoordinatorInput } from "../coordinator/hash.js";

describe("stableStringify", () => {
  it("empty object is deterministic", () => {
    expect(stableStringify({})).toBe("{}");
    expect(stableStringify({})).toBe(stableStringify({}));
  });

  it("same object with different key insertion order produces same string", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("whitespace-containing string values are preserved unchanged", () => {
    const obj = { key: "  hello world  " };
    expect(stableStringify(obj)).toBe('{"key":"  hello world  "}');
  });

  it("array element order is preserved — different order yields different hash", () => {
    const arr1 = [1, 2, 3];
    const arr2 = [3, 2, 1];
    expect(stableStringify(arr1)).not.toBe(stableStringify(arr2));
    expect(stableStringify(arr1)).toBe("[1,2,3]");
  });

  it("nested objects have keys deep-sorted", () => {
    const a = { outer: { z: 9, a: 1 }, b: { q: 4, c: 2 } };
    const b = { b: { c: 2, q: 4 }, outer: { a: 1, z: 9 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("Date is stringified to ISO 8601 string", () => {
    const d = new Date("2024-01-15T12:00:00.000Z");
    expect(stableStringify(d)).toBe('"2024-01-15T12:00:00.000Z"');
  });

  it("null stringifies to 'null'", () => {
    expect(stableStringify(null)).toBe("null");
  });

  it("top-level undefined stringifies to 'undefined'", () => {
    expect(stableStringify(undefined)).toBe("undefined");
  });

  it("undefined object values are omitted (matching JSON.stringify)", () => {
    const obj = { a: 1, b: undefined, c: 3 };
    const result = stableStringify(obj);
    expect(result).toBe('{"a":1,"c":3}');
    expect(result).not.toContain("b");
  });

  it("BigInt throws with explicit message", () => {
    expect(() => stableStringify(BigInt(42))).toThrowError("BigInt not supported");
  });

  it("circular reference throws with explicit message", () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    a.child = b;
    b.cycle = b; // b references itself
    expect(() => stableStringify(a)).toThrowError("Circular reference detected");
  });

  it("handles primitives: number, boolean, string", () => {
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify(true)).toBe("true");
    expect(stableStringify("hello")).toBe('"hello"');
  });
});

describe("sha256Hex", () => {
  it("returns a 64-character lowercase hex string", () => {
    const result = sha256Hex("test input");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for same input", () => {
    expect(sha256Hex("foo")).toBe(sha256Hex("foo"));
  });

  it("differs for different inputs", () => {
    expect(sha256Hex("foo")).not.toBe(sha256Hex("bar"));
  });
});

describe("hashCoordinatorInput", () => {
  it("returns sha256Hex of stableStringify of the value", () => {
    const obj = { b: 2, a: 1 };
    expect(hashCoordinatorInput(obj)).toBe(sha256Hex(stableStringify(obj)));
  });

  it("small CoordinatorInput-shaped object yields stable hash across calls", () => {
    const input = {
      issue: { id: "i-1", title: "Fix bug", body: null, labels: ["bug"], column: "Ready", parentId: null, priority: 2, createdAt: "2024-01-01T00:00:00.000Z" },
      candidateAgents: [{ name: "verbal", role: "implementer", charterHash: "abcd1234", charterContent: "# Verbal\n", capabilities: ["ts"], available: true }],
      project: { id: "p-1", name: "EMU", rules: "fast" },
      recentRuns: [],
    };
    const hash1 = hashCoordinatorInput(input);
    // Reconstruct with different key order
    const input2 = {
      project: input.project,
      recentRuns: [],
      candidateAgents: input.candidateAgents,
      issue: input.issue,
    };
    const hash2 = hashCoordinatorInput(input2);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
});
