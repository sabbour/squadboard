/**
 * coordinator/cache.ts — in-memory LRU decision cache (W29 MC-4).
 *
 * Key   = sha256 of stable-stringified CoordinatorInput (64 hex chars).
 * Value = CoordinatorDecision + expiry timestamp.
 * LRU   = Map insertion-order: on hit, delete + re-set to bump to tail.
 * Evict = delete Map's first key (oldest / least-recently-used).
 */

import type { CoordinatorDecision, CoordinatorInput } from "./types.js";
import { hashCoordinatorInput } from "./hash.js";

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  size: number;
}

export interface CacheOptions {
  /** Time-to-live in milliseconds. Default: 60_000 (60 s). */
  ttlMs?: number;
  /** Maximum number of entries before LRU eviction. Default: 256. */
  capacity?: number;
  /** Injectable clock for deterministic testing. Default: Date.now. */
  now?: () => number;
}

interface CacheEntry {
  decision: CoordinatorDecision;
  expiresAt: number;
}

export class CoordinatorDecisionCache {
  private readonly ttlMs: number;
  private readonly capacity: number;
  private readonly now: () => number;

  private readonly store = new Map<string, CacheEntry>();

  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;
  private _expirations = 0;

  constructor(opts: CacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.capacity = opts.capacity ?? 256;
    this.now = opts.now ?? (() => Date.now());
  }

  get(input: CoordinatorInput): CoordinatorDecision | undefined {
    const key = hashCoordinatorInput(input);
    const entry = this.store.get(key);

    if (entry === undefined) {
      this._misses++;
      return undefined;
    }

    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      this._expirations++;
      this._misses++;
      return undefined;
    }

    // LRU bump — move to tail by delete + re-set
    this.store.delete(key);
    this.store.set(key, entry);

    this._hits++;
    return entry.decision;
  }

  set(input: CoordinatorInput, decision: CoordinatorDecision): void {
    const key = hashCoordinatorInput(input);
    const expiresAt = this.now() + this.ttlMs;

    // If the key already exists, remove it first so capacity check is accurate
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      // Evict oldest (first key in insertion order)
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
        this._evictions++;
      }
    }

    this.store.set(key, { decision, expiresAt });
  }

  has(input: CoordinatorInput): boolean {
    const key = hashCoordinatorInput(input);
    const entry = this.store.get(key);
    if (entry === undefined) return false;
    if (this.now() >= entry.expiresAt) return false;
    return true;
  }

  clear(): void {
    this.store.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
    this._expirations = 0;
  }

  stats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      expirations: this._expirations,
      size: this.store.size,
    };
  }
}

/** Default singleton — consumers may import this for convenience. */
export const decisionCache = new CoordinatorDecisionCache();
