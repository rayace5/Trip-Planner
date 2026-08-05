import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Trip Planner static site.
 * Since the app is a single self-contained HTML file (per the PRD's
 * non-functional requirements), tests run against a lightweight static
 * server serving the repo root rather than a build step.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    // Serves the repo root as static files. Point this at whatever file
    // your build produces (e.g. dist/index.html) if that changes.
    command: 'npx serve -l 4173 .',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
