/**
 * coordinator/hash.ts — stable stringification + sha256 helper (W29 MC-4).
 *
 * stableStringify: object keys sorted recursively; arrays preserve order;
 * null stringified as "null"; undefined values in objects are omitted (matching
 * JSON.stringify behaviour); top-level undefined stringifies to "undefined".
 * Date → ISO string. BigInt → throws. Cycles detected via WeakSet.
 */

import { createHash } from "node:crypto";

export function stableStringify(value: unknown, _seen: WeakSet<object> = new WeakSet()): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value === "bigint") {
    throw new TypeError("BigInt not supported");
  }

  if (typeof value !== "object") {
    // string | number | boolean | symbol (symbol falls through — fine for our use)
    return JSON.stringify(value);
  }

  // Object / Array / Date from here
  if (_seen.has(value as object)) {
    throw new TypeError("Circular reference detected");
  }
  _seen.add(value as object);

  let result: string;

  if (value instanceof Date) {
    result = JSON.stringify(value.toISOString());
  } else if (Array.isArray(value)) {
    const items = value.map((item) => stableStringify(item, _seen));
    result = `[${items.join(",")}]`;
  } else {
    // Plain object — sort keys, omit undefined values
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs: string[] = [];
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue; // omit, matching JSON.stringify
      pairs.push(`${JSON.stringify(k)}:${stableStringify(v, _seen)}`);
    }
    result = `{${pairs.join(",")}}`;
  }

  _seen.delete(value as object);
  return result;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashCoordinatorInput(value: unknown): string {
  return sha256Hex(stableStringify(value));
}
