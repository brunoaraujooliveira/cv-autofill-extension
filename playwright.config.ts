import { defineConfig } from '@playwright/test';

const SERVER_URL = 'http://localhost:4319';

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: { baseURL: SERVER_URL, trace: 'retain-on-failure' },
  webServer: {
    command: 'node test/e2e/server.ts',
    url: `${SERVER_URL}/health`,
    reuseExistingServer: false,
  },
});
