import { defineConfig, devices } from '@playwright/test';
import { SENTRY_CONFIG } from './pages/parameters';
import dotenv from 'dotenv';
import path from 'path';

// Debug .env path
const envPath = '/Users/marcellus/Desktop/Sentry-Automation/.env';

// Load .env file
dotenv.config({ path: envPath });

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/artifacts',
  reporter: [['html', { outputFolder: './test-results/html-report', open: 'never' }]],
  fullyParallel: true,
  retries: 1,
  workers: 1,
  timeout: 60 * 60 * 1000,
  use: {
    baseURL: SENTRY_CONFIG.baseUrl,
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 60 * 60 * 1000,
    navigationTimeout: 60 * 60 * 1000,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});