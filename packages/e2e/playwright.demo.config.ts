/**
 * Playwright config for demo video recording.
 *
 * Usage:
 *   cd packages/e2e && pnpm demo:record
 *
 * Key differences from the regular test config:
 *  - Always starts fresh servers (reuseExistingServer: false)
 *  - Uses an isolated HOME (.demo-home) so PGLite starts with an empty database
 *  - Full-HD viewport (1920×1080) with deviceScaleFactor:2 for crisp recordings
 *  - video: 'on', screenshot: 'on', slowMo: 300 ms
 *  - Outputs to ./demo-results/
 */
import { defineConfig } from '@playwright/test'

const baseURL = process.env.SQUADBOARD_E2E_BASE_URL ?? 'http://localhost:5174'
const apiBaseURL = process.env.SQUADBOARD_E2E_API_BASE ?? 'http://localhost:3001'

// Make these available to test workers so fixtures.ts reads the correct ports
process.env.SQUADBOARD_E2E_BASE_URL = baseURL
process.env.SQUADBOARD_E2E_API_BASE = apiBaseURL
const runningFromE2ePackage = process.cwd().endsWith('/packages/e2e')
const repoRoot = runningFromE2ePackage ? '../..' : '.'
const e2eRoot = runningFromE2ePackage ? process.cwd() : `${process.cwd()}/packages/e2e`
const demoHome = `${e2eRoot}/.demo-home`
const apiURL = new URL(apiBaseURL)
const uiURL = new URL(baseURL)

const commonEnv: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: demoHome,
  SQUADBOARD_E2E_WORKSPACE_ROOT: '/tmp/squadboard-demo',
  SQUADBOARD_AUTO_MIGRATE: 'false',
  SQUADBOARD_AUTO_REGISTER_SELF: 'false',
  SQUADBOARD_DISABLE_CSRF: '1',
  SQUADBOARD_SQUAD_STORAGE_PROVIDER: 'postgresql',
  // Real LLM calls can take >10 min — give each agent run up to 30 minutes.
  SQUADBOARD_AGENT_RUN_TIMEOUT_MS: '1800000',
}

export default defineConfig({
  testDir: './tests',
  testMatch: '**/demo-recording.spec.ts',
  outputDir: './demo-results',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  globalTeardown: './tests/global-teardown.ts',
  // Real LLM calls + multi-agent ceremonies can take many minutes.
  // A.2 alone needs: ~90s pickup + ~600s work + ~1800s review + ~300s approve + ~300s scribe = ~3090s minimum.
  timeout: 5_400_000, // 90 minutes per test

  use: {
    baseURL,
    screenshot: 'on',
    video: { mode: 'on', size: { width: 1920, height: 1080 } },
    trace: 'off',
    launchOptions: {
      slowMo: 300,
    },
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'demo-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 2,
      },
    },
  ],

  webServer: [
    {
      // Use `tsx` (no watch) so the server never restarts mid-test due to file-system events.
      command: `pnpm --filter @sabbour/squadboard exec tsx src/cli/index.ts start --squad-storage postgresql`,
      url: `${apiURL.origin}/api/health`,
      cwd: repoRoot,
      env: {
        ...commonEnv,
        PORT: String(apiURL.port || '3000'),
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @sabbour/squadboard-client exec vite --host ${uiURL.hostname} --port ${uiURL.port || '5173'} --strictPort`,
      url: baseURL,
      cwd: repoRoot,
      env: {
        ...commonEnv,
        SQUADBOARD_DEV_API_TARGET: apiURL.origin,
        SQUADBOARD_DEV_WS_TARGET: apiURL.origin.replace(/^http/, 'ws'),
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
