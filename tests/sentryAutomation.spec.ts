import { test, Page } from '@playwright/test';
import { SentryPage, TraceData } from '../pages/sentryPage';
import { writeFileSync } from 'fs';
import { parse } from 'json2csv';
import { logger } from '../utils/logger';

test.describe('Sentry Automation', () => {
  let pages: Page[];
  let sentryPage: SentryPage;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    pages = [await context.newPage()];
    sentryPage = new SentryPage(pages);
    await sentryPage.login();
    await sentryPage.gotoFrontend();
  });

  test('Fetch and process Sentry transactions', async () => {
    const startTime = Date.now();
    logger.info('Starting Sentry automation test');

    const transactions = await sentryPage.fetchTransactions();
    const frontendData: TraceData[] = [];
    const backendData: TraceData[] = [];

    for (const transaction of transactions) {
      const project = transaction.project || 'javascript-react-qa';
      const events = await sentryPage.fetchSampledEvents(transaction, project);

      for (const event of events) {
        const spans = await sentryPage.fetchTraceDetails(event.id, event.traceId, transaction, event.timestamp ?? Math.floor(Date.now() / 1000));
        const { frontend, backend } = await sentryPage.processTransaction(transaction, event, spans);

        frontendData.push(...frontend);
        backendData.push(...backend);
      }
    }

    // Aggregate traces across all events
    const frontendTraceMap: { [key: string]: TraceData } = {};
    const backendTraceMap: { [key: string]: TraceData } = {};

    frontendData.forEach((row) => {
      if (!frontendTraceMap[row.Trace]) {
        frontendTraceMap[row.Trace] = { ...row };
      } else {
        const existing = frontendTraceMap[row.Trace];
        existing.Count += row.Count;
        existing.Avg_Duration = parseFloat(((existing.Avg_Duration * existing.Count + row.Avg_Duration * row.Count) / (existing.Count + row.Count)).toFixed(9));
        existing.Min_Duration = Math.min(existing.Min_Duration, row.Min_Duration);
        existing.Max_Duration = Math.max(existing.Max_Duration, row.Max_Duration);
      }
    });

    backendData.forEach((row) => {
      if (!backendTraceMap[row.Trace]) {
        backendTraceMap[row.Trace] = { ...row };
      } else {
        const existing = backendTraceMap[row.Trace];
        existing.Count += row.Count;
        existing.Avg_Duration = parseFloat(((existing.Avg_Duration * existing.Count + row.Avg_Duration * row.Count) / (existing.Count + row.Count)).toFixed(9));
        existing.Min_Duration = Math.min(existing.Min_Duration, row.Min_Duration);
        existing.Max_Duration = Math.max(existing.Max_Duration, row.Max_Duration);
      }
    });

    // Convert to arrays and sort by Count descending
    const frontendRows = Object.values(frontendTraceMap).sort((a, b) => b.Count - a.Count);
    const backendRows = Object.values(backendTraceMap).sort((a, b) => b.Count - a.Count);

    // Generate CSV files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('Z')[0];
    const frontendCsv = parse(frontendRows, { fields: ['Trace', 'Count', 'Avg_Duration', 'Min_Duration', 'Max_Duration'] });
    const backendCsv = parse(backendRows, { fields: ['Trace', 'Count', 'Avg_Duration', 'Min_Duration', 'Max_Duration'] });

    const frontendFilePath = `./output/frontend_sentry_${timestamp}.csv`;
    const backendFilePath = `./output/backend_sentry_${timestamp}.csv`;

    writeFileSync(frontendFilePath, frontendCsv);
    writeFileSync(backendFilePath, backendCsv);

    logger.info(`Frontend CSV written to: ${frontendFilePath}`);
    logger.info(`Backend CSV written to: ${backendFilePath}`);
    logger.info(`Total frontend rows: ${frontendRows.length}, backend rows: ${backendRows.length}`);
    logger.info(`Test completed in ${(Date.now() - startTime) / 1000} seconds`);
  });

  test.afterAll(async () => {
    for (const page of pages) {
      await page.close();
    }
  });
});