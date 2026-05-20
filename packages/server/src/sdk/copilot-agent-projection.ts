import {
  SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION,
  type SquadSyncAuthority,
  type SquadSyncStorageContract,
} from './sync-ownership.js';

export const SQUAD_COPILOT_AGENT_PROJECTION_PATH = '.github/agents/squad.agent.md' as const;
export const SQUAD_COPILOT_AGENT_PROJECTION_START = '<!-- SQUADBOARD_CLIENT_ARTIFACT_START -->' as const;
export const SQUAD_COPILOT_AGENT_PROJECTION_END = '<!-- SQUADBOARD_CLIENT_ARTIFACT_END -->' as const;

export interface DescribeCopilotAgentProjectionInput {
  authority?: SquadSyncAuthority | SquadSyncStorageContract;
  mcpBrokerName?: string;
}

export interface CopilotAgentProjectionRequirement {
  contractVersion: typeof SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION;
  artifactId: 'copilotAgentMd';
  path: typeof SQUAD_COPILOT_AGENT_PROJECTION_PATH;
  role: 'client-instruction-projection';
  owner: 'Kobayashi';
  repairAction: 'generate-client-artifact';
  preservesUserContentOutsideSentinels: true;
  managedBlock: {
    start: typeof SQUAD_COPILOT_AGENT_PROJECTION_START;
    end: typeof SQUAD_COPILOT_AGENT_PROJECTION_END;
  };
  authorityMode: SquadSyncAuthority;
  writeGuidance: string;
  requiredSections: string[];
}

export interface RenderCopilotAgentProjectionInput extends DescribeCopilotAgentProjectionInput {
  projectName?: string;
  sourceHash?: string | null;
  generatorVersion?: string | null;
  teamPath?: string;
  routingPath?: string;
  ceremoniesPath?: string;
  decisionsPath?: string;
}

export function describeCopilotAgentProjectionRequirement(
  input: DescribeCopilotAgentProjectionInput = {},
): CopilotAgentProjectionRequirement {
  const authorityMode = normalizeAuthority(input.authority);
  const brokerName = input.mcpBrokerName ?? 'Squadboard MCP/API broker';

  return {
    contractVersion: SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION,
    artifactId: 'copilotAgentMd',
    path: SQUAD_COPILOT_AGENT_PROJECTION_PATH,
    role: 'client-instruction-projection',
    owner: 'Kobayashi',
    repairAction: 'generate-client-artifact',
    preservesUserContentOutsideSentinels: true,
    managedBlock: {
      start: SQUAD_COPILOT_AGENT_PROJECTION_START,
      end: SQUAD_COPILOT_AGENT_PROJECTION_END,
    },
    authorityMode,
    writeGuidance: authorityMode === 'squad_storage'
      ? `Durable Squad-state changes must go through the ${brokerName}; direct .squad edits are projection drift until imported.`
      : 'Durable Squad-state changes go to the live .squad/ filesystem bundle; use Squadboard MCP/API only for board operations.',
    requiredSections: [
      'contract version and generator ownership',
      'active authority mode',
      'team roster reference',
      'routing rules reference',
      'ceremony entrypoint reference',
      'decision capture and handoff guidance',
      'MCP/API broker guidance for PostgreSQL authority',
    ],
  };
}

export function renderCopilotAgentProjection(
  input: RenderCopilotAgentProjectionInput = {},
): string {
  const requirement = describeCopilotAgentProjectionRequirement(input);
  const projectName = input.projectName ?? 'Squad project';
  const sourceHash = input.sourceHash ?? 'unknown';
  const generatorVersion = input.generatorVersion ?? SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION;
  const teamPath = input.teamPath ?? '.squad/team.md';
  const routingPath = input.routingPath ?? '.squad/routing.md';
  const ceremoniesPath = input.ceremoniesPath ?? '.squad/ceremonies.md';
  const decisionsPath = input.decisionsPath ?? '.squad/decisions.md';

  return `${SQUAD_COPILOT_AGENT_PROJECTION_START}
<!-- contract: ${requirement.contractVersion} -->
<!-- generator: ${generatorVersion} -->
<!-- source-hash: ${sourceHash} -->
# Squadboard Client Projection — ${projectName}

This file is a generated Copilot/CLI instruction projection. It is not the source of truth for Squad agents, routing, ceremonies, or decisions.

## Active authority

- Authority mode: \`${requirement.authorityMode}\`
- Write guidance: ${requirement.writeGuidance}

## Shared Squad state references

- Team roster: \`${teamPath}\`
- Routing rules: \`${routingPath}\`
- Ceremonies: \`${ceremoniesPath}\`
- Decisions: \`${decisionsPath}\` and \`.squad/decisions/inbox/\`

## Handoff rule

Keep Squadboard and CLI/Copilot pointed at the same authority. If a required projection is missing or stale, report it and run the Squadboard repair action instead of inventing a new source of truth.
${SQUAD_COPILOT_AGENT_PROJECTION_END}`;
}

function normalizeAuthority(
  authority: SquadSyncAuthority | SquadSyncStorageContract | undefined,
): SquadSyncAuthority {
  if (!authority) return 'squad_storage';
  if (typeof authority === 'string') return authority;
  return authority.authority;
}
