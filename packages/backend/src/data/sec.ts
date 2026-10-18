import { runQuery, table } from './bigquery.js';
import { assertTicker } from './companies.js';

export interface Fact {
  tag: string;
  value: number;
  unit: string;
  period_end: string;
  period_end_precision: string | null;
  quarters: number | null;
  form: string | null;
  fiscal_period: string | null;
  filed_date: string;
}

export interface FactsResult {
  ticker: string;
  facts: Fact[];
}

export interface TagInfo {
  tag: string;
  facts: number;
  latest_period_end: string;
}

export interface GetFactsParams {
  ticker: string;
  /**
   * Tags in priority order. For every period the row of the highest-priority
   * tag that has one is returned (a concept like revenue changes tag over time).
   */
  tags: string[];
  /** Filters on period_end (YYYY-MM-DD), inclusive. */
  fromDate?: string;
  toDate?: string;
  /** Length of the reported period in quarters: 1 = quarter, 4 = full year (a 10-Q YTD value has 2 or 3). */
  quarters?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Facts of a ticker: all CIKs it filed under (a company can change its CIK).
const TICKER_CIKS = `cik IN (SELECT cik FROM ${table('sunny_meta', 'company_ciks')} WHERE ticker = @ticker)`;

export async function getFacts(p: GetFactsParams): Promise<FactsResult> {
  const ticker = await assertTicker(p.ticker);
  const limit = Math.min(p.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // One row per period and length: the best tag by priority, then the latest filing
  // (a later filing restates the value).
  const facts = await runQuery<Fact>(
    `WITH ranked AS (
       SELECT tag, CAST(value AS FLOAT64) AS value, unit, period_end, period_end_precision,
              quarters, form, fiscal_period, filed_date,
              ROW_NUMBER() OVER (
                PARTITION BY period_end, quarters
                ORDER BY (SELECT pos FROM UNNEST(@tags) AS t WITH OFFSET pos WHERE t = tag), filed_date DESC
              ) AS rn
       FROM ${table('sunny_sec', 'facts')}
       WHERE ${TICKER_CIKS}
         AND tag IN UNNEST(@tags)
         AND (@fromDate IS NULL OR period_end >= PARSE_DATE('%F', @fromDate))
         AND (@toDate IS NULL OR period_end <= PARSE_DATE('%F', @toDate))
         AND (@quarters IS NULL OR quarters = @quarters)
     )
     SELECT tag, value, unit, FORMAT_DATE('%F', period_end) AS period_end, period_end_precision,
            quarters, form, fiscal_period, FORMAT_DATE('%F', filed_date) AS filed_date
     FROM ranked
     WHERE rn = 1
     ORDER BY period_end DESC, quarters DESC
     LIMIT @limit`,
    {
      ticker,
      tags: p.tags,
      fromDate: p.fromDate ?? null,
      toDate: p.toDate ?? null,
      quarters: p.quarters ?? null,
      limit,
    },
    { fromDate: 'STRING', toDate: 'STRING', quarters: 'INT64' }
  );
  return { ticker, facts };
}

/** Distinct tags of a ticker with the latest period, most frequent first. */
export async function listTags(tickerInput: string, limit = 100): Promise<TagInfo[]> {
  const ticker = await assertTicker(tickerInput);
  return runQuery<TagInfo>(
    `SELECT tag, COUNT(*) AS facts, FORMAT_DATE('%F', MAX(period_end)) AS latest_period_end
     FROM ${table('sunny_sec', 'facts')}
     WHERE ${TICKER_CIKS}
     GROUP BY tag
     ORDER BY facts DESC
     LIMIT @limit`,
    { ticker, limit: Math.min(limit, MAX_LIMIT) }
  );
}
