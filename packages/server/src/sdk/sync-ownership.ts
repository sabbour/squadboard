/**
 * sync-ownership.ts — SDK-facing ownership contract for cross-surface Squad state.
 *
 * This is intentionally pure and schema-free. Hockney can expose the returned
 * shape through an API later; Kujan can test it without a database.
 */

export const SQUAD_SYNC_OWNERSHIP_CONTRACT_VERSION = 'squadboard.sdk-sync-ownership.v1' as const;
export const SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION = 'squadboard.sdk-client-artifact.v1' as const;
export const SQUAD_SYNC_API_NAMESPACE = 'squad-sync' as const;

export type SquadSyncStorageMode = 'postgresql' | 'filesystem';
export type SquadSyncAuthority = 'squad_storage' | 'filesystem';
export type SquadSyncBootstrapStatus = 'ready' | 'partial' | 'missing';
export type SquadSyncArtifactStatus = 'present' | 'missing';
export type SquadSyncArtifactRequirement = 'required' | 'recommended' | 'optional';
export type SquadSyncSurface = 'squad-sdk' | 'squadboard' | 'filesystem' | 'copilot-cli' | 'mcp';
export type SquadSyncClient = 'squadboard' | 'copilot-cli';
export type SquadSyncClientReadinessStatus = 'ready' | 'degraded' | 'blocked';
export type SquadSyncWriteTarget = 'squad_storage' | 'filesystem' | 'squadboard-mcp-api-broker';
export type SquadSyncRepairSeverity = 'critical' | 'warning' | 'info';
export type SquadSyncRepairMode = 'automatic' | 'user-confirmed' | 'manual';

