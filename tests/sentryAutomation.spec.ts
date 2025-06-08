
import { test } from '@playwright/test';
import { SentryPage } from '../pages/sentryPage';
import { writeToDataFile } from '../utils/dataUtils';
import { logger } from '../utils/logger';
import path from 'path';
import dotenv from 'dotenv';

// Fallback .env loading
const envPath = '/Users/marcellus/Desktop/Sentry-Automation/.env';
logger.info(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

test.describe('Sentry Automation', () => {
  test('Fetch and process Sentry data', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const sentryPage = new SentryPage([page]);

    // Generate timestamped output file name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(
      './output',
      `sentry_${timestamp}.csv`
    );
    logger.info(`CSV output path: ${outputPath}`);

    try {
      // Login
      await sentryPage.login();
      logger.info('Login successful');

      // Navigate to frontend
      await sentryPage.gotoFrontend();
      logger.info('Navigated to frontend');

      // Fetch transactions
      const transactions = await sentryPage.fetchTransactions();
      logger.info(`Total transactions fetched: ${transactions.length}`);

      // Process each transaction
      for (const transaction of transactions) {
        const project = 'javascript-react-qa';
        const events = await sentryPage.fetchSampledEvents(transaction, project);
        logger.info(`Fetched ${events.length} events for transaction: ${transaction.transaction}`);

        for (const event of events) {
          const spans = await sentryPage.fetchTraceDetails(
            event.id,
            event.traceId,
            transaction,
            event.timestamp ?? Math.floor(Date.now() / 1000)
          );
          logger.info(`Fetched ${spans.length} spans for event: ${event.id}`);
          const rows = await sentryPage.processTransaction(transaction, event, spans);
          
          // Append data to CSV immediately
          if (rows.length > 0) {
            logger.debug(`Writing ${rows.length} rows to CSV for event ${event.id}: ${JSON.stringify(rows, null, 2)}`);
            await writeToDataFile(rows, outputPath);
          } else {
            logger.warn(`No rows to write for event: ${event.id}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Test failed: ${String(error)}`);
      await page.screenshot({ path: 'screenshots/test-error.png' });
      throw error;
    } finally {
      await context.close();
    }
  });
});
