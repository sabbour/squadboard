/**
 * Renderer entry point (L2 scaffold stub).
 *
 * In dev, electron-vite loads the client Vite dev server URL directly
 * (see main/index.ts — ELECTRON_RENDERER_URL env var).
 *
 * In production, the main process loads packages/client/dist/index.html
 * directly via file://, bypassing this stub entirely.
 *
 * L3 will wire the real React client here and remove this stub.
 */

async function checkHealth(): Promise<void> {
  const statusEl = document.getElementById('status');
  if (!statusEl) return;

  try {
    // Verify IPC bridge is working.
    const result = await window.squadboard.invoke('health.check');
    statusEl.innerHTML = `<p style="color:#22c55e">✓ IPC bridge OK — ${JSON.stringify(result)}</p>`;

    // Attempt to reach the HTTP API directly.
    const resp = await fetch('http://localhost:3000/api/health');
    const data = await resp.json() as unknown;
    statusEl.innerHTML += `<p style="color:#22c55e">✓ Server OK — ${JSON.stringify(data)}</p>`;
  } catch (err) {
    statusEl.innerHTML = `<p style="color:#ef4444">⚠ ${String(err)}</p>
      <p><a onclick="checkHealth()">Retry</a></p>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkHealth();
});

// Make globally available for the inline onclick above.
(window as unknown as Record<string, unknown>)['checkHealth'] = checkHealth;
