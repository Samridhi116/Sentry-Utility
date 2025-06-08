import { Page } from '@playwright/test';

let currentPage: Page | null = null;

export function setPage(page: Page) {
  currentPage = page;
}

export function getPage(): Page {
  if (!currentPage) {
    throw new Error('Page not set. Call setPage first.');
  }
  return currentPage;
}