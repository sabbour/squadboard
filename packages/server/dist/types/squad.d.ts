export interface SquadDirectory {
    path: string;
    teamName: string;
    agentCount: number;
    hasDecisions: boolean;
    lastModified: Date;
}
export interface TeamMember {
    name: string;
    role: string;
    status: 'active' | 'retired';
}
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export interface SquadContext {
    squadPath: string;
    teamMembers: TeamMember[];
    recentDecisions: string[];
}
//# sourceMappingURL=squad.d.ts.map