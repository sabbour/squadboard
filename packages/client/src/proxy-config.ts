/**
 * proxy-config.ts — shared dev-server proxy entries.
 *
 * Extracted so vitest can import and assert the proxy rules without pulling
 * in vite's esbuild internals (which break in jsdom due to TextEncoder).
 */

export interface ProxyEntry {
  target: string
  changeOrigin?: boolean
  ws?: boolean
}

type ProcessLike = {
  env?: Record<string, string | undefined>
}

const processEnv = (globalThis as typeof globalThis & { process?: ProcessLike }).process?.env ?? {}
const apiTarget = processEnv.SQUADBOARD_DEV_API_TARGET ?? 'http://localhost:3000'
const wsTarget = processEnv.SQUADBOARD_DEV_WS_TARGET ?? apiTarget.replace(/^http/, 'ws')

/**
 * Vite dev-server proxy map. Keys are matched from most-specific to least;
 * '/api/ws' must come before '/api' so WebSocket upgrade requests are handled
 * by the dedicated WS entry and not the HTTP catch-all.
 */
export const proxyConfig: Record<string, ProxyEntry> = {
  // W27 Bug 3: Dedicated WebSocket proxy — must precede '/api' so Vite matches
  // it first and correctly upgrades the HTTP→WS handshake.
  '/api/ws': {
    target: wsTarget,
    ws: true,
    changeOrigin: true,
  },
  '/api': {
    target: apiTarget,
    changeOrigin: true,
  },
  // MCP Streamable HTTP transport — proxy /mcp so "Test connection" works in
  // dev mode (Vite:5173 → Express:3000) without CORS.
  '/mcp': {
    target: apiTarget,
    changeOrigin: true,
  },
}
