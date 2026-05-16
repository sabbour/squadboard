/**
 * @sabbour/squadboard-sdk — scribe/index.ts
 *
 * Barrel: re-exports everything from the scribe sub-module.
 */

export { closeOut } from './close-out.js';
export type { CloseOutOptions, CloseOutResult } from './close-out.js';
export type { SpawnManifest, SpawnManifestEntry } from './primitives.js';
export {
  archiveDecisionsBySize,
  mergeInbox,
  writeOrchestrationLogs,
  writeSessionLog,
  crossAgentHistoryUpdates,
  summarizeHistoryIfLarge,
  commitScribeFiles,
} from './primitives.js';
