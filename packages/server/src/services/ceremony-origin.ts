/**
 * ceremony-origin.ts — CER-1: derive ceremony origin/provenance from existing columns.
 *
 * Origin values:
 *   'built-in'     — auto-seeded from ceremonies.md template (future CER-2 will mark these;
 *                    no built-in ceremonies exist in the DB today so this branch is reserved)
 *   'yaml-import'  — loaded from .squad/ceremonies/*.workflow.yaml (future yaml-import feature;
 *                    no source_yaml_path column exists yet, so this branch is reserved)
 *   'conjure-llm'  — generated via the Conjure/Formulate prose→YAML flow;
 *                    detected by parentNarrativeId being non-null
 *   'user-created' — manually authored in the visual editor or Code tab; the fallback
 *
 * This module intentionally does NOT touch the DB schema. All signals come from
 * existing columns on the workflows table.
 */

export type CeremonyOrigin = 'built-in' | 'yaml-import' | 'conjure-llm' | 'user-created';

export interface CeremonyOriginInput {
  parentNarrativeId?: string | null;
  // Reserved for future CER-2 / yaml-import signals (currently always null):
  templateId?: string | null;
  sourceYamlPath?: string | null;
}

/**
 * Derive the origin of a ceremony from its existing DB columns.
 *
 * Derivation order (most-specific → least-specific):
 *  1. templateId non-null         → 'built-in'   (CER-2 reserved)
 *  2. sourceYamlPath non-null     → 'yaml-import' (yaml-import reserved)
 *  3. parentNarrativeId non-null  → 'conjure-llm' (active signal today)
 *  4. fallback                    → 'user-created'
 */
export function deriveOrigin(ceremony: CeremonyOriginInput): CeremonyOrigin {
  if (ceremony.templateId) return 'built-in';
  if (ceremony.sourceYamlPath) return 'yaml-import';
  if (ceremony.parentNarrativeId) return 'conjure-llm';
  return 'user-created';
}

export const ORIGIN_LABELS: Record<CeremonyOrigin, string> = {
  'built-in': 'Built-in',
  'yaml-import': 'YAML',
  'conjure-llm': 'Conjure',
  'user-created': 'User',
};
