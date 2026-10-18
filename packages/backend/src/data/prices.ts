import { runQuery, table } from './bigquery.js';
import { assertTicker } from './companies.js';

export interface PricePoint {
  price_date: string;
  /** Adjusted for splits and dividends: not the price traded on that day. */
  close: number;
  volume: number;
}

export interface PriceChange {
  ticker: string;
  from: PricePoint;
  to: PricePoint;
  change_percent: number;
}

/** Last trading day on or before `date` (YYYY-MM-DD); null if the ticker has no price that early. */
export async function getPriceOnOrBefore(tickerInput: string, date: string): Promise<PricePoint | null> {
  const ticker = await assertTicker(tickerInput);
  const rows = await runQuery<PricePoint>(
    `SELECT FORMAT_DATE('%F', price_date) AS price_date,
            CAST(close AS FLOAT64) AS close, CAST(volume AS FLOAT64) AS volume
     FROM ${table('sunny_prices', 'prices')}
     WHERE ticker = @ticker AND price_date <= PARSE_DATE('%F', @date)
     ORDER BY price_date DESC
     LIMIT 1`,
    { ticker, date }
  );
  return rows[0] ?? null;
}

/** Percent change of the adjusted close between two dates (each resolved to the last trading day on or before). */
export async function getPriceChange(
  tickerInput: string,
  fromDate: string,
  toDate: string
): Promise<PriceChange> {
  const ticker = await assertTicker(tickerInput);
  const [from, to] = await Promise.all([
    getPriceOnOrBefore(ticker, fromDate),
    getPriceOnOrBefore(ticker, toDate),
  ]);
  if (!from || !to) {
    throw new Error(`No price for ${ticker} on or before ${!from ? fromDate : toDate}.`);
  }
  const change_percent = Math.round(((to.close - from.close) / from.close) * 10000) / 100;
  return { ticker, from, to, change_percent };
}
