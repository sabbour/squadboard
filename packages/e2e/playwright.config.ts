import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.SQUADBOARD_E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
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

  // Start the Vite dev server before running tests.
  // Requires the backend to already be running on port 3000.
  webServer: {
    command: 'pnpm --filter @sabbour/squadboard-client dev',
    url: baseURL,
    cwd: '../../',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
})
