/**
 * narrative-bridge.ts — Phase 10 stub for the narrative→executable converter.
 *
 * A `kind='narrative'` ceremony is markdown-only documentation that describes a
 * cross-team practice ("how we do release reviews", "deliverable triage", etc.).
 * Phase 11 will translate that prose into an executable `kind='ceremony'`
 * workflow_version backed by concrete steps the engine can run.
 *
 * Contract for Phase 11:
 *   1. Load the latest workflow_version YAML for the ceremony id.
 *   2. Walk the markdown sections to extract:
 *        - trigger configuration (when does it run?)
 *        - step ordering (which agent does what, in which order?)
 *        - approval / review gates
 *   3. Emit a new workflow_version row with `yamlContent` = the synthesised
 *      executable YAML and flip the parent row's `kind` from 'narrative' to
 *      'ceremony'. Preserve the original markdown as a frozen historical
 *      version (a separate row with `kind='narrative'`).
 *   4. Return a small report (versionId + diff summary) so the editor can
 *      surface "Converted N steps from your narrative" to the user.
 *
 * Until that work lands, this file deliberately throws `NotImplementedError`
 * which the `/api/projects/:projectId/ceremonies/:id/convert` route catches
 * and surfaces as HTTP 501 — the client editor in turn maps that to the
 * "Coming in Phase 11" toast.
 */

/** Sentinel error tag that the ceremonies route uses to map to HTTP 501. */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(`NotImplemented: ${message}`);
    this.name = 'NotImplementedError';
  }
}

/**
 * The shape Phase 11 will return on a successful conversion. Surfacing this
 * type now lets call sites compile against the eventual contract.
 */
export interface NarrativeConversionResult {
  /** Newly-created executable workflow_version id. */
  versionId: string;
  /** Number of steps the converter extracted from the prose. */
  stepCount: number;
  /** Optional human-readable summary of what was inferred. */
  notes?: string[];
}

/**
 * Convert a `kind='narrative'` ceremony into an executable workflow version.
 *
 * Phase 10 implementation: always throws `NotImplementedError`. The route
 * layer catches this and returns 501 with a "Coming in Phase 11" body; the
 * client editor maps that to a non-blocking info toast.
 */
export async function convertNarrativeToExecutable(
  ceremonyId: string,
): Promise<NarrativeConversionResult> {
  throw new NotImplementedError(
    `convertNarrativeToExecutable(${ceremonyId}) — Phase 11 will translate ` +
      `markdown narrative ceremonies into executable workflow versions.`,
  );
}
