export interface PresenceRecord {
    userId: string;
    connectedAt: Date;
    issueId: string | null;
}
/** Called when a WS client subscribes to a project. */
export declare function joinPresence(projectId: string, userId: string): void;
/** Called when a WS client unsubscribes from a project or disconnects. */
export declare function leavePresence(projectId: string, userId: string): void;
/** Called on presence.cursor messages from the client. */
export declare function moveCursor(projectId: string, userId: string, issueId: string | null): void;
/** Returns a snapshot of current presence for a project (for GET /presence). */
export declare function listPresence(projectId: string): PresenceRecord[];
/** Clean up all presence records for a userId across ALL projects they joined. */
export declare function removeUser(userId: string, subscribedProjects: string[]): void;
//# sourceMappingURL=presence.d.ts.map