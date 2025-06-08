export interface Transaction {
  team_key_transaction: boolean;
  transaction: string;
  'transaction.op': string;
  project: string;
  'tpm()': number;
  'p50(transaction.duration)': number;
  'p75(transaction.duration)': number;
  'p95(transaction.duration)': number;
  'count_unique(user)': number;
  'count_miserable(user)': number;
  'user_misery()': number;
}

export interface Event {
  id: string;
  traceId: string;
  timestamp?: number; // Added timestamp
}

export interface Span {
  description: string;
  exclusive_time: number;
}

export interface ExcelData {
  Transaction: string;
  Operation: string;
  'Event Id': string;
  Trace: string;
  'Time duration': number;
  SproutsTeam: string;
}