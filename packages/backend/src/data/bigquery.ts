/**
 * BigQuery access shared by all data modules.
 * Every query is parameterized, cost-capped and pinned to the data location.
 */

import { BigQuery } from '@google-cloud/bigquery';

export const LOCATION = 'europe-central2';

// Hard cap per query; BigQuery fails the job instead of billing more.
const MAX_BYTES_BILLED = '100000000'; // 100 MB

let client: BigQuery | undefined;

function getClient(): BigQuery {
  client ??= new BigQuery({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  return client;
}

/** Fully qualified, backtick-quoted table name, e.g. `proj.sunny_sec.facts`. */
export function table(dataset: 'sunny_sec' | 'sunny_prices' | 'sunny_meta', name: string): string {
  return `\`${process.env.GOOGLE_CLOUD_PROJECT}.${dataset}.${name}\``;
}

export type QueryParams = Record<string, string | number | string[] | null>;
// Declare the type of nullable params. Dates travel as STRING and are parsed in SQL
// (a DATE-typed string param silently became NULL in the client).
export type ParamTypes = Record<string, 'STRING' | 'INT64'>;

/**
 * Run a parameterized query. Model-provided values must only travel through
 * `params`, never through string concatenation into `sql`.
 */
export async function runQuery<T>(
  sql: string,
  params: QueryParams = {},
  types: ParamTypes = {}
): Promise<T[]> {
  const [rows] = await getClient().query({
    query: sql,
    params,
    types,
    location: LOCATION,
    maximumBytesBilled: MAX_BYTES_BILLED,
  });
  return rows as T[];
}
