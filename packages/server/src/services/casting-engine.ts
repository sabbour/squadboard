/**
 * Casting Engine wrapper — translates SDK-cast members into Squadboard agents.
 *
 * The SDK ships two universes (`usual-suspects`, `oceans-eleven`) each producing
 * `CastMember[]` whose `.role` is a generic `AgentRole` (lead, developer, tester, …).
 *
 * Squadboard creates agents from `BASE_ROLES`, which has its own ID space (lead,
 * fullstack, tester, security, devops, designer, docs, reviewer, ai, …). The
 * AGENT_ROLE_TO_BASE_ROLE map below is the bridge — it picks a sensible default
 * BASE_ROLE for each generic AgentRole. The mapping is validated at module load
 * (throws if any target ID is missing from the SDK catalog).
 */
import {
  CastingEngine,
  type CastMember,
  type CastingConfig,
  type AgentRole,
  type UniverseId,
} from '@bradygaster/squad-sdk/casting';
import { getRoleById } from './curated-roles.js';
import {
  getLocalUniverseIds,
  getLocalUniverse,
  isLocalUniverseId,
  type LocalUniverseId,
  type LocalUniverseCharacter,
} from './local-universes.js';

export type { CastMember, AgentRole, UniverseId } from '@bradygaster/squad-sdk/casting';
export type { LocalUniverseId } from './local-universes.js';

/**
 * Squadboard-side extended roles — augment the SDK's sealed `AgentRole` union
 * with the 7 non-tech roles described in `.github/agents/squad.agent.md`
 * (emoji table) and `.squad/routing.md`. Each extended role declares a base
 * SDK role it falls back to for downstream casting/charter operations.
 *
 * Wave 10 D1: HireTeamModal lets users hire any of the 16 total roles. When
 * a user selects an extended role as `requiredRoles`, the server maps it
 * through `EXTENDED_ROLE_TO_BASE_ROLE` before calling `engine.castTeam` so
 * the SDK pipeline keeps producing valid teams. The original extended-role
 * label is preserved on the casted member's `extendedRole` field so the UI
 * can render the "PM"/"Sales"/etc emoji + label, while the underlying agent
 * inherits a real charter from the mapped BASE_ROLE.
 */
export type ExtendedAgentRole =
  | 'pm'
  | 'designer-nontech'
  | 'founder'
  | 'sales'
  | 'marketing'
  | 'customer-success'
  | 'research';

export const EXTENDED_ROLE_TO_BASE_ROLE: Record<ExtendedAgentRole, AgentRole> = {
  pm: 'lead',
  'designer-nontech': 'designer',
  founder: 'lead',
  sales: 'developer',
  marketing: 'developer',
  'customer-success': 'reviewer',
  research: 'developer',
};

/**
 * Display metadata for extended roles. Emoji + label are sourced from
 * `.github/agents/squad.agent.md` (Standard role emoji mapping table).
 */
export const EXTENDED_ROLE_METADATA: Record<ExtendedAgentRole, { emoji: string; label: string }> = {
  pm: { emoji: '🎯', label: 'PM' },
  'designer-nontech': { emoji: '🎨', label: 'Designer' },
  founder: { emoji: '👔', label: 'Founder' },
  sales: { emoji: '💼', label: 'Sales' },
  marketing: { emoji: '📣', label: 'Marketing' },
  'customer-success': { emoji: '🎧', label: 'Customer Success' },
  research: { emoji: '🔬', label: 'Research' },
};

export type SquadboardAgentRole = AgentRole | ExtendedAgentRole;

const EXTENDED_ROLE_SET = new Set<string>(Object.keys(EXTENDED_ROLE_TO_BASE_ROLE));

export function isExtendedRole(role: string): role is ExtendedAgentRole {
  return EXTENDED_ROLE_SET.has(role);
}

/**
 * Resolve any Squadboard role (base or extended) to the SDK's `AgentRole`
 * the casting engine and BASE_ROLE catalogue understand.
 */
export function resolveBaseRole(role: SquadboardAgentRole): AgentRole {
  if (isExtendedRole(role)) return EXTENDED_ROLE_TO_BASE_ROLE[role];
  return role;
}

/**
 * Extends the SDK's sealed `UniverseId` union with Squadboard-local universes.
 * Use this type wherever a universe id may come from either source.
 */
