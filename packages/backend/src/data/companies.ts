import { runQuery, table } from './bigquery.js';

export interface Company {
  ticker: string;
  name: string;
}

let cache: Company[] | undefined;

/** The companies the agent has data for (sunny_meta.companies). Cached: the list changes rarely. */
export async function listCompanies(): Promise<Company[]> {
  cache ??= await runQuery<Company>(
    `SELECT ticker, name FROM ${table('sunny_meta', 'companies')} ORDER BY ticker`
  );
  return cache;
}

/** Normalize and check a ticker against the allowlist; throws a message the model can act on. */
export async function assertTicker(ticker: string): Promise<string> {
  const normalized = ticker.trim().toUpperCase();
  const companies = await listCompanies();
  if (!companies.some((c) => c.ticker === normalized)) {
    const known = companies.map((c) => c.ticker).join(', ');
    throw new Error(`No data for ticker "${ticker}". Available tickers: ${known}.`);
  }
  return normalized;
}
