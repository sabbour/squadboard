/**
 * Curated Roles — wraps the SDK's BASE_ROLES catalog for Squadboard.
 *
 * Why a wrapper:
 *  - The SDK's `generateCharterFromRole()` emits `# {agentName} — {Role Title}` as H1,
 *    which Squadboard's `parseCharter()` would treat as the agent name. We rewrite
 *    the H1 to `# {agentName}` so the parser picks up the bare name.
 *  - The Identity table format from the SDK uses `- **Role:** <title>`, which the
 *    Squadboard parser already handles.
 */
import {
  listRoles as sdkListRoles,
  getRoleById as sdkGetRoleById,
  searchRoles as sdkSearchRoles,
  getCategories as sdkGetCategories,
  generateCharterFromRole as sdkGenerateCharter,
  type BaseRole,
  type RoleCategory,
} from '@bradygaster/squad-sdk/roles';

export type { BaseRole, RoleCategory } from '@bradygaster/squad-sdk/roles';

export function listRoles(category?: RoleCategory): readonly BaseRole[] {
  return sdkListRoles(category);
}

export function getRoleById(id: string): BaseRole | undefined {
  return sdkGetRoleById(id);
}

export function searchRoles(query: string): readonly BaseRole[] {
  return sdkSearchRoles(query);
}

export function listCategories(): readonly RoleCategory[] {
  return sdkGetCategories();
}

/**
 * Generate a Squadboard-compatible charter.md from a base role + agent name.
 *
 * Rewrites the SDK's `# {name} — {Role}` H1 to a bare `# {name}` so
 * `parseCharter().name` is correct.
 *
 * @param roleId      Base role ID (must exist in the catalog)
 * @param agentName   Kebab-case agent name (the cast name)
 * @param extraSection Optional markdown to append (e.g. `## Persona ...` for cast members)
 * @returns Charter content, or `null` if the role doesn't exist
 */
export function generateCharter(
  roleId: string,
  agentName: string,
  extraSection?: string,
): string | null {
  const sdkCharter = sdkGenerateCharter(roleId, agentName);
  if (!sdkCharter) return null;

  // SDK emits: `# {agentName} — {Role.title}\n\n> {vibe}\n\n<body>`
  // We want:   `# {agentName}\n\n> {vibe}\n\n<body>` so parseCharter().name is correct.
  const lines = sdkCharter.split('\n');
  if (lines[0]?.startsWith('# ')) {
    lines[0] = `# ${agentName}`;
  }

  let charter = lines.join('\n');
  if (extraSection && extraSection.trim()) {
    if (!charter.endsWith('\n')) charter += '\n';
    charter += '\n' + extraSection.trim() + '\n';
  }
  return charter;
}
