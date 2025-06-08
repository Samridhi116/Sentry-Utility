import { createWriteStream } from 'fs';
import { format } from 'date-fns';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
const logStream = createWriteStream('sentry-automation.log', { flags: 'a' });

const log = (level: LogLevel, message: string, meta?: unknown) => {
  if (LOG_LEVELS[level] > LOG_LEVELS[LOG_LEVEL]) return;
  
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  const metaString = meta ? ` - ${JSON.stringify(meta, null, 2)}` : '';
  const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}${metaString}\n`;
  
  logStream.write(logMessage);
  
  switch (level) {
    case 'error':
      console.error(logMessage);
      break;
    case 'warn':
      console.warn(logMessage);
      break;
    case 'debug':
      console.debug(logMessage);
      break;
    default:
      console.log(logMessage);
  }
};

export const logger = {
  debug: (message: string, meta?: unknown) => log('debug', message, meta),
  info: (message: string, meta?: unknown) => log('info', message, meta),
  warn: (message: string, error?: unknown) => log('warn', message, error),
  error: (message: string, error?: unknown) => log('error', message, error),
};