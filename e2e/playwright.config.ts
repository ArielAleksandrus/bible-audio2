import { defineConfig, devices } from '@playwright/test';

const PORT = 4300;

/**
 * End-to-end tests of the web/PWA build (the one Vercel serves), in a real
 * Chromium, fully offline (see fixtures.ts). `npm run test:e2e` builds first.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]] : 'list',
  outputDir: '../test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Requests made by a service worker can't be intercepted, and the SW
    // would also cache between runs. The PWA's offline caching isn't what
    // these tests cover.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node e2e/serve.mjs ${PORT}`,
    cwd: '..',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env['CI'],
  },
});