export type ExtendedUniverseId = Exclude<UniverseId, 'custom'> | LocalUniverseId;

const engine = new CastingEngine();

/**
 * Default BASE_ROLE.id for each generic AgentRole emitted by the casting engine.
 * Validated at module load.
 */
export const AGENT_ROLE_TO_BASE_ROLE: Record<AgentRole, string> = {
  lead: 'lead',
  developer: 'fullstack',
  tester: 'tester',
  'prompt-engineer': 'ai',
  security: 'security',
  devops: 'devops',
  designer: 'designer',
  scribe: 'docs',
  reviewer: 'reviewer',
};

// Validate the mapping at import time — fail loud if the SDK catalog drops any of these IDs.
for (const [agentRole, baseRoleId] of Object.entries(AGENT_ROLE_TO_BASE_ROLE)) {
  if (!getRoleById(baseRoleId)) {
    throw new Error(
      `[casting-engine] AGENT_ROLE_TO_BASE_ROLE: '${agentRole}' → '${baseRoleId}' is not a valid SDK BASE_ROLE id`,
    );
  }
}

export interface CastUniverseDescriptor {
  id: ExtendedUniverseId;
  label: string;
  characterCount: number;
}

/**
 * Return all available universes: SDK-shipped (excluding 'custom') merged with
 * Squadboard-local universes (The Office, Seinfeld, The Simpsons).
 */
export function listUniverses(): CastUniverseDescriptor[] {
  const sdkOut: CastUniverseDescriptor[] = [];
  const ids = engine.getUniverses().filter((id): id is Exclude<UniverseId, 'custom'> => id !== 'custom');
  for (const id of ids) {
    const u = engine.getUniverse(id);
    if (u) sdkOut.push({ id, label: u.label, characterCount: u.characters.length });
  }
  const localOut: CastUniverseDescriptor[] = getLocalUniverseIds().map((id) => {
    const u = getLocalUniverse(id)!;
    return { id, label: u.label, characterCount: u.characters.length };
  });
  return [...sdkOut, ...localOut];
}

export interface CastTeamRequest {
  universe: ExtendedUniverseId;
  teamSize?: number;
  /**
   * Required roles. May contain SDK base roles or Squadboard-extended roles
   * (PM, Designer (non-tech), Founder, Sales, Marketing, Customer Success,
   * Research). Extended roles are mapped through `EXTENDED_ROLE_TO_BASE_ROLE`
   * before being passed to the SDK casting engine; the original extended role
   * is preserved on the casted member's `extendedRole` field.
   */
  requiredRoles?: SquadboardAgentRole[];
}

export interface CastedMember extends CastMember {
  /** Suggested BASE_ROLE id for materialising this character into a Squadboard agent */
  suggestedRoleId: string;
  /** Suggested BASE_ROLE.title (denormalised for client display) */
  suggestedRoleTitle: string;
  /** kebab-case version of the character name, suitable for use as an agent name */
  agentName: string;
  /**
   * Squadboard-extended role label (PM, Sales, Marketing, …) when the user
   * requested a non-tech role and this member was assigned to satisfy it.
   * `null` when the member was cast against a base SDK role.
   */
  extendedRole: ExtendedAgentRole | null;
}

/**
 * Produce a cast for a Squadboard hire-team flow.
 * Each CastMember is enriched with a `suggestedRoleId` so the confirm step
 * can call `generateCharter()` to write the actual charter file.
 *
 * Routes to the SDK engine for SDK universes and to a local casting path for
 * Squadboard-registered universes (The Office, Seinfeld, The Simpsons).
 *
 * Extended roles (PM, Sales, …) are translated to their base SDK roles
 * before the SDK call. The first character cast against each extended-role
 * slot is tagged with the original extended-role label so downstream UI
 * (e.g. HireTeamModal) can render the correct emoji/badge.
 */