export interface SquadSyncProjectionPresence {
  squadDir?: boolean;
  agentsDir?: boolean;
  decisionsInboxDir?: boolean;
  teamMd?: boolean;
  routingMd?: boolean;
  decisionsMd?: boolean;
  ceremoniesMd?: boolean;
  ceremoniesDefaultsPresent?: boolean;
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

export interface SquadSyncAuthorityContract {
  mode: SquadSyncAuthority;
  storageMode: SquadSyncStorageMode;
  sourceOfTruth: SquadSyncAuthority;
  squadboardWriteTarget: Extract<SquadSyncWriteTarget, 'squad_storage' | 'filesystem'>;
  copilotCliWriteTarget: Extract<SquadSyncWriteTarget, 'squadboard-mcp-api-broker' | 'filesystem'>;
  projectionRole: 'client-instructions-only';
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
  severity: SquadSyncRepairSeverity;
  mode: SquadSyncRepairMode;
  artifactIds: Array<keyof SquadSyncProjectionPresence>;
  surfaces: SquadSyncSurface[];
  legacyIds?: string[];
}

export interface SquadSyncClientReadiness {
  client: SquadSyncClient;
  status: SquadSyncClientReadinessStatus;
  authority: SquadSyncAuthority;
  writeTarget: SquadSyncWriteTarget;
  blockers: Array<keyof SquadSyncProjectionPresence>;
  warnings: Array<keyof SquadSyncProjectionPresence>;
  message: string;
}

export interface SquadSyncOwnershipStatus {
  contractVersion: typeof SQUAD_SYNC_OWNERSHIP_CONTRACT_VERSION;
  clientArtifactContractVersion: typeof SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION;
  storage: SquadSyncStorageContract;
  authority: SquadSyncAuthorityContract;
  bootstrap: {
    status: SquadSyncBootstrapStatus;
    missingRequired: Array<keyof SquadSyncProjectionPresence>;
    missingRecommended: Array<keyof SquadSyncProjectionPresence>;
  };
  projection: {
    projectRoot: string | null;
    squadPath: string | null;
    artifacts: SquadSyncProjectionArtifact[];
    requiredArtifacts: Array<keyof SquadSyncProjectionPresence>;
    recommendedArtifacts: Array<keyof SquadSyncProjectionPresence>;
    optionalArtifacts: Array<keyof SquadSyncProjectionPresence>;
    missing: {
      required: Array<keyof SquadSyncProjectionPresence>;
      recommended: Array<keyof SquadSyncProjectionPresence>;
      optional: Array<keyof SquadSyncProjectionPresence>;
    };
  };
  clients: Record<'squadboard' | 'copilotCli', SquadSyncClientReadiness>;
  surfaces: SquadSyncSurfaceContract[];
  repairActions: SquadSyncRepairAction[];
}

// Mirrors packages/client/src/api/squad.ts so Hockney can return API JSON
// without rebuilding SDK ownership/projection mapping in route code.
export type SquadSyncApiAuthority = SquadSyncAuthority | 'mcp_broker' | 'unknown';
export type SquadSyncApiStorageMode = SquadSyncStorageMode | 'unknown';
export type SquadSyncApiDatabaseRuntime = 'pglite' | 'postgresql' | 'none' | 'unknown';
export type SquadSyncApiCheckStatus = 'ok' | 'missing' | 'partial' | 'drifted' | 'unknown';
export type SquadSyncApiDriftStatus = 'none' | 'detected' | 'unknown';
export type SquadSyncApiRepairAction =
  | 'project_governance'
  | 'ceremony_defaults'
  | 'agent_files'
  | 'rescan_drift';

export interface SquadSyncApiFileCheck {
  path: string;
  label: string;
  status: SquadSyncApiCheckStatus;
  present: boolean | null;
  required: boolean;
  repairAction?: SquadSyncApiRepairAction;
  message?: string;
}

export interface SquadSyncApiStatus {
  projectId: string;
  squadPath: string;
  checkedAt: string;
  sourceOfTruth: SquadSyncApiAuthority;
  storageMode: SquadSyncApiStorageMode;
  databaseRuntime: SquadSyncApiDatabaseRuntime;
  summary: {
    status: SquadSyncApiCheckStatus;
    message: string;
  };
  governance: {
    status: SquadSyncApiCheckStatus;
    files: SquadSyncApiFileCheck[];
    projectionRoot?: string | null;
  };
  ceremonies: {
    status: SquadSyncApiCheckStatus;
    defaultsPresent: boolean | null;
    defaultsMissing: string[];
    count: number | null;
    filePath?: string | null;
  };
  drift: {
    status: SquadSyncApiDriftStatus;
    surfaces: string[];
    message?: string;
  };
  repair: {
    available: boolean;
    actions: SquadSyncApiRepairAction[];
    endpoint?: string | null;
    disabledReason?: string | null;
  };
}

export interface ToSquadSyncApiStatusInput {
  projectId: string;
  checkedAt?: string | Date;
  databaseRuntime?: SquadSyncApiDatabaseRuntime;
  repairEndpoint?: string | null;
  drift?: SquadSyncApiStatus['drift'];
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
  const requiredArtifacts = artifacts
    .filter((artifact) => artifact.requirement === 'required')
    .map((artifact) => artifact.id);
  const recommendedArtifacts = artifacts
    .filter((artifact) => artifact.requirement === 'recommended')
    .map((artifact) => artifact.id);
  const optionalArtifacts = artifacts
    .filter((artifact) => artifact.requirement === 'optional')
    .map((artifact) => artifact.id);
  const missingRequired = artifacts
    .filter((artifact) => artifact.requirement === 'required' && artifact.status === 'missing')
    .map((artifact) => artifact.id);
  const missingRecommended = artifacts
    .filter((artifact) => artifact.requirement === 'recommended' && artifact.status === 'missing')
    .map((artifact) => artifact.id);
  const missingOptional = artifacts
    .filter((artifact) => artifact.requirement === 'optional' && artifact.status === 'missing')
    .map((artifact) => artifact.id);

  const bootstrapStatus: SquadSyncBootstrapStatus = missingRequired.length === 0
    ? 'ready'
    : missingRequired.length === requiredArtifacts.length
      ? 'missing'
      : 'partial';
  const authority = buildAuthorityContract(storage);

