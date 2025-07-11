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
const SENTRY_PROJECT_ID = '4509228726681602';
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
  Count: number;
  Avg_Duration: string;
  Min_Duration: string;
  Max_Duration: string;
}

// Save Trace Data to CSV
function saveTraceDataToCsv(rows: CsvRow[], type: 'frontend' | 'backend', suffix: string = ''): void {
  if (rows.length === 0) {
    console.log(`No ${type} trace data to save.`);
    return;
  }

  const headers = ['Trace', 'Count', 'Avg_Duration', 'Min_Duration', 'Max_Duration'];
  const csvRows = rows.map(row => [
    row.Trace,
    row.Count.toString(),
    row.Avg_Duration,
    row.Min_Duration,
    row.Max_Duration,
  ]);

  const csvContent = stringify([headers, ...csvRows], { delimiter: ',' });
  const outputFile = path.join(OUTPUT_DIR, `QA_${type}_sentry_${timestamp}${suffix ? `_${suffix}` : ''}.csv`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(outputFile, csvContent, { encoding: 'utf-8' });
  console.log(`${type.charAt(0).toUpperCase() + type.slice(1)} trace report saved to ${outputFile}`);
}

test.describe('Sentry API Automation', () => {
  test('Fetch and save transaction, event, and trace data to CSV with cursor pagination', async ({ request }) => {
    // Initialize data structures
    let allTraces: Trace[] = [];
    let frontend: CsvRow[] = [];
    let backend: CsvRow[] = [];

    // Handle test interruption (Ctrl+C, SIGINT, SIGTERM)
    const saveAndExit = () => {
      console.log('Test interrupted. Saving collected data to CSV.');
      saveTraceDataToCsv(frontend, 'frontend', 'partial');
      saveTraceDataToCsv(backend, 'backend', 'partial');
      process.exit(0);
    };

    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);

    try {
      console.log('Using SENTRY_AUTH_TOKEN:', SENTRY_AUTH_TOKEN ? 'Set' : 'Not set');

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
            statsPeriod: '14d',
            sort: '-p95()',
            limit: '100',
            query: 'transaction.duration:>5000ms',
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

            const filteredTransactions = transactions.filter(t => t['p95()'] > 5000);
            allTransactions.push(...filteredTransactions);
            console.log(`Filtered ${filteredTransactions.length} transactions with p95() > 5000ms`);

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
            statsPeriod: '14d',
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
            query: `trace:${traceId} span.duration:>3000ms`,
            statsPeriod: '14d',
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
              console.log(`No traces found for trace ID '${traceId}' with span.duration:>5000ms`);
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
          return allTraces;
        } catch (error) {
          console.error(`Error fetching trace data for ${traceId}: ${error}`);
          return allTraces;
        }
      }

      // Categorize and aggregate traces by description
      function categorizeAndAggregateTraces(traces: Trace[]): { frontend: CsvRow[]; backend: CsvRow[] } {
        const descriptionGroups: Map<string, Trace[]> = new Map();
        traces.forEach(trace => {
          const description = trace.description || '';
          if (!descriptionGroups.has(description)) {
            descriptionGroups.set(description, []);
          }
          descriptionGroups.get(description)!.push(trace);
        });

        const frontend: CsvRow[] = [];
        const backend: CsvRow[] = [];

        for (const [description, traceGroup] of descriptionGroups) {
          const hasExcludedDomain = excludedDomains.some(domain => description.includes(domain));
          if (hasExcludedDomain) {
            console.log(`Excluding description '${description}' due to excluded domain`);
            continue;
          }

          const isBackend = backendDomains.some(domain => description.includes(domain));
          const durations = traceGroup.map(t => t['span.duration'] / 1000); // Convert to seconds
          const count = durations.length;
          const avgDuration = durations.reduce((sum, d) => sum + d, 0) / count;
          const minDuration = Math.min(...durations);
          const maxDuration = Math.max(...durations);

          const row: CsvRow = {
            Trace: description,
            Count: count,
            Avg_Duration: parseFloat(avgDuration.toFixed(3)).toString(),
            Min_Duration: parseFloat(minDuration.toFixed(3)).toString(),
            Max_Duration: parseFloat(maxDuration.toFixed(3)).toString(),
          };

          if (isBackend) {
            backend.push(row);
          } else {
            frontend.push(row);
          }
        }

        return { frontend, backend };
      }

      // Main logic
      const start = Date.now();
      const transactions = await fetchTransactions();
      console.log(`Transaction fetch time: ${(Date.now() - start) / 1000} seconds`);

      if (transactions.length === 0) {
        console.log('No transactions found with p95() > 5000ms.');
        saveTraceDataToCsv([], 'frontend');
        saveTraceDataToCsv([], 'backend');
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
      allTraces = [];
      const tracePromises = allEvents.map(event =>
        limit(() => fetchTraceData(event.trace))
      );
      const traceResults = await Promise.all(tracePromises);
      traceResults.forEach(traces => allTraces.push(...traces));
      console.log(`Total traces fetched: ${allTraces.length}`);
      console.log(`Trace fetch time: ${(Date.now() - traceStart) / 1000} seconds`);

      // Process traces and save CSVs
      const processStart = Date.now();
      const { frontend: frontendRows, backend: backendRows } = categorizeAndAggregateTraces(allTraces);
      frontend = frontendRows;
      backend = backendRows;
      console.log(`Frontend traces: ${frontend.length}, Backend traces: ${backend.length}`);
      saveTraceDataToCsv(frontend, 'frontend');
      saveTraceDataToCsv(backend, 'backend');
      console.log(`Processing time: ${(Date.now() - processStart) / 1000} seconds`);
      console.log(`Total execution time: ${(Date.now() - start) / 1000} seconds`);
    } catch (error) {
      console.error(`Test error: ${error}`);
      saveTraceDataToCsv(frontend, 'frontend', 'error');
      saveTraceDataToCsv(backend, 'backend', 'error');
    }
  });
});