export function castTeam(req: CastTeamRequest): CastedMember[] {
  const requestedRoles = req.requiredRoles ?? [];
  const baseRoles = requestedRoles.map(resolveBaseRole);

  // Track unmatched extended-role slots so we can stamp them onto the
  // first member returned for each base role (consumed in declaration order).
  const extendedQueue: Array<ExtendedAgentRole | null> = requestedRoles.map((role) =>
    isExtendedRole(role) ? role : null,
  );

  let members: CastMember[];
  if (isLocalUniverseId(req.universe)) {
    members = castLocalTeam(req.universe, req.teamSize ?? 5, baseRoles);
  } else {
    const config: CastingConfig = {
      universe: req.universe as UniverseId,
      teamSize: req.teamSize,
      requiredRoles: baseRoles,
    };
    members = engine.castTeam(config);
  }

  return members.map((m) => enrich(m, baseRoles, extendedQueue));
}

/**
 * Local casting path — mirrors the SDK's two-phase algorithm:
 * 1. Fill required roles first (best-fit by preferredRoles).
 * 2. Fill remaining slots from unassigned characters in declaration order.
 */
function castLocalTeam(universeId: LocalUniverseId, teamSize: number, requiredRoles: AgentRole[]): CastMember[] {
  const universe = getLocalUniverse(universeId);
  if (!universe) throw new Error(`[casting-engine] unknown local universe: ${universeId}`);

  const characters = universe.characters;
  const clamped = Math.min(teamSize, characters.length);
  const assigned = new Set<string>();
  const members: CastMember[] = [];

  // Phase 1: fill required roles
  for (const role of requiredRoles) {
    if (members.length >= clamped) break;
    const best = findLocalBestFit(characters, role, assigned);
    if (best) {
      assigned.add(best.name);
      members.push(toLocalCastMember(best, role));
    }
  }

  // Phase 2: fill remaining slots
  for (const char of characters) {
    if (members.length >= clamped) break;
    if (assigned.has(char.name)) continue;
    const role = char.preferredRoles[0] ?? 'developer';
    assigned.add(char.name);
    members.push(toLocalCastMember(char, role));
  }

  return members;
}

function findLocalBestFit(
  characters: LocalUniverseCharacter[],
  role: AgentRole,
  assigned: Set<string>,
): LocalUniverseCharacter | undefined {
  // Prefer characters whose first preferred role matches
  const primary = characters.find((c) => !assigned.has(c.name) && c.preferredRoles[0] === role);
  if (primary) return primary;
  // Fall back to any character that lists this role
  return characters.find((c) => !assigned.has(c.name) && c.preferredRoles.includes(role));
}

function toLocalCastMember(char: LocalUniverseCharacter, role: AgentRole): CastMember {
  return {
    name: char.name,
    role,
    personality: char.personality,
    backstory: char.backstory,
    displayName: `${char.name} — ${formatRole(role)}`,
  };
}

function formatRole(role: AgentRole): string {
  return role
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function enrich(
  member: CastMember,
  baseRoles: AgentRole[] = [],
  extendedQueue: Array<ExtendedAgentRole | null> = [],
): CastedMember {
  const suggestedRoleId = AGENT_ROLE_TO_BASE_ROLE[member.role];
  const baseRole = getRoleById(suggestedRoleId);

  // If the user requested an extended role for this base role, claim the
  // first matching slot (FIFO). This preserves the user's intent ("I want a
  // Marketing person") while letting the SDK pick the underlying base role.
  let extendedRole: ExtendedAgentRole | null = null;
  for (let i = 0; i < extendedQueue.length; i++) {
    const requested = extendedQueue[i];
    if (requested && baseRoles[i] === member.role) {
      extendedRole = requested;
      extendedQueue[i] = null; // consume
      break;
    }
  }

  return {
    ...member,
    suggestedRoleId,
    suggestedRoleTitle: extendedRole
      ? EXTENDED_ROLE_METADATA[extendedRole].label
      : (baseRole?.title ?? member.role),
    agentName: kebabify(member.name),
    extendedRole,
  };
}

function kebabify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug) return slug.startsWith('-') ? slug.slice(1) : slug;
  // Fallback for unicode-only names
  return 'agent-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Build a `## Persona` markdown section from a CastMember to append to the
 * SDK-generated charter. Preserves the SDK role's voice while adding character flavour.
 */
export function buildPersonaSection(member: CastMember): string {
  return [
    '## Persona',
    '',
    `**Display name:** ${member.displayName}`,
    `**Personality:** ${member.personality}`,
    '',
    member.backstory,
  ].join('\n');
}
