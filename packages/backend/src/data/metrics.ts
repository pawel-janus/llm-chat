/**
 * Metric -> SEC tags in priority order. A concept like "revenue" lives under
 * different tags per company and changes over time (ASC 606, 2018), so a
 * single tag cannot answer it. getFacts returns rows of the first tag that
 * has data and reports which one it used.
 *
 * The mapping is a business-logic choice (for example what counts as revenue
 * for a bank) and is based on the tags checked in the loaded data.
 */
export const METRIC_TAGS: Record<string, string[]> = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
    'RevenuesNetOfInterestExpense', // JPM
  ],
  net_income: ['NetIncomeLoss'],
  eps_basic: ['EarningsPerShareBasic'],
  eps_diluted: ['EarningsPerShareDiluted'],
  total_assets: ['Assets'],
  operating_cash_flow: ['NetCashProvidedByUsedInOperatingActivities'],
};
