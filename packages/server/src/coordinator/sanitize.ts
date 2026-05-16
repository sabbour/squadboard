/**
 * coordinator/sanitize.ts — Sanitize untrusted text before LLM prompt assembly (W30, C-4).
 *
 * Pure functions only; no side effects, no I/O.
 */

export interface SanitizedField {
  /** Safe to include in an LLM prompt. */
  sanitized: string;
  /** Was the content trimmed due to maxBytes? */
  truncated: boolean;
  /** Names of injection signatures detected (non-blocking — caller decides how to handle). */
  flagged: string[];
}

export interface SanitizeOptions {
  /** Default 8192 bytes (8 KB). */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 8192;

// ---------------------------------------------------------------------------
// Stripping regexes
// ---------------------------------------------------------------------------

/** Control characters except \n (0x0A) and \t (0x09). */
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Zero-width and invisible formatting chars:
 *   U+200B ZERO WIDTH SPACE
 *   U+200C ZERO WIDTH NON-JOINER
 *   U+200D ZERO WIDTH JOINER
 *   U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM)
 *   U+2060 WORD JOINER
 */
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF\u2060]/g;

/**
 * Bidi override / isolate controls (all are prompt-injection vectors):
 *   U+202A–U+202E  (LRE, RLE, PDF, LRO, RLO)
 *   U+2066–U+2069  (LRI, RLI, FSI, PDI)
 */
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069]/g;

// ---------------------------------------------------------------------------
// Injection signatures (case-insensitive; FLAG only — do NOT block)
// ---------------------------------------------------------------------------

const INJECTION_SIGNATURES: Array<{ name: string; pattern: RegExp }> = [
  { name: "ignore-previous", pattern: /ignore (all )?previous instructions/i },
  {
    name: "disregard-system",
    pattern: /disregard (the )?(system|coordinator) (prompt|instructions)/i,
  },
  { name: "you-are-now", pattern: /you are now/i },
  { name: "role-tag", pattern: /<\/?(system|user|assistant)>/i },
  { name: "begin-system-prompt", pattern: /BEGIN SYSTEM PROMPT/i },
  { name: "act-as", pattern: /act as/i },
];

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Sanitize a single untrusted text field for safe inclusion in an LLM prompt.
 *
 * Steps:
 *   1. Coerce null/undefined to "".
 *   2. Strip control chars (except \n, \t), zero-width chars, and bidi controls.
 *   3. Truncate to maxBytes (UTF-8 byte length).
 *   4. Detect injection signatures (non-blocking).
 *   5. Return { sanitized, truncated, flagged }.
 */
export function sanitizeUntrustedText(
  raw: string | null | undefined,
  opts?: SanitizeOptions,
): SanitizedField {
  if (raw == null || raw === "") {
    return { sanitized: "", truncated: false, flagged: [] };
  }

  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;

  // Strip invisible/dangerous characters
  let cleaned = raw
    .replace(CONTROL_CHARS_RE, "")
    .replace(ZERO_WIDTH_RE, "")
    .replace(BIDI_CONTROL_RE, "");

  // Truncate to maxBytes (byte-aware)
  let truncated = false;
  const encoded = new TextEncoder().encode(cleaned);
  if (encoded.length > maxBytes) {
    // Slice bytes and decode back (TextDecoder handles partial code-points gracefully)
    cleaned = new TextDecoder().decode(encoded.slice(0, maxBytes));
    truncated = true;
  }

  // Detect injection signatures on the truncated, cleaned text
  const flagged: string[] = [];
  for (const { name, pattern } of INJECTION_SIGNATURES) {
    if (pattern.test(cleaned)) {
      flagged.push(name);
    }
  }

  return { sanitized: cleaned, truncated, flagged };
}
