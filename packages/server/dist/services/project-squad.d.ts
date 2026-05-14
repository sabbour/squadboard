import { SquadContext } from '../types/squad.js';
/**
 * Link a project to its .squad/ directory.
 * Writes the squadPath into the projects row identified by projectId.
 *
 * Idempotent: calling twice with the same args is a no-op.
 */
export declare function linkProjectToSquad(projectId: string, squadPath: string): Promise<void>;
/**
 * Get the Squad context for a project: reads team.md and decisions.md.
 */
export declare function getSquadContext(projectId: string): Promise<SquadContext>;
//# sourceMappingURL=project-squad.d.ts.map