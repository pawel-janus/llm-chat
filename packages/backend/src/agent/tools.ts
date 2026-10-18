/**
 * Tools the model can call. The list is fixed: the model never writes SQL.
 * Each tool has a declaration (what Gemini sees), a Zod schema (what we accept)
 * and a handler over the BigQuery data layer.
 */

import type { FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { listCompanies } from '../data/companies.js';
import { getFacts, listTags } from '../data/sec.js';
import { getPriceChange, getPriceOnOrBefore } from '../data/prices.js';
import { METRIC_TAGS } from '../data/metrics.js';

// Coverage of the loaded data (checked live 17.10.2026). Update when the data is reloaded.
const DATA_NOTES =
  'Data covers 6 companies only. SEC facts come from filings up to about Dec 2020 (latest filing dates 2020-10-23 to 2020-12-02) ' +
  'and some periods are missing (e.g. no FY2019 annual report for JNJ, TSLA, JPM, XOM). ' +
  'Stock prices run to 2026-10-15 and are adjusted for splits and dividends, so they are not the prices actually traded.';

const METRICS = Object.keys(METRIC_TAGS) as [string, ...string[]];

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s), 'Not a valid calendar date');
const ticker = z.string().trim().min(1).max(10);

const GetFactsArgs = z
  .object({
    ticker,
    metric: z.enum(METRICS).optional(),
    tag: z.string().trim().min(1).max(200).optional(),
    fromDate: dateString.optional(),
    toDate: dateString.optional(),
    quarters: z.number().int().min(1).max(4).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .refine((a) => (a.metric === undefined) !== (a.tag === undefined), 'Provide exactly one of "metric" or "tag"');

const ListTagsArgs = z.object({ ticker });
const GetStockPriceArgs = z.object({ ticker, date: dateString });
const GetPriceChangeArgs = z.object({ ticker, fromDate: dateString, toDate: dateString });

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'listCompanies',
    description: `List the companies the data covers (ticker and name). Call it when the user asks what data exists or names a company you are unsure about. ${DATA_NOTES}`,
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getFacts',
    description:
      'Get reported financial figures from SEC filings for one company, newest period first. ' +
      'Use "metric" for common concepts (it picks the right SEC tag for each period, because e.g. revenue changes tag over time) ' +
      'or "tag" for an exact SEC/XBRL tag found with listTags. Every row has its period_end, the length of the period in quarters, ' +
      'the form, and the filing date: always report them. Amounts are in USD unless the unit says otherwise (EPS is USD per share). ' +
      'Filter by period_end with fromDate/toDate. Use quarters=4 for full-year values, quarters=1 for single-quarter values ' +
      '(a 10-Q may also hold year-to-date values with quarters 2 or 3). period_end is rounded to the month end. ' +
      `An empty result means the data has no such figure: say so, do not guess. ${DATA_NOTES}`,
    parametersJsonSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker, e.g. AAPL.' },
        metric: { type: 'string', enum: METRICS, description: 'Common concept; use this or "tag".' },
        tag: { type: 'string', description: 'Exact SEC tag, e.g. NetIncomeLoss; use this or "metric".' },
        fromDate: { type: 'string', description: 'Earliest period_end, YYYY-MM-DD.' },
        toDate: { type: 'string', description: 'Latest period_end, YYYY-MM-DD.' },
        quarters: { type: 'integer', description: 'Period length in quarters (1-4); 4 = full year.' },
        limit: { type: 'integer', description: 'Max rows (default 50, max 200).' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'listTags',
    description:
      'List the SEC tags available for one company with the number of facts and the latest period_end, most frequent first. ' +
      'Use it to find an exact tag name for getFacts when none of the metrics fits.',
    parametersJsonSchema: {
      type: 'object',
      properties: { ticker: { type: 'string', description: 'Stock ticker, e.g. AAPL.' } },
      required: ['ticker'],
    },
  },
  {
    name: 'getStockPrice',
    description:
      'Get the adjusted closing price on a date, or on the last trading day before it. The result has the actual price_date: always report it. ' +
      'Prices are adjusted for splits and dividends, so they differ from the price traded on that day. ' +
      `Data ends 2026-10-15. ${DATA_NOTES}`,
    parametersJsonSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker, e.g. AAPL.' },
        date: { type: 'string', description: 'Date, YYYY-MM-DD.' },
      },
      required: ['ticker', 'date'],
    },
  },
  {
    name: 'getPriceChange',
    description:
      'Get the percent change of the adjusted closing price between two dates (each resolved to the last trading day on or before it). ' +
      'The result has both prices with their actual dates: always report them. Computed in code, do not recalculate.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker, e.g. AAPL.' },
        fromDate: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
        toDate: { type: 'string', description: 'End date, YYYY-MM-DD.' },
      },
      required: ['ticker', 'fromDate', 'toDate'],
    },
  },
];

type Handler = (args: unknown) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  listCompanies: async () => ({ companies: await listCompanies() }),

  getFacts: async (raw) => {
    const a = GetFactsArgs.parse(raw);
    const tags = a.metric ? METRIC_TAGS[a.metric] : [a.tag!];
    const result = await getFacts({ ...a, tags });
    const base = { ...result, metric: a.metric ?? null, tags_considered: tags, row_count: result.facts.length };
    if (result.facts.length > 0) return base;

    // Empty: look for the periods that do exist (same tags and period length, any date), so the
    // model can offer them instead of only saying "missing". A prompt hint alone was not followed.
    const nearest = await getFacts({ ticker: a.ticker, tags, quarters: a.quarters, limit: 4 });
    return {
      ...base,
      note:
        'No such figure in the data (the period may be missing from the source). Do not estimate. ' +
        (nearest.facts.length > 0
          ? 'nearest_available lists the latest periods that do exist; offer them to the user as an alternative, clearly labelled with their own period_end.'
          : 'Nothing exists for this company and metric; say so.'),
      nearest_available: nearest.facts,
    };
  },

  listTags: async (raw) => {
    const a = ListTagsArgs.parse(raw);
    return { ticker: a.ticker.toUpperCase(), tags: await listTags(a.ticker) };
  },

  getStockPrice: async (raw) => {
    const a = GetStockPriceArgs.parse(raw);
    const price = await getPriceOnOrBefore(a.ticker, a.date);
    if (!price) return { ticker: a.ticker.toUpperCase(), requested_date: a.date, price: null, note: 'No price on or before this date.' };
    return { ticker: a.ticker.toUpperCase(), requested_date: a.date, adjusted: true, price };
  },

  getPriceChange: async (raw) => {
    const a = GetPriceChangeArgs.parse(raw);
    return { ...(await getPriceChange(a.ticker, a.fromDate, a.toDate)), adjusted: true };
  },
};

export interface ToolOutcome {
  ok: boolean;
  /** Passed back to the model as the function response. */
  response: Record<string, unknown>;
}

/**
 * Run a tool. Never throws: a bad call or a data error goes back to the model
 * as a tool result, so it can fix the call or tell the user.
 */
export async function executeTool(name: string, args: unknown): Promise<ToolOutcome> {
  const handler = handlers[name];
  if (!handler) {
    return { ok: false, response: { error: `Unknown tool "${name}". Available: ${Object.keys(handlers).join(', ')}.` } };
  }
  try {
    return { ok: true, response: (await handler(args ?? {})) as Record<string, unknown> };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ');
      return { ok: false, response: { error: `Invalid arguments: ${issues}` } };
    }
    return { ok: false, response: { error: error instanceof Error ? error.message : 'Tool failed.' } };
  }
}
