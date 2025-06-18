import { Page } from '@playwright/test';
import { SENTRY_CONFIG, FIELD_SORTS, PROJECTS, SELECTED_PROJECT, STATS_PERIOD, FIELD_SELECTED, TRANSACTION_THRESHOLD } from './parameters';
import { constructTransactionsApiUrl, fetchApiData, ApiResponse } from '../utils/apiUtils';
import { logger } from '../utils/logger';
import { Transaction, ExcelData, Event, Span } from '../types/sentry';
import { URL } from 'url';

export interface TraceData {
  Trace: string;
  Count: number;
  Avg_Duration: number;
  Min_Duration: number;
  Max_Duration: number;
}

export class SentryPage {
  pages: Page[];
  constructor(pages: Page[]) {
    this.pages = pages;
  }

  async login() {
    const page = this.pages[0];
    const loginUrl = `https://sprouts-x2.sentry.io/auth/login/sprouts-x2/`;
    try {
      await page.goto(loginUrl);
      logger.info(`Navigated to login URL: ${loginUrl}`);
      await page.locator('input[name="username"]').fill(process.env.SENTRY_EMAIL || '');
      await page.locator('input[name="password"]').fill(process.env.SENTRY_PASSWORD || '');
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.goto('https://sprouts-x2.sentry.io/issues/?project=4506947671425024&statsPeriod=7d');
      logger.info('Navigated to issues page and login successful');
    } catch (error) {
      logger.error(`Login failed: ${String(error)}`);
    }
  }

  async gotoFrontend() {
    const page = this.pages[0];
    const sortFields = ['-team_key_transaction', '-p95_transaction_duration'];
    const frontendUrl = `https://sprouts-x2.sentry.io/insights/frontend/?project=${PROJECTS[SELECTED_PROJECT].projectId}&sort=${sortFields.join('&sort=')}&statsPeriod=${STATS_PERIOD}`;
    try {
      await page.goto(frontendUrl);
      logger.info(`Navigated to frontend URL: ${frontendUrl}`);
    } catch (error) {
      logger.error(`Failed to navigate to frontend URL: ${String(error)}`);
    }
  }

  async fetchTransactions() {
    const page = this.pages[0];
    const transactionApiUrl = constructTransactionsApiUrl(SELECTED_PROJECT);
    let transactions: Transaction[] = [];
    let cursor: string | null = null;
    let pageCount = 0;

    do {
      const url = cursor ? `${transactionApiUrl}&cursor=${encodeURIComponent(cursor)}` : transactionApiUrl;
      logger.info(`Fetching transactions from: ${url} (page ${++pageCount})`);
      try {
        const response: ApiResponse<any> = await fetchApiData<any>(page, url);
        if (response.error) {
          logger.error(`Failed to fetch transactions: ${response.error}`);
          break;
        }
        if (response.data && response.data.data) {
          logger.info(`Total API transactions: ${response.data.data.length}`);
          const newTransactions = response.data.data.filter(
            (tx: Transaction) => tx['p95(transaction.duration)'] > TRANSACTION_THRESHOLD
          );
          transactions = transactions.concat(newTransactions);
          logger.info(`Fetched ${newTransactions.length} transactions (total: ${transactions.length})`);
          logger.debug(`Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
        } else {
          logger.warn('Unexpected API response structure');
          break;
        }
        cursor = null;
        if (response.data?.links?.next && response.data.links.next !== 'null') {
          if (typeof response.data.links.next === 'string') {
            try {
              const nextUrl = new URL(response.data.links.next.includes('://') ? response.data.links.next : `https://us.sentry.io${response.data.links.next}`);
              cursor = nextUrl.searchParams.get('cursor');
              logger.debug(`Parsed cursor from next URL: ${cursor}`);
            } catch (e) {
              logger.debug(`Failed to parse next URL: ${response.data.links.next}, error: ${e}`);
            }
            if (!cursor) {
              const match = response.data.links.next.match(/cursor=([^&]+)/);
              cursor = match ? decodeURIComponent(match[1]) : null;
              logger.debug(`Regex cursor: ${cursor}`);
            }
          } else if (response.data.links.next.cursor) {
            cursor = response.data.links.next.cursor;
            logger.debug(`Cursor from links.next.cursor: ${cursor}`);
          }
        } else if (response.data?.meta?.cursor) {
          cursor = response.data.meta.cursor;
          logger.debug(`Cursor from meta.cursor: ${cursor}`);
        }
        logger.info(`Next cursor: ${cursor || 'none'}`);
        if (!cursor && pageCount === 1 && response.data.data.length === 50) {
          cursor = '0:50:0';
          logger.warn(`No cursor found for page 1, using fallback: ${cursor}`);
        }
      } catch (error) {
        logger.error(`Fetch transactions error: ${String(error)}`);
        break;
      }
    } while (cursor);

