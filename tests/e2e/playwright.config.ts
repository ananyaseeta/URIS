import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for URIS E2E tests.
 *
 * Assumes:
 *   - Frontend running on http://localhost:5173  (npm run dev in /frontend)
 *   - Backend  running on http://localhost:5000  (npm run dev in /backend)
 *   - Database seeded with: node prisma/seed.js  (in /backend)
 *
 * Seed credentials (password: 123456 for all):
 *   admin@uris.com  → ADMIN
 *   rahul@uris.com  → INTERN  (capacity 82, credibility 88)
 *   arjun@uris.com  → INTERN  (capacity 91, credibility 94)
 */
export default defineConfig({
  testDir: './specs',
  testIgnore: ['**/node_modules/**', '**/backend/**', '**/frontend/**'],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  fullyParallel: false,   // journeys share DB state — run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL:       process.env.FRONTEND_URL ?? 'http://localhost:5173',
    trace:         'on-first-retry',
    screenshot:    'only-on-failure',
    video:         'retain-on-failure',
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // In CI the servers are started externally before Playwright runs.
  // Uncomment the blocks below to have Playwright start them automatically
  // when running locally.

  webServer: [
    {
      command: 'npm run dev',
      cwd: '../../backend',
      port: 5000,
      reuseExistingServer: true,
      timeout: 60_000,          // give backend time to connect to Neon on cold start
      url: 'http://localhost:5000/health/ready',  // wait until DB is reachable too
      env: {
        // Raise rate limits so tests logging in don't hit the ceiling
        RATE_LIMIT_LOGIN_MAX:    '500',
        RATE_LIMIT_REGISTER_MAX: '100',
      },
    },
    {
      command: 'npm run dev',
      cwd: '../../frontend',
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
