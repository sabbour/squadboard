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
  requiredRoles?: AgentRole[];
}

export interface CastedMember extends CastMember {
  /** Suggested BASE_ROLE id for materialising this character into a Squadboard agent */
  suggestedRoleId: string;
  /** Suggested BASE_ROLE.title (denormalised for client display) */
  suggestedRoleTitle: string;
  /** kebab-case version of the character name, suitable for use as an agent name */
  agentName: string;
}

/**
 * Produce a cast for a Squadboard hire-team flow.
 * Each CastMember is enriched with a `suggestedRoleId` so the confirm step
 * can call `generateCharter()` to write the actual charter file.
 *
 * Routes to the SDK engine for SDK universes and to a local casting path for
 * Squadboard-registered universes (The Office, Seinfeld, The Simpsons).
 */
export function castTeam(req: CastTeamRequest): CastedMember[] {
  if (isLocalUniverseId(req.universe)) {
    const members = castLocalTeam(req.universe, req.teamSize ?? 5, req.requiredRoles ?? []);
    return members.map(enrich);
  }
  const config: CastingConfig = {
    universe: req.universe as UniverseId,
    teamSize: req.teamSize,
    requiredRoles: req.requiredRoles,
  };
  const members = engine.castTeam(config);
  return members.map(enrich);
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

function enrich(member: CastMember): CastedMember {
  const suggestedRoleId = AGENT_ROLE_TO_BASE_ROLE[member.role];
  const baseRole = getRoleById(suggestedRoleId);
  return {
    ...member,
    suggestedRoleId,
    suggestedRoleTitle: baseRole?.title ?? member.role,
    agentName: kebabify(member.name),
  };
}

function kebabify(name: string): string {
  // Take the first word (e.g. "Verbal Kint" → "verbal", "McManus" → "mcmanus")
  // and strip non-alphanumeric. Fall back to a stable hash if empty.
  const first = name.split(/\s+/)[0] ?? name;
  const slug = first
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
