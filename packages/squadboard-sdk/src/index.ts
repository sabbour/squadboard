/**
 * @sabbour/squadboard-sdk — index.ts
 *
 * Root barrel. Groups SDK sub-modules under typed namespaces.
 *
 * Usage:
 *   import { squadboard } from '@sabbour/squadboard-sdk';
 *   await squadboard.scribe.closeOut({ spawnManifest, push: true });
 *
 * Or import primitives directly for fine-grained composition:
 *   import { archiveDecisionsBySize } from '@sabbour/squadboard-sdk/scribe';
 */

import * as scribe from './scribe/index.js';

export const squadboard = { scribe };

// Re-export types for library consumers.
export type { CloseOutOptions, CloseOutResult, SpawnManifest, SpawnManifestEntry } from './scribe/index.js';
