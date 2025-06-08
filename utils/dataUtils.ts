
import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { ExcelData } from '../types/sentry';
import { Parser } from 'json2csv';

export async function writeToDataFile(data: ExcelData[], outputPath: string) {
  try {
    // Debug directory
    const dir = path.dirname(outputPath);
    logger.info(`Checking directory: ${dir}`);
    logger.info(`Directory permissions: ${fs.statSync(dir).mode.toString(8)}`);

    const headers = ['Transaction', 'Operation', 'Event Id', 'Trace', 'Time duration', 'SproutsTeam'];
    const formattedData = data.map((row) => ({
      Transaction: row.Transaction || 'No transaction',
      Operation: row.Operation || 'No operation',
      'Event Id': row['Event Id'] || 'No event',
      Trace: row.Trace || 'No trace',
      'Time duration': Number(row['Time duration']) || 0,
      SproutsTeam: row.SproutsTeam || 'Unknown',
    }));

    // Write CSV
    const json2csvParser = new Parser({ fields: headers, header: !fs.existsSync(outputPath) });
    const csvData = json2csvParser.parse(formattedData);
    if (fs.existsSync(outputPath)) {
      logger.info(`Appending to existing CSV file: ${outputPath}`);
      fs.appendFileSync(outputPath, '\n' + csvData);
    } else {
      logger.info(`Creating new CSV file: ${outputPath}`);
      fs.writeFileSync(outputPath, csvData + '\n');
    }
    logger.info(`Successfully wrote ${data.length} rows to CSV: ${outputPath}`);
  } catch (error) {
    logger.error(`Failed to write to CSV: ${String(error)}`);
    throw new Error(`CSV write failed: ${String(error)}`);
  }
}
