/**
 * charter-identity.ts — W29 MC-14 prep seam
 *
 * Owns the two responsibilities that survive even after the LLM coordinator
 * replaces the full charter parser (MC-3/MC-5/MC-6):
 *   1. Resolving an agent's canonical name from charter markdown.
 *   2. Hashing charter content for change-detection.
 *
 * All other field extraction (role, model, expertise, …) remains in
 * charter-compiler.ts until Phase 3 slims it down.
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CharterIdentity {
  /** Agent name as written in the charter (H1 heading or identity table). */
  name: string;
  /** First 8 hex chars of the MD5 content hash — short fingerprint. */
  hash: string;
  /** Full 32-char MD5 hex — used for strict equality checks. */
  contentHash: string;
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

/**
 * Compute the MD5 hash of raw charter content.
 * Accepts string or Buffer so callers can pass in-memory content or
 * a raw file read without an extra encoding step.
 *
 * Note: MD5 is used here solely for change-detection, not cryptographic security.
 */
export function hashCharterContent(content: string | Buffer): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Return the first 8 hex characters of a full content hash — a short,
 * human-readable fingerprint suitable for logs and decision records.
 */
export function shortHash(fullHash: string): string {
  return fullHash.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Name resolution
// ---------------------------------------------------------------------------

/**
 * Extract the canonical agent name from charter markdown.
 *
 * Resolution order (mirrors parseCharterContent):
 *   1. First `# H1` heading in the file.
 *   2. `| Name | … |` row inside an `## Identity` / `## About` table.
 *   3. `- **Name:** …` list item inside an `## Identity` / `## About` block.
 *   4. `filenameHint` (e.g. derived from the charter file path).
 *   5. `"unknown-agent"` sentinel.
 *
 * This function deliberately does NOT kebab-case the name — it returns the
 * name exactly as written in the charter (e.g. "Verbal", "Code Reviewer").
 * Callers that need a slug should apply their own normalization.
 */
export function resolveCharterName(
  charterMarkdown: string,
  filenameHint?: string,
): string {
  const lines = charterMarkdown.split('\n');
  let name = '';
  let inIdentityTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // First H1 wins immediately.
    if (!name && trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      name = trimmed.replace(/^#\s+/, '').trim();
      break;
    }

    // Track which section we're in.
    if (trimmed.startsWith('## ')) {
      const heading = trimmed.replace(/^##\s+/, '').toLowerCase();
      inIdentityTable = heading === 'identity' || heading === 'about';
      continue;
    }

    if (!inIdentityTable || name) continue;

    // Identity table row: `| Name | Verbal |`
    if (trimmed.startsWith('|') && !trimmed.startsWith('| ---')) {
      const cols = trimmed
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cols.length >= 2 && cols[0].toLowerCase() === 'name') {
        name = cols[1];
      }
    }

    // Identity list item: `- **Name:** Verbal`
    if (trimmed.startsWith('-')) {
      const bold = trimmed.match(/^-\s+\*\*(.+?):\*\*\s*(.+)$/);
      if (bold && bold[1].trim().toLowerCase() === 'name') {
        name = bold[2].trim();
      }
    }
  }

  if (name) return name;
  if (filenameHint) return filenameHint;
  return 'unknown-agent';
}

// ---------------------------------------------------------------------------
// Composite identity
// ---------------------------------------------------------------------------

/**
 * Compute the full CharterIdentity for a charter.
 *
 * Combines name resolution and content hashing into a single call so
 * callers (coordinator dispatch, agent-sync, cache keying) can retrieve
 * both with one import instead of two separate calls.
 */
export function computeCharterIdentity(
  charterMarkdown: string,
  filenameHint?: string,
): CharterIdentity {
  const name = resolveCharterName(charterMarkdown, filenameHint);
  const contentHash = hashCharterContent(charterMarkdown);
  const hash = shortHash(contentHash);
  return { name, hash, contentHash };
}
