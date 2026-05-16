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
export declare const squadboard: {
    scribe: typeof scribe;
};
export type { CloseOutOptions, CloseOutResult, SpawnManifest, SpawnManifestEntry } from './scribe/index.js';
export type { SquadboardBundle, ApplyResult, BundleManifest, BundleProject, BundleKanban, BundleKanbanColumn, BundleTeamMember, BundleCeremony, BundleCeremonyTrigger, BundleCeremonyTriggerKind, BundleWorkflow, BundleSkill, BundleTool, BundleMcpServer, BundleRoutingRule, BundleAgent, BundleWorkflowStep, BundleWorkflowRouteStep, BundleWorkflowAgentRunStep, BundleWorkflowApproveStep, BundleWorkflowFanOutStep, BundleWorkflowHandoffStep, } from './bundle/schema.js';
//# sourceMappingURL=index.d.ts.map