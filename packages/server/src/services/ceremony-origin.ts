/**
 * ceremony-origin.ts — CER-1: derive ceremony origin/provenance from existing columns.
 *
 * Origin values:
 *   'core'         — required built-in ceremonies that must always be present (scribe-close-out,
 *                    work-pickup); detected by templateId === 'core'
 *   'built-in'     — standard built-in ceremonies auto-seeded from YAML templates;
 *                    detected by templateId === 'built-in'
 *   'yaml-import'  — loaded from .squad/ceremonies/*.workflow.yaml;
 *                    detected by sourceYamlPath being non-null
 *   'conjure-llm'  — generated via the Conjure/Formulate prose→YAML flow;
 *                    detected by parentNarrativeId being non-null
 *   'user-created' — manually authored in the visual editor or Code tab; the fallback
 *
 * This module intentionally does NOT touch the DB schema. All signals come from
 * existing columns on the workflows table.
 */

export type CeremonyOrigin = 'core' | 'built-in' | 'yaml-import' | 'conjure-llm' | 'user-created';

export interface CeremonyOriginInput {
  parentNarrativeId?: string | null;
  // templateId: 'core' for required built-ins, 'built-in' for standard built-ins, null otherwise
  templateId?: string | null;
  sourceYamlPath?: string | null;
}

/**
 * Derive the origin of a ceremony from its existing DB columns.
 *
 * Derivation order (most-specific → least-specific):
 *  1. templateId === 'core'       → 'core'        (required built-in ceremonies)
 *  2. templateId non-null         → 'built-in'    (standard built-in ceremonies)
 *  3. sourceYamlPath non-null     → 'yaml-import' (yaml-import feature)
 *  4. parentNarrativeId non-null  → 'conjure-llm' (Conjure/Formulate flow)
 *  5. fallback                    → 'user-created'
 */
export function deriveOrigin(ceremony: CeremonyOriginInput): CeremonyOrigin {
  if (ceremony.templateId === 'core') return 'core';
  if (ceremony.templateId) return 'built-in';
  if (ceremony.sourceYamlPath) return 'yaml-import';
  if (ceremony.parentNarrativeId) return 'conjure-llm';
  return 'user-created';
}

export const ORIGIN_LABELS: Record<CeremonyOrigin, string> = {
  'core': 'Core',
  'built-in': 'Built-in',
  'yaml-import': 'YAML',
  'conjure-llm': 'Conjure',
  'user-created': 'User',
};
