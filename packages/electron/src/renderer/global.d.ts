// Type declarations for the window.squadboard IPC bridge exposed by the preload.
// This mirrors the API defined in src/preload/index.ts.

interface Window {
  squadboard: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
    off: (channel: string, listener: (...args: unknown[]) => void) => void;
  };
}
