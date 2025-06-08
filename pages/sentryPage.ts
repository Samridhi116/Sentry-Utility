import { Page } from '@playwright/test';
import { SENTRY_CONFIG, FIELD_SORTS, PROJECTS, SELECTED_PROJECT, STATS_PERIOD, FIELD_SELECTED, TRANSACTION_THRESHOLD } from './parameters';
import { constructTransactionsApiUrl, fetchApiData, ApiResponse } from '../utils/apiUtils';
import { Transaction, Event, Span } from '../types/sentry';
import { URL } from 'url';

/**
 * Interface representing a row of data to be exported
 */
interface ExcelData {
  Transaction: string;
  Operation: string;
  'Event Id': string;
  Trace: string;
  'Time duration': number;
  SproutsTeam: string;
}

export class SentryPage {
  pages: Page[];
  constructor(pages: Page[]) {
    this.pages = pages;
  }

  /**
   * Logs into Sentry using environment variables for credentials
   * @throws Will throw an error if login fails
   */
  async login() {
    const page = this.pages[0];
    const loginUrl = 'https://sprouts-x2.sentry.io/auth/login/sprouts-x2/';
    
    await page.goto(loginUrl);
    await page.locator('input[name="username"]').fill(process.env.SENTRY_EMAIL || '');
    await page.locator('input[name="password"]').fill(process.env.SENTRY_PASSWORD || '');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.goto('https://sprouts-x2.sentry.io/issues/?project=4506947671425024&statsPeriod=7d');
  }

  /**
   * Navigates to the frontend performance page in Sentry
   * @throws Will throw an error if navigation fails
   */
  async gotoFrontend() {
    const page = this.pages[0];
    const sortFields = ['-team_key_transaction', '-p95_transaction_duration'];
    const frontendUrl = `https://sprouts-x2.sentry.io/insights/frontend/?project=${PROJECTS[SELECTED_PROJECT].projectId}&sort=${sortFields.join('&sort=')}&statsPeriod=${STATS_PERIOD}`;
    
    await page.goto(frontendUrl);
  }

  /**
   * Fetches transactions from Sentry API with pagination support
   * @returns Promise resolving to an array of Transaction objects
   */
  async fetchTransactions(): Promise<Transaction[]> {
    const page = this.pages[0];
    const transactionApiUrl = constructTransactionsApiUrl(SELECTED_PROJECT);
    let transactions: Transaction[] = [];
    let cursor: string | null = null;

    do {
      const url = cursor ? `${transactionApiUrl}&cursor=${encodeURIComponent(cursor)}` : transactionApiUrl;
      
      try {
        const response: ApiResponse<any> = await fetchApiData<any>(page, url);
        if (response.error) {
          throw new Error(`Failed to fetch transactions: ${response.error}`);
        }
        
        if (response.data?.data) {
          const newTransactions = response.data.data.filter(
            (tx: Transaction) => tx['p95(transaction.duration)'] > TRANSACTION_THRESHOLD
          );
          transactions = transactions.concat(newTransactions);
        } else {
          throw new Error('Unexpected API response structure');
        }
        
        cursor = response.data?.meta?.cursor || response.data?.links?.next?.cursor || response.data?.links?.next?.results || null;
        if (!cursor && response.data?.links?.next && typeof response.data.links.next === 'string') {
          try {
            const nextUrl = new URL(response.data.links.next, 'https://us.sentry.io');
            cursor = nextUrl.searchParams.get('cursor');
          } catch (e) {
            // If URL parsing fails, try regex extraction
            const match = response.data.links.next.match(/cursor=([^&]+)/);
            cursor = match ? decodeURIComponent(match[1]) : null;
          }
        }
      } catch (error) {
        throw new Error(`Failed to fetch transactions: ${error}`);
      }
    } while (cursor);

    return transactions;
  }