    if (transactions.length === 0) {
      logger.warn(`No transactions found with p95(transaction.duration) > ${TRANSACTION_THRESHOLD}ms`);
    }
    logger.info(`Total transactions fetched: ${transactions.length}`);
    return transactions;
  }

  async fetchSampledEvents(transaction: Transaction, project: string) {
    const page = this.pages[0];
    const transactionOp = transaction['transaction.op'] || 'pageload';
    const projectId = PROJECTS[SELECTED_PROJECT].projectId;
    const sortField = FIELD_SORTS[0] === 'p95(transaction.duration)' ? '-transaction.duration' : `-${FIELD_SORTS[0] || 'transaction.duration'}`;
    const durationThreshold = transaction['p95(transaction.duration)'] || TRANSACTION_THRESHOLD;
    const eventApiUrl = `${SENTRY_CONFIG.apiBaseUrl}/organizations/${SENTRY_CONFIG.organization}/events/?field=id&field=user.display&field=transaction.duration&field=trace&field=timestamp&per_page=50&project=${projectId}&query=transaction.op:${encodeURIComponent(transactionOp)}%20event.type:transaction%20transaction:${encodeURIComponent(transaction.transaction)}%20transaction.duration:<=${durationThreshold}&referrer=api.performance.transaction-events&sort=${sortField}&statsPeriod=${STATS_PERIOD}`;
    let events: Event[] = [];
    let cursor: string | null = null;
    let pageCount = 0;

    do {
      const url = cursor ? `${eventApiUrl}&cursor=${encodeURIComponent(cursor)}` : eventApiUrl;
      logger.info(`Fetching sampled events for transaction: ${transaction.transaction}, URL: ${url} (page ${++pageCount})`);
      try {
        const eventResponse: ApiResponse<any> = await fetchApiData<any>(page, url);
        if (eventResponse.error) {
          logger.error(`Failed to fetch sampled events: ${eventResponse.error}`);
          break;
        }
        if (eventResponse.data && eventResponse.data.data && eventResponse.data.data.length > 0) {
          logger.info(`Total API events: ${eventResponse.data.data.length}`);
          events = events.concat(eventResponse.data.data.map((e: any) => ({
            id: e.id,
            traceId: e.trace || e.contexts?.trace?.trace_id,
            timestamp: e.timestamp || 0,
          })));
          logger.info(`Fetched ${eventResponse.data.data.length} events for transaction: ${transaction.transaction} (total: ${events.length})`);
        } else {
          logger.warn(`No sampled events found for transaction: ${transaction.transaction}`);
          break;
        }
        cursor = null;
        if (eventResponse.data?.links?.next && eventResponse.data.links.next !== 'null') {
          if (typeof eventResponse.data.links.next === 'string') {
            try {
              const nextUrl = new URL(eventResponse.data.links.next.includes('://') ? eventResponse.data.links.next : `https://us.sentry.io${eventResponse.data.links.next}`);
              cursor = nextUrl.searchParams.get('cursor');
              logger.debug(`Parsed event cursor from next URL: ${cursor}`);
            } catch (e) {
              logger.debug(`Failed to parse event next URL: ${eventResponse.data.links.next}, error: ${e}`);
            }
            if (!cursor) {
              const match = eventResponse.data.links.next.match(/cursor=([^&]+)/);
              cursor = match ? decodeURIComponent(match[1]) : null;
              logger.debug(`Regex event cursor: ${cursor}`);
            }
          } else if (eventResponse.data.links.next.cursor) {
            cursor = eventResponse.data.links.next.cursor;
            logger.debug(`Event cursor from links.next.cursor: ${cursor}`);
          }
        } else if (eventResponse.data?.meta?.cursor) {
          cursor = eventResponse.data.meta.cursor;
          logger.debug(`Event cursor from meta.cursor: ${cursor}`);
        }
        logger.info(`Next cursor event: ${cursor || 'none'}`);
      } catch (error) {
        logger.error(`Error fetching sampled events for transaction ${transaction.transaction}: ${String(error)}`);
        break;
      }
    } while (cursor);

    logger.info(`Fetched ${events.length} events for transaction: ${transaction.transaction}`);
    return events;
  }

  async fetchTraceDetails(eventId: string, traceId: string, transaction: Transaction | undefined, timestamp: number): Promise<Span[]> {
    const page = this.pages[0];
    const projectId = PROJECTS[SELECTED_PROJECT].projectId;
    const projectName = PROJECTS[SELECTED_PROJECT].name.toLowerCase().replace(/\s+/g, '-');
    const transactionOp = transaction?.['transaction.op'] || 'pageload';
    const transactionName = transaction?.transaction || 'unknown';
    logger.debug(`Fetching span details for event: ${eventId}, trace: ${traceId}`);

    const traceApiUrl = `${SENTRY_CONFIG.apiBaseUrl}/organizations/${SENTRY_CONFIG.organization}/events/${projectName}:${encodeURIComponent(eventId)}/?field=spans.op&field=spans.description&field=spans.exclusive_time&referrer=api.performance.event-details&statsPeriod=${STATS_PERIOD}`;
    
    let spans: Span[] = [];
    try {
      logger.debug(`Fetching spans for trace: ${traceId}, event: ${eventId}, URL: ${traceApiUrl}`);
      const spanResponse: ApiResponse<any> = await fetchApiData<any>(page, traceApiUrl);
      if (spanResponse.error) {
        logger.error(`Failed to fetch spans: ${spanResponse.error}`);
        return spans;
      }
      let rawSpans: any[] = [];
      if (spanResponse.data?.entries && Array.isArray(spanResponse.data.entries)) {
        const spansEntry = spanResponse.data.entries.find((entry: any) => entry.type === 'spans');
        rawSpans = spansEntry?.data || [];
      } else if (spanResponse.data?.spans) {
        rawSpans = spanResponse.data.spans;
      } else if (spanResponse.data?.data?.spans) {
        rawSpans = spanResponse.data.data.spans;
      }
      if (rawSpans.length > 0) {
        spans = rawSpans.map((s: any) => ({
          description: s.description || s.op || 'No description',
          exclusive_time: s.exclusive_time || s.duration || 0,
        }));
        logger.info(`Fetched ${spans.length} spans for trace: ${traceId}, event: ${eventId}`);
      } else {
        logger.warn(`No spans found for trace: ${traceId}, event: ${eventId}`);
      }
    } catch (error) {
      logger.error(`Failed to fetch spans for trace: ${traceId}, event: ${eventId}: ${String(error)}`);
    }
    logger.info(`Fetched ${spans.length} spans for event: ${eventId}`);
    return spans;
  }

  async processTransaction(transaction: Transaction, event: Event, spans: Span[]): Promise<{ frontend: TraceData[]; backend: TraceData[] }> {
    const backendDomains = [
      'qams.sprouts.ai',
      'devmdqs.sprouts.ai',
      'agenticapi.sprouts.ai',
      'crmms.sprouts.ai',
      'ms.sprouts.ai',
      'wa.sprouts.ai',
      'db.sprouts.ai',
      'mdqs.sprouts.ai',
      'agenticprodapi.sprouts.ai',
      'upload.sprouts.ai',
    ];
    const excludedDomains = [
      'run.dev.reply.io',
      'run.reply.io',
      'api-js.mixpanel.com',
      'data.pendo.io',
      'cdn.pendo.io',
    ];

    logger.debug(`Processing transaction: ${JSON.stringify(transaction, null, 2)}`);
    logger.debug(`Event: ${JSON.stringify(event, null, 2)}`);
    logger.debug(`Spans: ${JSON.stringify(spans, null, 2)}`);

    const traceMap: { [key: string]: { durations: number[]; team: 'Frontend' | 'Backend' } } = {};

    spans
      .filter((span) => span.exclusive_time > 5000)
      .filter((span) => 
        !excludedDomains.some((domain) => 
          span.description?.toLowerCase().includes(domain)
        )
      )
      .forEach((span) => {
        const trace = span.description || 'No description';
        const duration = (span.exclusive_time || 0) / 1000;
        const isBackend = backendDomains.some((domain) =>
          span.description?.toLowerCase().includes(domain)
        );
        const team = isBackend ? 'Backend' : 'Frontend';

        if (!traceMap[trace]) {
          traceMap[trace] = { durations: [], team };
        }
        traceMap[trace].durations.push(duration);
      });

    const frontend: TraceData[] = [];
    const backend: TraceData[] = [];

    Object.entries(traceMap).forEach(([trace, { durations, team }]) => {
      const count = durations.length;
      const avgDuration = durations.reduce((sum, d) => sum + d, 0) / count;
      const minDuration = Math.min(...durations);
      const maxDuration = Math.max(...durations);

      const data: TraceData = {
        Trace: trace,
        Count: count,
        Avg_Duration: parseFloat(avgDuration.toFixed(9)),
        Min_Duration: parseFloat(minDuration.toFixed(9)),
        Max_Duration: parseFloat(maxDuration.toFixed(9)),
      };

      if (team === 'Frontend') {
        frontend.push(data);
      } else {
        backend.push(data);
      }
    });

    logger.info(`Total spans: ${spans.length}, Filtered spans: ${spans.filter(s => s.exclusive_time > 5000).length}`);
    logger.info(`Generated ${frontend.length} frontend rows, ${backend.length} backend rows for event ${event.id}`);
    return { frontend, backend };
  }
}