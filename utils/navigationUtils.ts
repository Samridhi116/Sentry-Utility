import { Page } from '@playwright/test';
import { logger } from './logger';

export async function navigateTo(page: Page, url: string, retries: number = 3): Promise<void> {
  if (!page) {
    logger.error(`Cannot navigate to ${url}: page is undefined`);
    throw new Error('Page is undefined');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Navigating to ${url} (attempt ${attempt}/${retries})`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      logger.info(`Successfully navigated to ${url}`);
      return;
    } catch (error) {
      logger.error(`Navigation to ${url} failed on attempt ${attempt}/${retries}: ${String(error)}`);
      if (attempt === retries) {
        throw new Error(`Failed to navigate to ${url} after ${retries} attempts: ${String(error)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}