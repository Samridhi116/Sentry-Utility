import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify/sync';
import * as dotenv from 'dotenv';
import pLimit from 'p-limit';

// Load environment variables from .env file
dotenv.config();

// Configuration
const SENTRY_ORG = 'sprouts-x2';
const SENTRY_PROJECT_ID = '4506947671425024';
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN || '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';
const OUTPUT_DIR = path.join(__dirname, 'reports');
const timestamp = new Date().toISOString().replace(/T/, '-').replace(/:/g, '-').split('.')[0];
const limit = pLimit(2); // Limit to 2 concurrent API calls
const MAX_ITERATIONS = 50; // Cap at 50 pages to prevent infinite loops

// Common headers for all requests
const COMMON_HEADERS = {
  'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
  'Accept': 'application/json; charset=utf-8',
  'Content-Type': 'application/json',
};

// Domain categorization
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

// Interfaces
interface Transaction {
  transaction: string;
  'p95()': number;
  'count()': number;
}

interface Event {
  id: string;
  'transaction.duration': number;
  trace: string;
  timestamp: string;
}

interface Trace {
  transaction: string;
  description: string;
  timestamp: string;
  'span.duration': number;
  trace: string;
}

interface CsvRow {
  Trace: string;
  Time_Duration: string;
  Timestamp: string;
}

// Initialize CSV file with headers
function initializeCsv(): void {
  const headers = ['Trace', 'Time_Duration', 'Timestamp'];
  const csvContent = stringify([headers], { delimiter: ',' });
  const outputFile = path.join(OUTPUT_DIR, `apiAnalysis_${timestamp}.csv`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(outputFile, csvContent, { encoding: 'utf-8' });
  console.log(`Initialized CSV: ${outputFile}`);
}

// Append traces to CSV, grouped by description
function appendTracesToCsv(traces: Trace[]): void {
  const descriptionGroups: Map<string, CsvRow[]> = new Map();

  // Group traces by description
  traces.forEach(trace => {
    const description = trace.description || '';
    const hasExcludedDomain = excludedDomains.some(domain => description.includes(domain));
    if (hasExcludedDomain) {
      console.log(`Excluding description '${description}' due to excluded domain`);
      return;
    }

    const isBackend = backendDomains.some(domain => description.includes(domain));
    if (!isBackend) {
      console.log(`Skipping frontend trace '${description}'`);
      return;
    }

    const row: CsvRow = {
      Trace: description,
      Time_Duration: parseFloat((trace['span.duration'] / 1000).toFixed(3)).toString(),
      Timestamp: new Date(trace.timestamp).toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata', // IST (UTC+5:30)
      }).replace(/,/, '').replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2'),
    };

    if (!descriptionGroups.has(description)) {
      descriptionGroups.set(description, []);
    }
    descriptionGroups.get(description)!.push(row);
  });

  // Write grouped traces to CSV
  const outputFile = path.join(OUTPUT_DIR, `apiAnalysis_${timestamp}.csv`);
  for (const [description, rows] of descriptionGroups) {
    const csvContent = stringify(rows.map(row => [row.Trace, row.Time_Duration, row.Timestamp]), { delimiter: ',' });
    fs.appendFileSync(outputFile, csvContent, { encoding: 'utf-8' });
    console.log(`Appended ${rows.length} backend traces to CSV for: ${description}`);
  }
}

