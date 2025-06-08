import { Page } from '@playwright/test';
import { logger } from './logger';

export async function clickElement(page: Page, selector: string, options?: { uncheck?: boolean; timeout?: number }) {
  try {
    const [type, value] = selector.split('=');
    const timeout = options?.timeout || 3000;
    logger.info(`Attempting to click element with selector: ${selector}, timeout: ${timeout}ms`);
    if (type === 'link') {
      await page.getByRole('link', { name: value, exact: true }).click({ force: true, timeout });
    } else if (type === 'button') {
      await page.getByRole('button', { name: value }).click({ timeout });
    } else if (type === 'checkbox') {
      if (options?.uncheck) {
        await page.getByRole('checkbox', { name: value }).uncheck({ timeout });
      } else {
        await page.getByRole('checkbox', { name: value }).check({ timeout });
      }
    } else if (type === 'text') {
      await page.getByText(value).click({ timeout });
    } else {
      await page.locator(selector).click({ timeout });
    }
    logger.info(`Clicked element: ${selector}`);
  } catch (error) {
    logger.error(`Failed to click element ${selector}: ${String(error)}`);
    throw error;
  }
}

export async function fillInput(page: Page, selector: string, value: string, options?: { timeout?: number }) {
  try {
    const [type, name] = selector.split('=');
    const timeout = options?.timeout || 3000;
    if (type === 'textbox') {
      logger.info(`Filling textbox with name: ${name}, value: ${value}, timeout: ${timeout}ms`);
      await page.getByRole('textbox', { name }).fill(value, { timeout });
    } else {
      logger.info(`Filling locator: ${selector}, value: ${value}, timeout: ${timeout}ms`);
      await page.locator(selector).fill(value, { timeout });
    }
    logger.info(`Filled input ${selector} with value: ${value}`);
  } catch (error) {
    logger.error(`Failed to fill input ${selector} with value ${value}: ${String(error)}`);
    throw error;
  }
}