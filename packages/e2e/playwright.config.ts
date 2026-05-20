import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.SQUADBOARD_E2E_BASE_URL ?? 'http://localhost:5173'
const apiBaseURL = process.env.SQUADBOARD_E2E_API_BASE ?? 'http://localhost:3000'
const runningFromE2ePackage = process.cwd().endsWith('/packages/e2e')
const repoRoot = runningFromE2ePackage ? '../..' : '.'
const e2eRoot = runningFromE2ePackage ? process.cwd() : `${process.cwd()}/packages/e2e`
const e2eHome = `${e2eRoot}/.e2e-home`
const apiURL = new URL(apiBaseURL)
const uiURL = new URL(baseURL)
const reuseExistingServer = process.env.SQUADBOARD_E2E_REUSE_SERVER !== '0' && !process.env['CI']
const startWebServers = process.env.SQUADBOARD_E2E_SKIP_WEBSERVER !== '1'
const squadStorageProvider = process.env.SQUADBOARD_E2E_SQUAD_STORAGE_PROVIDER === 'fs'
  ? 'fs'
  : 'postgresql'
const serverScript = squadStorageProvider === 'fs' ? 'dev:fs' : 'dev:postgresql'
const commonEnv = {
  ...process.env,
  HOME: e2eHome,
  SQUADBOARD_AUTO_MIGRATE: 'false',
  SQUADBOARD_AUTO_REGISTER_SELF: 'false',
  SQUADBOARD_DISABLE_CSRF: '1',
  SQUADBOARD_SQUAD_STORAGE_PROVIDER: squadStorageProvider,
}

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalTeardown: './tests/global-teardown.ts',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: startWebServers ? [
    {
      command: `pnpm --filter @sabbour/squadboard ${serverScript}`,
      url: `${apiURL.origin}/api/health`,
      cwd: repoRoot,
      env: {
        ...commonEnv,
        PORT: apiURL.port || '3000',
      },
      reuseExistingServer,
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
      reuseExistingServer,
      timeout: 120_000,
    },
  ] : undefined,
})
