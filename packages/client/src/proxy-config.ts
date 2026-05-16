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

/**
 * Vite dev-server proxy map. Keys are matched from most-specific to least;
 * '/api/ws' must come before '/api' so WebSocket upgrade requests are handled
 * by the dedicated WS entry and not the HTTP catch-all.
 */
export const proxyConfig: Record<string, ProxyEntry> = {
  // W27 Bug 3: Dedicated WebSocket proxy — must precede '/api' so Vite matches
  // it first and correctly upgrades the HTTP→WS handshake.
  '/api/ws': {
    target: 'ws://localhost:3000',
    ws: true,
    changeOrigin: true,
  },
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
  },
  // MCP Streamable HTTP transport — proxy /mcp so "Test connection" works in
  // dev mode (Vite:5173 → Express:3000) without CORS.
  '/mcp': {
    target: 'http://localhost:3000',
    changeOrigin: true,
  },
}
