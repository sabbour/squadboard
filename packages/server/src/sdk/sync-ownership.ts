/**
 * sync-ownership.ts — SDK-facing ownership contract for cross-surface Squad state.
 *
 * This is intentionally pure and schema-free. Hockney can expose the returned
 * shape through an API later; Kujan can test it without a database.
 */

export const SQUAD_SYNC_OWNERSHIP_CONTRACT_VERSION = 'squadboard.sdk-sync-ownership.v1' as const;

export type SquadSyncStorageMode = 'postgresql' | 'filesystem';
export type SquadSyncAuthority = 'squad_storage' | 'filesystem';
export type SquadSyncBootstrapStatus = 'ready' | 'partial' | 'missing';
export type SquadSyncArtifactStatus = 'present' | 'missing';
export type SquadSyncArtifactRequirement = 'required' | 'recommended' | 'optional';
export type SquadSyncSurface = 'squad-sdk' | 'squadboard' | 'filesystem' | 'copilot-cli' | 'mcp';

export interface SquadSyncProjectionPresence {
  squadDir?: boolean;
  agentsDir?: boolean;
  decisionsInboxDir?: boolean;
  teamMd?: boolean;
  routingMd?: boolean;
  decisionsMd?: boolean;
  ceremoniesMd?: boolean;
  copilotAgentMd?: boolean;
}

export interface BuildSyncOwnershipStatusInput {
  /** Raw provider selector from CLI/config/env. Unset and "postgresql" mean DB authority. */
  storageProvider?: string | null;
  /** Absolute project root, parent of `.squad/`, when known. */
  projectRoot?: string | null;
  /** Absolute `.squad/` path, when known. */
  squadPath?: string | null;
  /** Filesystem projection facts collected by the caller. */
  presence?: SquadSyncProjectionPresence;
}

export interface SquadSyncStorageContract {
  rawProvider: string | null;
  mode: SquadSyncStorageMode;
  authority: SquadSyncAuthority;
  importBehavior: 'one-time-filesystem-import-when-empty' | 'live-filesystem';
  mirrorBehavior: 'none';
  sharedExternalAccess: 'hosted-postgresql-or-squadboard-broker' | 'direct-filesystem-access';
}

export interface SquadSyncProjectionArtifact {
  id: keyof SquadSyncProjectionPresence;
  path: string;
  status: SquadSyncArtifactStatus;
  requirement: SquadSyncArtifactRequirement;
  owner: SquadSyncSurface;
  purpose: string;
}

export interface SquadSyncSurfaceContract {
  surface: SquadSyncSurface;
  owns: string[];
  doesNotOwn: string[];
}

export interface SquadSyncRepairAction {
  id: string;
  owner: 'Hockney' | 'Kobayashi' | 'Redfoot' | 'Kujan';
  reason: string;
}

export interface SquadSyncOwnershipStatus {
  contractVersion: typeof SQUAD_SYNC_OWNERSHIP_CONTRACT_VERSION;
  storage: SquadSyncStorageContract;
  bootstrap: {
    status: SquadSyncBootstrapStatus;
    missingRequired: Array<keyof SquadSyncProjectionPresence>;
    missingRecommended: Array<keyof SquadSyncProjectionPresence>;
  };
  projection: {
    projectRoot: string | null;
    squadPath: string | null;
    artifacts: SquadSyncProjectionArtifact[];
  };
  surfaces: SquadSyncSurfaceContract[];
  repairActions: SquadSyncRepairAction[];
}

export function resolveSyncStorageContract(
  rawProvider?: string | null,
): SquadSyncStorageContract {
  const raw = rawProvider?.trim() || null;
  const normalized = raw?.toLowerCase() ?? null;
  const mode: SquadSyncStorageMode = !normalized || normalized === 'postgresql'
    ? 'postgresql'
    : 'filesystem';

  if (mode === 'postgresql') {
    return {
      rawProvider: raw,
      mode,
      authority: 'squad_storage',
      importBehavior: 'one-time-filesystem-import-when-empty',
      mirrorBehavior: 'none',
      sharedExternalAccess: 'hosted-postgresql-or-squadboard-broker',
    };
  }

  return {
    rawProvider: raw,
    mode,
    authority: 'filesystem',
    importBehavior: 'live-filesystem',
    mirrorBehavior: 'none',
    sharedExternalAccess: 'direct-filesystem-access',
  };
}

export function buildSyncOwnershipStatus(
  input: BuildSyncOwnershipStatusInput = {},
): SquadSyncOwnershipStatus {
  const storage = resolveSyncStorageContract(input.storageProvider);
  const presence = input.presence ?? {};
  const artifacts = buildArtifacts(presence);
  const missingRequired = artifacts
    .filter((artifact) => artifact.requirement === 'required' && artifact.status === 'missing')
    .map((artifact) => artifact.id);
  const missingRecommended = artifacts
    .filter((artifact) => artifact.requirement === 'recommended' && artifact.status === 'missing')
    .map((artifact) => artifact.id);

  const requiredCount = artifacts.filter((artifact) => artifact.requirement === 'required').length;
  const bootstrapStatus: SquadSyncBootstrapStatus = missingRequired.length === 0
    ? 'ready'
    : missingRequired.length === requiredCount
      ? 'missing'
      : 'partial';

  return {
    contractVersion: SQUAD_SYNC_OWNERSHIP_CONTRACT_VERSION,
    storage,
    bootstrap: {
      status: bootstrapStatus,
      missingRequired,
      missingRecommended,
    },
    projection: {
      projectRoot: input.projectRoot ?? null,
      squadPath: input.squadPath ?? null,
      artifacts,
    },
    surfaces: SURFACE_CONTRACTS,
    repairActions: buildRepairActions(missingRequired, missingRecommended, storage.mode),
  };
}

