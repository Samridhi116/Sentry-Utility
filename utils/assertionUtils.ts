import { Page } from '@playwright/test';
import { logger } from './logger';

export async function assertUrl(page: Page, pattern: RegExp, options: { timeout?: number } = {}) {
  try {
    await page.waitForURL(pattern, { timeout: options.timeout || 30000 });
    logger.info(`URL matches pattern: ${pattern}`);
  } catch (error) {
    logger.error(`URL assertion failed: ${pattern}, ${error}`);
    throw error;
  }
}