test.describe('Sentry API Analysis', () => {
  test('Fetch and save backend trace data to CSV in real-time with grouped traces', async ({ request }) => {
    // Handle test interruption (Ctrl+C, SIGINT, SIGTERM)
    const saveAndExit = () => {
      console.log('Test interrupted. CSV contains all traces fetched so far.');
      process.exit(0);
    };

    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);

    try {
      console.log('Using SENTRY_AUTH_TOKEN:', SENTRY_AUTH_TOKEN ? 'Set' : 'Not set');

      // Initialize CSV
      initializeCsv();

      // Helper to build query string
      function buildQueryString(params: Record<string, string | string[]>): string {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (Array.isArray(value)) {
            value.forEach(val => searchParams.append(key, val));
          } else {
            searchParams.append(key, value);
          }
        }
        return searchParams.toString();
      }

      // Parse Link header for pagination
      function parseLinkHeader(header: string | null): { nextUrl: string | null; hasMore: boolean } {
        if (!header) {
          console.log('No Link header found');
          return { nextUrl: null, hasMore: false };
        }
        const links = header.split(',').map(link => link.trim());
        for (const link of links) {
          const match = link.match(/<(.+?)>;\s*rel="next";\s*results="(\w+)";\s*cursor="(.+?)"/);
          if (match) {
            const [, nextUrl, results, cursor] = match;
            console.log(`Parsed next URL: ${nextUrl}, Results: ${results}, Cursor: ${cursor}`);
            return { nextUrl, hasMore: results === 'true' };
          }
        }
        console.log('No matching "next" link found in header');
        return { nextUrl: null, hasMore: false };
      }

      // Fetch Transactions (all pages with pagination)
      async function fetchTransactions(): Promise<Transaction[]> {
        const allTransactions: Transaction[] = [];
        const fetchedUrls = new Set<string>();
        let nextUrl: string | null = null;
        let iteration = 0;

        try {
          const queryParams = {
            dataset: 'transactions',
            field: ['transaction', 'p95()', 'count()'],
            project: SENTRY_PROJECT_ID,
            statsPeriod: '7d',
            sort: '-p95()',
            limit: '100',
          };
          let url = `https://sentry.io/api/0/organizations/${SENTRY_ORG}/events/?${buildQueryString(queryParams)}`;
          console.log(`Initial transactions URL: ${url}`);

          do {
            if (fetchedUrls.has(url)) {
              console.error(`Loop detected: URL ${url} was already fetched. Breaking loop.`);
              break;
            }
            if (iteration >= MAX_ITERATIONS) {
              console.error(`Max iterations (${MAX_ITERATIONS}) reached. Breaking loop.`);
              break;
            }
            fetchedUrls.add(url);
            iteration++;

            console.log(`Fetching transactions (iteration ${iteration})`);
            const response = await request.get(url, { headers: COMMON_HEADERS });
            if (!response.ok()) {
              throw new Error(`Status ${response.status()}\nResponse: ${await response.text()}\nURL: ${url}`);
            }
            const data = await response.json();
            const transactions = data.data as Transaction[];
            console.log(`Fetched ${transactions.length} transactions:`, transactions.map(t => t.transaction));

            const filteredTransactions = transactions.filter(t => t['p95()'] > 0);
            allTransactions.push(...filteredTransactions);
            console.log(`Filtered ${filteredTransactions.length} transactions with p95() > 0ms`);

            const linkHeader = response.headers()['link'];
            const { nextUrl: newNextUrl, hasMore } = parseLinkHeader(linkHeader);
            nextUrl = hasMore ? newNextUrl : null;
            console.log(`Next URL: ${nextUrl}, Has more: ${hasMore}`);

            if (nextUrl) {
              await new Promise(resolve => setTimeout(resolve, 1000)); // 1000ms delay
            }
          } while (nextUrl);

          console.log(`Total transactions fetched: ${allTransactions.length}`);
          return allTransactions;
        } catch (error) {
          console.error(`Error fetching transactions: ${error}`);
          return allTransactions;
        }
      }

      // Fetch Events for a specific transaction (all pages)
      async function fetchEvents(transaction: string): Promise<Event[]> {
        const allEvents: Event[] = [];
        let nextUrl: string | null = null;
        const fetchedUrls = new Set<string>();

        try {
          const queryParams = {
            dataset: 'transactions',
            field: ['id', 'transaction.duration', 'trace', 'timestamp'],
            per_page: '100',
            project: SENTRY_PROJECT_ID,
            query: `event.type:transaction transaction:${transaction}`,
            statsPeriod: '7d',
          };
          let url = `https://sentry.io/api/0/organizations/${SENTRY_ORG}/events/?${buildQueryString(queryParams)}`;
          console.log(`Fetching events for ${transaction}`);

          do {
            if (fetchedUrls.has(url)) {
              console.error(`Loop detected for events: URL ${url}. Breaking loop.`);
              break;
            }
            fetchedUrls.add(url);

            const response = await request.get(url, { headers: COMMON_HEADERS });
            if (!response.ok()) {
              throw new Error(`Status ${response.status()}\nResponse: ${await response.text()}\nURL: ${url}`);
            }
            const data = await response.json();
            const events = data.data as Event[];
            console.log(`Fetched ${events.length} events for transaction '${transaction}'`);
            allEvents.push(...events);

            const linkHeader = response.headers()['link'];
            const { nextUrl: newNextUrl, hasMore } = parseLinkHeader(linkHeader);
            nextUrl = hasMore ? newNextUrl : null;

            if (nextUrl) {
              await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
            }
          } while (nextUrl);

          console.log(`Total events fetched for ${transaction}: ${allEvents.length}`);
          return allEvents;
        } catch (error) {
          console.error(`Error fetching events for transaction '${transaction}': ${error}`);
          return allEvents;
        }
      }

      // Fetch Trace Data for a specific trace ID (all pages)
      async function fetchTraceData(traceId: string): Promise<Trace[]> {
        const allTraces: Trace[] = [];
        let nextUrl: string | null = null;
        const fetchedUrls = new Set<string>();

        try {
          const queryParams = {
            dataset: 'spansIndexed',
            field: ['transaction', 'description', 'timestamp', 'span.duration', 'trace'],
            per_page: '100',
            project: SENTRY_PROJECT_ID,
            query: `trace:${traceId}`,
            statsPeriod: '7d',
          };
          let url = `https://sentry.io/api/0/organizations/${SENTRY_ORG}/events/?${buildQueryString(queryParams)}`;
          console.log(`Fetching trace data for ${traceId}`);

          do {
            if (fetchedUrls.has(url)) {
              console.error(`Loop detected for traces: URL ${url}. Breaking loop.`);
              break;
            }
            fetchedUrls.add(url);

            const response = await request.get(url, { headers: COMMON_HEADERS });
            if (!response.ok()) {
              throw new Error(`Status ${response.status()}\nResponse: ${await response.text()}\nURL: ${url}`);
            }
            const data = await response.json();
            const traces = data.data as Trace[];
            console.log(`Fetched ${traces.length} trace records for ${traceId}`);
            if (traces.length === 0) {
              console.log(`No traces found for trace ID '${traceId}'`);
            }
            allTraces.push(...traces);

            const linkHeader = response.headers()['link'];
            const { nextUrl: newNextUrl, hasMore } = parseLinkHeader(linkHeader);
            nextUrl = hasMore ? newNextUrl : null;

            if (nextUrl) {
              await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
            }
          } while (nextUrl);

          console.log(`Total traces fetched for ${traceId}: ${allTraces.length}`);
          appendTracesToCsv(allTraces); // Append grouped traces for this trace ID
          return allTraces;
        } catch (error) {
          console.error(`Error fetching trace data for ${traceId}: ${error}`);
          return allTraces;
        }
      }

      // Main logic
      const start = Date.now();
      const transactions = await fetchTransactions();
      console.log(`Transaction fetch time: ${(Date.now() - start) / 1000} seconds`);

      if (transactions.length === 0) {
        console.log('No transactions found with p95() > 0ms.');
        return;
      }

      console.log(`Processing ${transactions.length} transactions`);

      // Parallelize event fetching with p-limit
      const eventStart = Date.now();
      const allEvents: Event[] = [];
      const eventPromises = transactions.map(transaction =>
        limit(() => fetchEvents(transaction.transaction))
      );
      const eventResults = await Promise.all(eventPromises);
      eventResults.forEach(events => allEvents.push(...events));
      console.log(`Total events fetched: ${allEvents.length}`);
      console.log(`Event fetch time: ${(Date.now() - eventStart) / 1000} seconds`);

      // Parallelize trace fetching with p-limit
      const traceStart = Date.now();
      const tracePromises = allEvents.map(event =>
        limit(() => fetchTraceData(event.trace))
      );
      const traceResults = await Promise.all(tracePromises);
      const allTraces = traceResults.flat();
      console.log(`Total traces fetched: ${allTraces.length}`);
      console.log(`Trace fetch time: ${(Date.now() - traceStart) / 1000} seconds`);
      console.log(`Total execution time: ${(Date.now() - start) / 1000} seconds`);
    } catch (error) {
      console.error(`Test error: ${error}`);
      console.log('CSV contains all backend traces fetched so far.');
    }
  });
});