  /**
   * Fetches sampled events for a specific transaction
   * @param transaction - The transaction to fetch events for
   * @param project - The project identifier
   * @returns Promise resolving to an array of Event objects
   */
  async fetchSampledEvents(transaction: Transaction, project: string): Promise<Event[]> {
    const page = this.pages[0];
    const transactionOp = transaction['transaction.op'] || 'pageload';
    const projectId = PROJECTS[SELECTED_PROJECT].projectId;
    const sortField = FIELD_SORTS[0] === 'p95(transaction.duration)' ? '-transaction.duration' : `-${FIELD_SORTS[0] || 'transaction.duration'}`;
    const durationThreshold = transaction['p95(transaction.duration)'] || TRANSACTION_THRESHOLD;
    
    const eventApiUrl = `${SENTRY_CONFIG.apiBaseUrl}/organizations/${SENTRY_CONFIG.organization}/events/?field=id&field=user.display&field=span_ops_breakdown.relative&field=transaction.duration&field=trace&field=timestamp&field=spans.browser&field=spans.db&field=spans.http&field=spans.resource&field=spans.ui&field=replayId&per_page=50&project=${projectId}&query=transaction.op:${encodeURIComponent(transactionOp)}%20event.type:transaction%20transaction:${encodeURIComponent(transaction.transaction)}%20transaction.duration:<=${durationThreshold}&referrer=api.performance.transaction-events&sort=${sortField}&statsPeriod=${STATS_PERIOD}`;
    
    let events: Event[] = [];
    let cursor: string | null = null;

    do {
      const url = cursor ? `${eventApiUrl}&cursor=${encodeURIComponent(cursor)}` : eventApiUrl;
      
      try {
        const eventResponse: ApiResponse<any> = await fetchApiData<any>(page, url);
        if (eventResponse.error) {
          throw new Error(`Failed to fetch sampled events: ${eventResponse.error}`);
        }
        
        if (eventResponse.data?.data?.length > 0) {
          events = events.concat(eventResponse.data.data.map((e: any) => ({
            id: e.id,
            traceId: e.trace || e.contexts?.trace?.trace_id,
            timestamp: e.timestamp || 0,
          })));
        } else {
          break; // No more events to process
        }
        
        cursor = eventResponse.data?.meta?.cursor || eventResponse.data?.links?.next?.cursor || eventResponse.data?.links?.next?.results || null;
        if (!cursor && eventResponse.data?.links?.next) {
          try {
            const nextUrl = new URL(eventResponse.data.links.next, 'https://us.sentry.io');
            cursor = nextUrl.searchParams.get('cursor');
          } catch (e) {
            const match = eventResponse.data.links.next.match(/cursor=([^&]+)/);
            cursor = match ? decodeURIComponent(match[1]) : null;
          }
        }
      } catch (error) {
        throw new Error(`Error fetching sampled events: ${error}`);
      }
    } while (cursor);

    return events;
  }

  /**
   * Fetches detailed span information for a specific trace event
   * @param eventId - The ID of the event to fetch spans for
   * @param traceId - The ID of the trace
   * @param transaction - Optional transaction object for additional context
   * @param timestamp - Timestamp of the event
   * @returns Promise resolving to an array of Span objects
   */
  async fetchTraceDetails(eventId: string, traceId: string, transaction: Transaction | undefined, timestamp: number): Promise<Span[]> {
    const page = this.pages[0];
    const projectName = PROJECTS[SELECTED_PROJECT].name.toLowerCase().replace(/\s+/g, '-');
    const traceApiUrl = `${SENTRY_CONFIG.apiBaseUrl}/organizations/${SENTRY_CONFIG.organization}/events/${projectName}:${encodeURIComponent(eventId)}/?referrer=trace-details-summary&field=spans&field=spans.ui&field=spans.browser&field=spans.db&field=spans.http&field=spans.resource`;
    
    let spans: Span[] = [];
    
    try {
      const spanResponse: ApiResponse<any> = await fetchApiData<any>(page, traceApiUrl);
      
      if (spanResponse.error) {
        return spans; // Return empty array on error
      }
      
      let rawSpans: any[] = [];
      if (spanResponse.data?.entries && Array.isArray(spanResponse.data.entries)) {
        const spansEntry = spanResponse.data.entries.find((entry: any) => 
          entry.type === 'spans' || entry.data?.spans
        );
        rawSpans = spansEntry?.data?.spans || spansEntry?.data || [];
      } else if (spanResponse.data?.spans) {
        rawSpans = spanResponse.data.spans;
      } else if (spanResponse.data?.data?.spans) {
        rawSpans = spanResponse.data.data.spans;
      }
      
      if (rawSpans.length > 0) {
        spans = rawSpans.map((s: any) => ({
          description: s.description || s.op || 'No description',
          exclusive_time: s.exclusive_time || s.span_duration || s.duration || 0,
        }));
      }
    } catch (error) {
      // Silently handle errors and return whatever spans we have
    }
    
    return spans;
  }

  /**
   * Processes transaction data and spans to generate Excel-exportable rows
   * @param transaction - The transaction containing metadata about the operation
   * @param event - The event associated with the transaction
   * @param spans - Array of spans to be processed
   * @returns Promise resolving to an array of ExcelData rows
   */
  async processTransaction(transaction: Transaction, event: Event, spans: Span[]): Promise<ExcelData[]> {
    // List of domains that should be categorized as backend operations
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

    // Domains to exclude from processing
    const excludedDomains = [
      'run.dev.reply.io',
      'run.reply.io',
      'api-js.mixpanel.com',
      'data.pendo.io',
      'cdn.pendo.io',
    ];

    // Filter and process spans to create Excel rows
    return spans
      // Only include spans with duration > 5000ms
      .filter((span) => (span.exclusive_time || 0) > 5000)
      // Exclude spans from excluded domains
      .filter((span) => !excludedDomains.some(
        (domain) => span.description?.toLowerCase().includes(domain.toLowerCase())
      ))
      // Map spans to Excel data rows
      .map((span) => {
        const isBackend = backendDomains.some((domain) =>
          span.description?.toLowerCase().includes(domain.toLowerCase())
        );

        return {
          Transaction: transaction.transaction || 'No transaction',
          Operation: transaction['transaction.op'] || 'No operation',
          'Event Id': event.id || 'No event',
          Trace: span.description || 'No trace',
          'Time duration': (span.exclusive_time || 0) / 1000, // Convert to seconds
          SproutsTeam: isBackend ? 'Backend' : 'Frontend',
        } as ExcelData;
      });
  }
}