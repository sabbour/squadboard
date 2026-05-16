/**
 * packages/server/src/daemon/process.ts
 *
 * Standalone entry point for the daemon subprocess.
 * Spawned by `squadboard daemon start` as a detached process.
 * Calls startDaemon() with tickImmediately=false so it waits for the first
 * interval tick before invoking any ceremony.
 */
import { startDaemon } from './index.js';
console.log(`[daemon:process] starting — PID ${process.pid} at ${new Date().toISOString()}`);
startDaemon({ tickImmediately: false });
//# sourceMappingURL=process.js.map