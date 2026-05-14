import { SquadDirectory, TeamMember, ValidationResult } from '../types/squad.js';
/**
 * Scan the filesystem for .squad/ directories.
 * Always checks home dir (depth 3) + common dev dirs; additional paths via settings.
 */
export declare function discoverSquadDirectories(searchPaths: string[]): Promise<SquadDirectory[]>;
/**
 * Validate that a given path is a well-formed .squad/ directory (must have team.md).
 */
export declare function validateSquadDir(squadPath: string): Promise<ValidationResult>;
/**
 * Parse team.md to extract agent names and basic info.
 * Expects lines like: `- **Name** — Role` or `| Name | Role | Status |` (table form).
 */
export declare function parseTeamRoster(squadPath: string): Promise<TeamMember[]>;
//# sourceMappingURL=squad-discovery.d.ts.map