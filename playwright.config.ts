import { defineConfig, devices } from '@playwright/test';

// Smoke tests run the production build on a desktop and a phone-sized browser.
// First run: `npx playwright install chromium`, then `npm run test:e2e`.
// Real iPhone Safari still needs testing by hand — see README.
const PORT = 4173;

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    permissions: ['camera'],
    launchOptions: {
      // A fake camera (a moving test pattern) so the face scan screen can start without hardware.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      executablePath: process.env.CHROME || undefined,
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
