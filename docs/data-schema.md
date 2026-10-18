# Data the agent reads

The agent does not ship with data. It reads four BigQuery tables, so you need either a data layer that produces them or your own tables with the columns below. Only the columns listed are used; extra columns are ignored.

Dataset names and the BigQuery location are constants in `packages/backend/src/data/bigquery.ts` (`sunny_sec`, `sunny_prices`, `sunny_meta`, `europe-central2`). Change them there if your datasets are named or located differently. Tables must be in the same location as the queries run (`LOCATION`).

| Table | Columns used by the agent |
|-------|---------------------------|
| `sunny_meta.companies` | `ticker STRING`, `name STRING` |
| `sunny_meta.company_ciks` | `ticker STRING`, `cik INT64` (a company can have several CIKs) |
| `sunny_sec.facts` | `cik INT64`, `tag STRING`, `value NUMERIC`, `unit STRING`, `period_end DATE`, `period_end_precision STRING`, `quarters INT64`, `form STRING`, `fiscal_period STRING`, `filed_date DATE` |
| `sunny_prices.prices` | `ticker STRING`, `price_date DATE`, `close NUMERIC`, `volume NUMERIC` |

Meaning of the main columns:

- `facts.tag`: SEC/XBRL tag, for example `NetIncomeLoss`, `Revenues`, `Assets`. The mapping of metrics to tags (revenue, net income, EPS, total assets, operating cash flow) is in `packages/backend/src/data/metrics.ts`.
- `facts.quarters`: length of the period; `4` = full year, `1` = single quarter, `2`/`3` = year-to-date values in a 10-Q.
- `facts` may hold the same period several times (comparatives in later filings, restatements); the agent keeps the latest filing per period.
- `prices.close`: the agent treats it as adjusted for splits and dividends and says so in answers.

## Minimal DDL

```sql
CREATE SCHEMA IF NOT EXISTS sunny_meta OPTIONS (location = 'YOUR_REGION');
CREATE SCHEMA IF NOT EXISTS sunny_sec OPTIONS (location = 'YOUR_REGION');
CREATE SCHEMA IF NOT EXISTS sunny_prices OPTIONS (location = 'YOUR_REGION');

CREATE TABLE sunny_meta.companies (ticker STRING NOT NULL, name STRING);
CREATE TABLE sunny_meta.company_ciks (ticker STRING NOT NULL, cik INT64 NOT NULL);

CREATE TABLE sunny_sec.facts (
  cik INT64 NOT NULL, tag STRING NOT NULL, value NUMERIC, unit STRING,
  period_end DATE NOT NULL, period_end_precision STRING, quarters INT64 NOT NULL,
  form STRING, fiscal_period STRING, filed_date DATE
) CLUSTER BY cik, tag;

CREATE TABLE sunny_prices.prices (
  ticker STRING NOT NULL, price_date DATE NOT NULL, close NUMERIC, volume NUMERIC
) CLUSTER BY ticker;
```

Run it with `bq query --use_legacy_sql=false --project_id=YOUR_PROJECT_ID`, then load rows (for example from SEC EDGAR `companyfacts` JSON and a daily-prices CSV you are licensed to use) with `bq load` or an ETL of your own.

## Data-dependent text in the code

Some wording describes the maintainer's data and should be adjusted when you load different data:

- `DATA_NOTES` in `packages/backend/src/agent/tools.ts`: number of companies, the date range of the SEC data, known gaps, price adjustment. The model reads it with every tool description.
- `SYSTEM_INSTRUCTION` in `packages/backend/src/agent/agent.ts`: "six US companies", "SEC data ends around the end of 2020", the P/E rule.
- `EXAMPLES` in `packages/frontend/src/App.tsx`: example questions, some of which show gaps in the maintainer's data on purpose.
