/**
 * BigQuery configuration - data location, datasets and the per-query cost cap.
 */

/** Region of the datasets; every query is pinned to it. */
export const LOCATION = 'europe-central2';

/** Datasets loaded in POC #3 (SEC facts, prices, shared metadata). */
export const DATASETS = ['sunny_sec', 'sunny_prices', 'sunny_meta'] as const;

export type Dataset = (typeof DATASETS)[number];

/** Hard cap per query; BigQuery fails the job instead of billing more. */
export const MAX_BYTES_BILLED = '100000000'; // 100 MB
