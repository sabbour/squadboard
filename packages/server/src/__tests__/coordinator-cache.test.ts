/**
 * coordinator-cache.test.ts — unit tests for cache.ts (W29 MC-4).
 *
 * Injectable clock (opts.now) used throughout to control time deterministically.
 */

import { describe, it, expect } from "vitest";
import { CoordinatorDecisionCache, decisionCache } from "../coordinator/cache.js";
import type { CoordinatorInput, CoordinatorDecision } from "../coordinator/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<CoordinatorInput["issue"]> = {}): CoordinatorInput {
  return {
    issue: {
      id: "i-1",
      title: "Default issue",
      body: null,
      labels: [],
      column: "Backlog",
      parentId: null,
      priority: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      ...overrides,
    },
    candidateAgents: [],
    project: { id: "p-1", name: "Test", rules: "" },
    recentRuns: [],
  };
}

const dispatchDecision: CoordinatorDecision = { kind: "dispatch", agent: "verbal", rationale: "best fit", confidence: 0.9 };
const skipDecision: CoordinatorDecision = { kind: "skip", reason: "nothing to do" };
const ambiguousDecision: CoordinatorDecision = { kind: "ambiguous", suggestedAgents: ["verbal", "cipher"], question: "Which?" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CoordinatorDecisionCache — basic get/set", () => {
  it("empty cache get returns undefined and increments miss", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ now: () => t });
    const result = cache.get(makeInput());
    expect(result).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
    expect(cache.stats().hits).toBe(0);
  });

  it("set then get returns the same decision and increments hit", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 60_000, now: () => t });
    const input = makeInput();
    cache.set(input, dispatchDecision);
    const result = cache.get(input);
    expect(result).toEqual(dispatchDecision);
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(0);
  });

  it("get on expired entry returns undefined and increments expirations + misses", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 1000, now: () => t });
    const input = makeInput();
    cache.set(input, dispatchDecision);
    t = 1001; // past TTL
    const result = cache.get(input);
    expect(result).toBeUndefined();
    expect(cache.stats().expirations).toBe(1);
    expect(cache.stats().misses).toBe(1);
    expect(cache.stats().hits).toBe(0);
  });

  it("ttlMs=0 means immediate expiry — every get returns undefined", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 0, now: () => t });
    const input = makeInput();
    cache.set(input, dispatchDecision);
    // expiresAt = t + 0 = 0; now() = 0; 0 >= 0 → expired
    expect(cache.get(input)).toBeUndefined();
    expect(cache.stats().expirations).toBe(1);
  });
});

describe("CoordinatorDecisionCache — capacity & LRU eviction", () => {
  it("capacity overflow evicts oldest entry, increments evictions", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ capacity: 2, ttlMs: 60_000, now: () => t });
    const inputA = makeInput({ id: "A" });
    const inputB = makeInput({ id: "B" });
    const inputC = makeInput({ id: "C" });
    cache.set(inputA, dispatchDecision);
    cache.set(inputB, skipDecision);
    cache.set(inputC, ambiguousDecision); // evicts A
    expect(cache.stats().evictions).toBe(1);
    expect(cache.get(inputA)).toBeUndefined(); // evicted
    expect(cache.stats().misses).toBe(1);
    expect(cache.get(inputB)).toEqual(skipDecision);
    expect(cache.get(inputC)).toEqual(ambiguousDecision);
  });

  it("LRU bump on hit — hitting A prevents A from being evicted when C is added", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ capacity: 2, ttlMs: 60_000, now: () => t });
    const inputA = makeInput({ id: "A" });
    const inputB = makeInput({ id: "B" });
    const inputC = makeInput({ id: "C" });
    cache.set(inputA, dispatchDecision);
    cache.set(inputB, skipDecision);
    cache.get(inputA); // bump A to tail — B is now oldest
    cache.set(inputC, ambiguousDecision); // evicts B (oldest), not A
    expect(cache.get(inputB)).toBeUndefined(); // B was evicted
    expect(cache.get(inputA)).toEqual(dispatchDecision); // A still present
  });

  it("custom capacity=1 — set A, set B, get(A) returns undefined (evicted)", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ capacity: 1, ttlMs: 60_000, now: () => t });
    const inputA = makeInput({ id: "A" });
    const inputB = makeInput({ id: "B" });
    cache.set(inputA, dispatchDecision);
    cache.set(inputB, skipDecision); // evicts A
    expect(cache.get(inputA)).toBeUndefined();
  });
});

