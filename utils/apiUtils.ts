import { Page } from '@playwright/test';
import { SENTRY_CONFIG, PROJECTS, STATS_PERIOD } from '../pages/parameters';
import { logger } from './logger';
import { URL } from 'url';

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export function constructTransactionsApiUrl(selectedProject: number) {
  const baseUrl = `${SENTRY_CONFIG.apiBaseUrl}/organizations/${SENTRY_CONFIG.organization}/events/`;
  const fields = [
    'team_key_transaction',
    'transaction',
    'transaction.op',
    'project',
    'tpm()',
    'p50(transaction.duration)',
    'p75(transaction.duration)',
    'p95(transaction.duration)',
    'count_unique(user)',
    'count_miserable(user)',
    'user_misery()'
  ];
  const query = '(( transaction.op:pageload OR transaction.op:navigation OR transaction.op:ui.render OR transaction.op:interaction ) OR project.id:[4506947671425024] ) !transaction.op:http.server event.type:transaction';
  const sortFields = ['-team_key_transaction', '-p95_transaction_duration'];
  
  return `${baseUrl}?dataset=metrics&field=${fields.map(encodeURIComponent).join('&field=')}&per_page=50&project=${PROJECTS[selectedProject].projectId}&query=${encodeURIComponent(query)}&referrer=api.performance.landing-table&sort=${sortFields.join('&sort=')}&statsPeriod=${encodeURIComponent(STATS_PERIOD)}`;
}

export async function fetchApiData<T>(page: Page, url: string): Promise<ApiResponse<T>> {
  try {
    logger.info(`Fetching API data from: ${url}`);
    const response = await page.request.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.SENTRY_API_TOKEN}`,
      },
    });
    
    if (!response.ok()) {
      const errorText = await response.text();
      logger.error(`API request failed: ${response.status()} ${errorText}`);
      return { error: `API request failed: ${response.status()} ${errorText}` };
    }
    
    const data = await response.json();
    logger.debug(`API response keys: ${JSON.stringify(Object.keys(data), null, 2)}`);
    logger.debug(`Meta: ${JSON.stringify(data.meta || {}, null, 2)}`);
    logger.debug(`Links: ${JSON.stringify(data.links || {}, null, 2)}`);
    logger.debug(`Raw response (truncated): ${JSON.stringify(data, null, 2).substring(0, 2000)}...`);
    
    let nextCursor: string | null = null;
    if (data.links?.next && data.links.next !== 'null') {
      if (typeof data.links.next === 'string') {
        try {
          const nextUrl = new URL(data.links.next.includes('://') ? data.links.next : `https://us.sentry.io${data.links.next}`);
          nextCursor = nextUrl.searchParams.get('cursor');
          logger.debug(`Parsed cursor from next URL: ${nextCursor}`);
        } catch (e) {
          logger.debug(`Failed to parse next URL: ${data.links.next}, error: ${e}`);
        }
        if (!nextCursor) {
          const match = data.links.next.match(/cursor=([^&]+)/);
          nextCursor = match ? decodeURIComponent(match[1]) : null;
          logger.debug(`Regex cursor: ${nextCursor}`);
        }
      } else if (data.links.next.cursor) {
        nextCursor = data.links.next.cursor;
        logger.debug(`Cursor from links.next.cursor: ${nextCursor}`);
      }
    } else if (data.meta?.cursor) {
      nextCursor = data.meta.cursor;
      logger.debug(`Cursor from meta.cursor: ${nextCursor}`);
    }
    logger.debug(`Next cursor: ${nextCursor || 'none'}`);
    
    return { data };
  } catch (error) {
    logger.error(`API fetch error: ${String(error)}`);
    return { error: String(error) };
  }
}