const ARTIFACT_SPECS: Array<{
  id: keyof SquadSyncProjectionPresence;
  path: string;
  requirement: SquadSyncArtifactRequirement;
  owner: SquadSyncSurface;
  purpose: string;
}> = [
  {
    id: 'squadDir',
    path: '.squad/',
    requirement: 'required',
    owner: 'squadboard',
    purpose: 'Project governance root and SDK state collection boundary.',
  },
  {
    id: 'agentsDir',
    path: '.squad/agents/',
    requirement: 'required',
    owner: 'squadboard',
    purpose: 'Agent charter and history projection used by agent sync and prompt composition.',
  },
  {
    id: 'teamMd',
    path: '.squad/team.md',
    requirement: 'required',
    owner: 'squadboard',
    purpose: 'Human-readable roster and coordinator context.',
  },
  {
    id: 'routingMd',
    path: '.squad/routing.md',
    requirement: 'required',
    owner: 'squadboard',
    purpose: 'Deterministic routing rules consumed before model routing.',
  },
  {
    id: 'decisionsMd',
    path: '.squad/decisions.md',
    requirement: 'required',
    owner: 'squadboard',
    purpose: 'Merged team decisions read into agent context.',
  },
  {
    id: 'decisionsInboxDir',
    path: '.squad/decisions/inbox/',
    requirement: 'recommended',
    owner: 'squadboard',
    purpose: 'Drop-box for directive capture and Scribe merge.',
  },
  {
    id: 'ceremoniesMd',
    path: '.squad/ceremonies.md',
    requirement: 'recommended',
    owner: 'squadboard',
    purpose: 'Ceremony index; empty default is valid but means no ceremony behavior is enabled.',
  },
  {
    id: 'copilotAgentMd',
    path: '.github/agents/squad.agent.md',
    requirement: 'recommended',
    owner: 'copilot-cli',
    purpose: 'Copilot/CLI coordinator projection. Missing file does not break Squadboard runtime.',
  },
];

const SURFACE_CONTRACTS: SquadSyncSurfaceContract[] = [
  {
    surface: 'squad-sdk',
    owns: [
      'SquadClient session lifecycle and sendAndWait behavior',
      'StorageProvider and SquadState collection contracts',
      'Hook, EventBus, CostTracker, and OTel event shapes',
    ],
    doesNotOwn: [
      'Squadboard database schema, API routes, or board behavior',
      'Filesystem bootstrap scaffolding',
      'Copilot/CLI agent-file projection',
    ],
  },
  {
    surface: 'squadboard',
    owns: [
      'Project setup lifecycle and repair actions',
      'Mode selection between filesystem and PostgreSQL-backed SDK state',
      'Agent DB sync, MCP capture, workflow runs, and board state',
    ],
    doesNotOwn: [
      'External Copilot/CLI runtime semantics after projection',
      'Implicit bidirectional mirroring between DB and filesystem',
    ],
  },
  {
    surface: 'filesystem',
    owns: [
      'Live `.squad/` files only when storage mode is filesystem',
      'Projection artifacts readable by humans and external tools',
    ],
    doesNotOwn: [
      '`squad_storage` rows after PostgreSQL mode has imported filesystem state',
    ],
  },
  {
    surface: 'copilot-cli',
    owns: [
      'Behavior of `.github/agents/squad.agent.md` inside Copilot/CLI sessions',
    ],
    doesNotOwn: [
      'Squadboard board state unless it calls the MCP/API broker',
      'Squadboard SDK storage mode selection',
    ],
  },
  {
    surface: 'mcp',
    owns: [
      'Brokered board operations for external clients',
      'Directive capture and done: close-out ingress when called through Squadboard',
    ],
    doesNotOwn: [
      'Direct filesystem-to-database mirroring',
    ],
  },
];

function buildArtifacts(presence: SquadSyncProjectionPresence): SquadSyncProjectionArtifact[] {
  return ARTIFACT_SPECS.map((spec) => ({
    ...spec,
    status: presence[spec.id] === true ? 'present' : 'missing',
  }));
}

function buildRepairActions(
  missingRequired: Array<keyof SquadSyncProjectionPresence>,
  missingRecommended: Array<keyof SquadSyncProjectionPresence>,
  storageMode: SquadSyncStorageMode,
): SquadSyncRepairAction[] {
  const actions: SquadSyncRepairAction[] = [];

  if (missingRequired.length > 0) {
    actions.push({
      id: 'repair-scaffold-squad',
      owner: 'Hockney',
      reason: 'Required `.squad/` bootstrap artifacts are missing or only partially projected.',
    });
  }

  if (missingRecommended.includes('copilotAgentMd')) {
    actions.push({
      id: 'project-copilot-agent-file',
      owner: 'Kobayashi',
      reason: 'Copilot/CLI coordinator projection is absent; generate or patch `.github/agents/squad.agent.md` from the template.',
    });
  }

  if (missingRecommended.includes('ceremoniesMd')) {
    actions.push({
      id: 'seed-ceremonies-index',
      owner: 'Hockney',
      reason: 'Ceremony index is absent. An empty default is valid, but the file should exist for status clarity.',
    });
  }

  if (storageMode === 'postgresql') {
    actions.push({
      id: 'expose-sync-status-api',
      owner: 'Hockney',
      reason: 'PostgreSQL mode is authoritative after import; operators need an API that reports DB authority versus filesystem projection state.',
    });
  }

  return actions;
}
