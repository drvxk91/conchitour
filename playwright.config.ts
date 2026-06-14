import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  globalTimeout: 300_000,
  globalSetup: './tests/global-setup.ts',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // Electron tests run in a single Node worker; no browser project needed.
  workers: 1,
});