  return {
    contractVersion: SQUAD_SYNC_OWNERSHIP_CONTRACT_VERSION,
    clientArtifactContractVersion: SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION,
    storage,
    authority,
    bootstrap: {
      status: bootstrapStatus,
      missingRequired,
      missingRecommended,
    },
    projection: {
      projectRoot: input.projectRoot ?? null,
      squadPath: input.squadPath ?? null,
      artifacts,
      requiredArtifacts,
      recommendedArtifacts,
      optionalArtifacts,
      missing: {
        required: missingRequired,
        recommended: missingRecommended,
        optional: missingOptional,
      },
    },
    clients: buildClientReadiness(authority, missingRequired, missingRecommended),
    surfaces: SURFACE_CONTRACTS,
    repairActions: buildRepairActions(missingRequired, missingRecommended, storage.mode),
  };
}

export function toSquadSyncApiStatus(
  status: SquadSyncOwnershipStatus,
  input: ToSquadSyncApiStatusInput,
): SquadSyncApiStatus {
  const checkedAt = input.checkedAt instanceof Date
    ? input.checkedAt.toISOString()
    : input.checkedAt ?? new Date().toISOString();
  const files = status.projection.artifacts.map((artifact) => toApiFileCheck(artifact));
  const governanceStatus = toApiAggregateStatus(status.bootstrap.status, status.bootstrap.missingRecommended.length);
  const ceremonyDefaults = findArtifact(status, 'ceremoniesDefaultsPresent');
  const ceremoniesMd = findArtifact(status, 'ceremoniesMd');
  const repairActions = unique(
    status.repairActions
      .map((action) => toApiRepairAction(action.id))
      .filter((action): action is SquadSyncApiRepairAction => action !== null),
  );

  return {
    projectId: input.projectId,
    squadPath: status.projection.squadPath ?? '',
    checkedAt,
    sourceOfTruth: status.authority.sourceOfTruth,
    storageMode: status.authority.storageMode,
    databaseRuntime: input.databaseRuntime ?? 'unknown',
    summary: {
      status: governanceStatus,
      message: buildApiSummaryMessage(status),
    },
    governance: {
      status: governanceStatus,
      files,
      projectionRoot: status.projection.projectRoot,
    },
    ceremonies: {
      status: toApiCeremonyStatus(ceremoniesMd, ceremonyDefaults),
      defaultsPresent: ceremonyDefaults ? ceremonyDefaults.status === 'present' : null,
      defaultsMissing: ceremonyDefaults?.status === 'missing' ? ['default ceremony definitions'] : [],
      count: null,
      filePath: ceremoniesMd?.path ?? null,
    },
    drift: input.drift ?? {
      status: 'unknown',
      surfaces: [],
      message: 'Drift detection is owned by Squadboard API/storage status, not the SDK contract.',
    },
    repair: {
      available: repairActions.length > 0,
      actions: repairActions,
      endpoint: input.repairEndpoint ?? null,
      disabledReason: repairActions.length === 0 ? null : undefined,
    },
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
    requirement: 'required',
    owner: 'squadboard',
    purpose: 'Ceremony index; the file must exist and must not be an empty/default-missing placeholder.',
  },
  {
    id: 'ceremoniesDefaultsPresent',
    path: '.squad/ceremonies.md#defaults',
    requirement: 'required',
    owner: 'squadboard',
    purpose: 'Seeded ceremony defaults must be present; empty or placeholder ceremonies are a repair-required sync warning.',
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

function buildAuthorityContract(storage: SquadSyncStorageContract): SquadSyncAuthorityContract {
  if (storage.mode === 'postgresql') {
    return {
      mode: 'squad_storage',
      storageMode: storage.mode,
      sourceOfTruth: 'squad_storage',
      squadboardWriteTarget: 'squad_storage',
      copilotCliWriteTarget: 'squadboard-mcp-api-broker',
      projectionRole: 'client-instructions-only',
    };
  }

  return {
    mode: 'filesystem',
    storageMode: storage.mode,
    sourceOfTruth: 'filesystem',
    squadboardWriteTarget: 'filesystem',
    copilotCliWriteTarget: 'filesystem',
    projectionRole: 'client-instructions-only',
  };
}

function buildClientReadiness(
  authority: SquadSyncAuthorityContract,
  missingRequired: Array<keyof SquadSyncProjectionPresence>,
  missingRecommended: Array<keyof SquadSyncProjectionPresence>,
): Record<'squadboard' | 'copilotCli', SquadSyncClientReadiness> {
  const squadboardWarnings = missingRecommended.filter((artifact) => artifact !== 'copilotAgentMd');
  const copilotBlockers = [
    ...missingRequired,
    ...missingRecommended.filter((artifact) => artifact === 'copilotAgentMd'),
  ];
  const copilotWarnings = missingRecommended.filter((artifact) => artifact !== 'copilotAgentMd');

  return {
    squadboard: {
      client: 'squadboard',
      status: readinessStatus(missingRequired, squadboardWarnings),
      authority: authority.sourceOfTruth,
      writeTarget: authority.squadboardWriteTarget,
      blockers: missingRequired,
      warnings: squadboardWarnings,
      message: missingRequired.length > 0
        ? 'Squadboard needs required Squad governance artifacts before this project is fully usable.'
        : 'Squadboard can operate against the active Squad state authority.',
    },
    copilotCli: {
      client: 'copilot-cli',
      status: readinessStatus(copilotBlockers, copilotWarnings),
      authority: authority.sourceOfTruth,
      writeTarget: authority.copilotCliWriteTarget,
      blockers: copilotBlockers,
      warnings: copilotWarnings,
      message: copilotBlockers.length > 0
        ? 'CLI/Copilot continuation is not ready until required governance and client projection artifacts are present.'
        : 'CLI/Copilot can continue against the same active Squad state authority.',
    },
  };
}

function readinessStatus(
  blockers: Array<keyof SquadSyncProjectionPresence>,
  warnings: Array<keyof SquadSyncProjectionPresence>,
): SquadSyncClientReadinessStatus {
  if (blockers.length > 0) return 'blocked';
  if (warnings.length > 0) return 'degraded';
  return 'ready';
}

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

  const missingScaffoldArtifacts = missingRequired.filter(
    (artifact) => artifact !== 'ceremoniesDefaultsPresent',
  );

  if (missingScaffoldArtifacts.length > 0) {
    actions.push({
      id: 'repair-scaffold-squad',
      owner: 'Hockney',
      reason: 'Required `.squad/` bootstrap artifacts are missing or only partially projected.',
      severity: 'critical',
      mode: 'user-confirmed',
      artifactIds: missingScaffoldArtifacts,
      surfaces: ['squadboard', 'filesystem'],
    });
  }

  if (missingRecommended.includes('copilotAgentMd')) {
    actions.push({
      id: 'generate-client-artifact',
      owner: 'Kobayashi',
      reason: 'Copilot/CLI coordinator projection is absent; generate or patch `.github/agents/squad.agent.md` from the template.',
      severity: 'warning',
      mode: 'automatic',
      artifactIds: ['copilotAgentMd'],
      surfaces: ['copilot-cli'],
      legacyIds: ['project-copilot-agent-file'],
    });
  }

  if (missingRequired.includes('ceremoniesMd') || missingRequired.includes('ceremoniesDefaultsPresent')) {
    actions.push({
      id: 'seed-ceremony-defaults',
      owner: 'Hockney',
      reason: 'Ceremonies must be present and seeded with non-empty defaults; missing or placeholder ceremonies require repair.',
      severity: 'critical',
      mode: 'user-confirmed',
      artifactIds: missingRequired.filter(
        (artifact) => artifact === 'ceremoniesMd' || artifact === 'ceremoniesDefaultsPresent',
      ),
      surfaces: ['squadboard', 'filesystem', 'copilot-cli'],
    });
  }

  if (storageMode === 'postgresql' && missingRecommended.includes('copilotAgentMd')) {
    actions.push({
      id: 'validate-mcp-broker-guidance',
      owner: 'Hockney',
      reason: 'PostgreSQL authority requires generated client guidance to route durable CLI/Copilot state changes through the Squadboard MCP/API broker.',
      severity: 'warning',
      mode: 'manual',
      artifactIds: ['copilotAgentMd'],
      surfaces: ['mcp', 'copilot-cli'],
    });
  }

  return actions;
}

function toApiFileCheck(artifact: SquadSyncProjectionArtifact): SquadSyncApiFileCheck {
  const repairAction = toApiRepairActionForArtifact(artifact.id);
  return {
    path: artifact.path,
    label: API_FILE_LABELS[artifact.id],
    status: artifact.status === 'present' ? 'ok' : 'missing',
    present: artifact.status === 'present',
    required: artifact.requirement === 'required',
    repairAction: artifact.status === 'missing' ? repairAction : undefined,
    message: artifact.purpose,
  };
}

function toApiAggregateStatus(
  bootstrapStatus: SquadSyncBootstrapStatus,
  missingRecommendedCount: number,
): SquadSyncApiCheckStatus {
  if (bootstrapStatus === 'missing') return 'missing';
  if (bootstrapStatus === 'partial') return 'partial';
  if (missingRecommendedCount > 0) return 'partial';
  return 'ok';
}

function toApiCeremonyStatus(
  ceremoniesMd: SquadSyncProjectionArtifact | undefined,
  ceremonyDefaults: SquadSyncProjectionArtifact | undefined,
): SquadSyncApiCheckStatus {
  if (ceremoniesMd?.status === 'missing') return 'missing';
  if (ceremonyDefaults?.status === 'missing') return 'partial';
  if (!ceremoniesMd || !ceremonyDefaults) return 'unknown';
  return 'ok';
}

function buildApiSummaryMessage(status: SquadSyncOwnershipStatus): string {
  if (status.bootstrap.missingRequired.length > 0) {
    return 'Required Squad governance artifacts are missing; repair before treating surfaces as interchangeable.';
  }
  if (status.clients.copilotCli.status === 'blocked') {
    return 'Squadboard can operate, but CLI/Copilot continuation needs the generated client projection.';
  }
  if (status.bootstrap.missingRecommended.length > 0) {
    return 'Required governance is ready; recommended projection artifacts are missing.';
  }
  return 'Squadboard and CLI/Copilot can use the same active Squad state authority.';
}

function findArtifact(
  status: SquadSyncOwnershipStatus,
  id: keyof SquadSyncProjectionPresence,
): SquadSyncProjectionArtifact | undefined {
  return status.projection.artifacts.find((artifact) => artifact.id === id);
}

function toApiRepairAction(id: string): SquadSyncApiRepairAction | null {
  switch (id) {
    case 'repair-scaffold-squad':
      return 'project_governance';
    case 'seed-ceremony-defaults':
      return 'ceremony_defaults';
    case 'generate-client-artifact':
    case 'project-copilot-agent-file':
    case 'validate-mcp-broker-guidance':
      return 'agent_files';
    case 'rescan-drift':
      return 'rescan_drift';
    default:
      return null;
  }
}

function toApiRepairActionForArtifact(
  id: keyof SquadSyncProjectionPresence,
): SquadSyncApiRepairAction | undefined {
  switch (id) {
    case 'squadDir':
    case 'agentsDir':
    case 'decisionsInboxDir':
    case 'teamMd':
    case 'routingMd':
    case 'decisionsMd':
      return 'project_governance';
    case 'ceremoniesMd':
    case 'ceremoniesDefaultsPresent':
      return 'ceremony_defaults';
    case 'copilotAgentMd':
      return 'agent_files';
    default:
      return undefined;
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

const API_FILE_LABELS: Record<keyof SquadSyncProjectionPresence, string> = {
  squadDir: '.squad directory',
  agentsDir: 'Agent charters',
  decisionsInboxDir: 'Decision inbox',
  teamMd: 'Team roster',
  routingMd: 'Routing rules',
  decisionsMd: 'Decision log',
  ceremoniesMd: 'Ceremony index',
  ceremoniesDefaultsPresent: 'Ceremony defaults',
  copilotAgentMd: 'Copilot/CLI agent projection',
};
