/**
 * narrative-bridge.ts — Phase 10 stub, full implementation in Phase 11.
 *
 * Translates a kind='narrative' ceremony (imported markdown documentation)
 * into an executable kind='ceremony' with concrete steps the engine can run.
 *
 * For Phase 10 this is a typed stub that throws `NotImplemented`. The
 * `/api/projects/:projectId/ceremonies/:id/convert` route catches the
 * sentinel and returns 501 with a "Coming in Phase 11" message.
 */
export class NotImplementedError extends Error {
    constructor(message) {
        super(`NotImplemented: ${message}`);
        this.name = 'NotImplementedError';
    }
}
export async function convertNarrativeToExecutable(ceremonyId) {
    throw new NotImplementedError(`convertNarrativeToExecutable(${ceremonyId}) — Phase 11 will translate ` +
        `markdown narrative ceremonies into executable workflow versions.`);
}
//# sourceMappingURL=narrative-bridge.js.map