describe("CoordinatorDecisionCache — stats & size", () => {
  it("size reports correct count after sets", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 60_000, now: () => t });
    cache.set(makeInput({ id: "x" }), dispatchDecision);
    cache.set(makeInput({ id: "y" }), skipDecision);
    expect(cache.stats().size).toBe(2);
  });

  it("clear() resets all stats and empties the cache", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 60_000, now: () => t });
    cache.set(makeInput(), dispatchDecision);
    cache.get(makeInput());
    cache.clear();
    const s = cache.stats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.evictions).toBe(0);
    expect(s.expirations).toBe(0);
    expect(s.size).toBe(0);
  });
});

describe("CoordinatorDecisionCache — has()", () => {
  it("has() returns true for present and fresh entry", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 60_000, now: () => t });
    const input = makeInput();
    cache.set(input, dispatchDecision);
    expect(cache.has(input)).toBe(true);
  });

  it("has() returns false for expired entry", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 500, now: () => t });
    const input = makeInput();
    cache.set(input, dispatchDecision);
    t = 501;
    expect(cache.has(input)).toBe(false);
  });

  it("has() returns false for absent entry", () => {
    const cache = new CoordinatorDecisionCache();
    expect(cache.has(makeInput())).toBe(false);
  });
});

describe("CoordinatorDecisionCache — decision variants survive roundtrip", () => {
  it("dispatch decision survives roundtrip", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 60_000, now: () => t });
    const input = makeInput({ id: "d1" });
    cache.set(input, dispatchDecision);
    expect(cache.get(input)).toEqual(dispatchDecision);
  });

  it("skip decision survives roundtrip", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 60_000, now: () => t });
    const input = makeInput({ id: "s1" });
    cache.set(input, skipDecision);
    expect(cache.get(input)).toEqual(skipDecision);
  });

  it("ambiguous decision survives roundtrip", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 60_000, now: () => t });
    const input = makeInput({ id: "a1" });
    cache.set(input, ambiguousDecision);
    expect(cache.get(input)).toEqual(ambiguousDecision);
  });
});

describe("CoordinatorDecisionCache — key isolation & collision resistance", () => {
  it("different inputs produce different cache keys — no false hits", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 60_000, now: () => t });
    const inputs = ["A", "B", "C", "D"].map((id) => makeInput({ id }));
    inputs.forEach((inp, i) => cache.set(inp, { kind: "skip", reason: `reason-${i}` }));
    inputs.forEach((inp, i) => {
      const got = cache.get(inp) as Extract<CoordinatorDecision, { kind: "skip" }>;
      expect(got.reason).toBe(`reason-${i}`);
    });
  });
});

describe("CoordinatorDecisionCache — clock injection & TTL", () => {
  it("now() injection — advancing clock past TTL triggers expiration", () => {
    let t = 1000;
    const cache = new CoordinatorDecisionCache({ ttlMs: 500, now: () => t });
    const input = makeInput();
    cache.set(input, dispatchDecision); // expiresAt = 1500
    t = 1400; // still fresh
    expect(cache.get(input)).toEqual(dispatchDecision);
    t = 1500; // exactly at boundary → expired (>= expiresAt)
    expect(cache.get(input)).toBeUndefined();
    expect(cache.stats().expirations).toBe(1);
  });

  it("ttlMs is configurable per-instance", () => {
    let t = 0;
    const short = new CoordinatorDecisionCache({ ttlMs: 100, now: () => t });
    const long = new CoordinatorDecisionCache({ ttlMs: 10_000, now: () => t });
    const input = makeInput();
    short.set(input, dispatchDecision);
    long.set(input, skipDecision);
    t = 200;
    expect(short.get(input)).toBeUndefined(); // expired
    expect(long.get(input)).toEqual(skipDecision); // still fresh
  });

  it("multiple sequential gets of same key — miss only on first after expiry, hits before", () => {
    let t = 0;
    const cache = new CoordinatorDecisionCache({ ttlMs: 1000, now: () => t });
    const input = makeInput();
    cache.set(input, dispatchDecision);
    // Three hits
    cache.get(input);
    cache.get(input);
    cache.get(input);
    expect(cache.stats().hits).toBe(3);
    expect(cache.stats().misses).toBe(0);
    // Expire it
    t = 1001;
    cache.get(input); // expiration + miss
    expect(cache.stats().expirations).toBe(1);
    expect(cache.stats().misses).toBe(1);
    // Re-set and hit again
    cache.set(input, skipDecision);
    cache.get(input);
    expect(cache.stats().hits).toBe(4);
  });
});

describe("decisionCache singleton", () => {
  it("decisionCache is an instance of CoordinatorDecisionCache", () => {
    expect(decisionCache).toBeInstanceOf(CoordinatorDecisionCache);
  });
});
