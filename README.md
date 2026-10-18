# LLM Agent

Financial Assistant agent: Gemini function calling over SEC facts and daily stock prices stored in BigQuery.

**Part of:** [AI/LLM POC sequence](https://github.com/pawel-janus/ai-llm-pocs) - POC #4

**Status:** ✅ Complete. Agent loop, `POST /api/agent` and a UI with a tool log work; deployed privately to Cloud Run (see [docs/deployment-plan.md](docs/deployment-plan.md)).

**Example interaction:**
- **Question:** "Compare Apple's and Walmart's net income in 2019."
- **What happens:** the model calls `getFacts` for both tickers (in parallel), reads the rows, and answers with the figures, their `period_end` dates and whether each is a full year.
- **Answer:** a short text that quotes only numbers returned by the tools; when a period is missing from the data, it says so instead of estimating.

## Features

- **Function calling** with Gemini 2.5 Flash via Vertex AI (`@google/genai`)
- **Multi-source data fusion:** SEC facts + stock prices
- **Agent loop:** the model chooses tools, may call several in a row or in parallel (max 6 rounds)
- **Fixed tool list over BigQuery:** the model never writes SQL; queries are parameterized and capped at 100 MB billed
- **Tool argument validation** (Zod) and errors returned to the model instead of thrown
- **Honest "no data" behaviour:** an empty result carries a note and the nearest available periods
- **Tool execution log** returned by the API and shown in the UI
- Derived metrics (price change) computed in code, not by the model

## How it works

1. `POST /api/agent` receives a question.
2. `runAgent` sends it to Gemini together with the tool declarations and a system instruction.
3. If the model answers with function calls, the backend validates the arguments, runs the BigQuery queries and sends the results back; this repeats until the model answers in text or the round limit is hit.
4. The response contains the answer, the list of tool calls (arguments, duration, result preview), rounds, token usage and latency.

### Tools

| Tool | Purpose |
|------|---------|
| `listCompanies` | Companies the data covers (ticker, name) |
| `getFacts` | SEC figures for one company by `metric` (revenue, net income, EPS, total assets, operating cash flow) or exact `tag`, with period filters |
| `listTags` | SEC tags available for a company |
| `getStockPrice` | Adjusted close on, or before, a date |
| `getPriceChange` | Percent change between two dates |

## Tech Stack

- **LLM:** Gemini 2.5 Flash (Vertex AI)
- **Data:** BigQuery (SEC facts, daily prices, company metadata)
- **Backend:** Fastify (TypeScript)
- **Frontend:** React + Vite (TypeScript)
- **Shared:** Zod schemas
- **Deploy:** Cloud Run (private)

## Architecture

Monorepo with npm workspaces:

```
llm-chat/
├── packages/
│   ├── shared/              # Zod schemas (request/response)
│   ├── backend/             # Fastify API + agent
│   │   ├── .env.example     # Environment template
│   │   └── src/
│   │       ├── server.ts    # Routes: /health, /api/agent, static frontend
│   │       ├── agent/       # agent.ts (loop, system instruction), tools.ts (declarations, validation, executor)
│   │       ├── data/        # BigQuery access: bigquery.ts, companies.ts, sec.ts, prices.ts, metrics.ts
│   │       └── llm/         # Gemini client
│   └── frontend/            # React + Vite UI
├── docs/
│   ├── data-schema.md       # Tables the agent reads
│   └── deployment-plan.md   # Private Cloud Run deployment
├── SETUP.md                 # Local credentials and environment
├── Dockerfile
└── package.json             # Workspace root
```

In production the backend serves both the API (`/api/*`) and the built frontend, as a single Cloud Run service.

## Prerequisites

- Node.js 20+ and npm
- Google Cloud SDK (`gcloud`)
- A GCP project with billing enabled, with Vertex AI and BigQuery enabled
- BigQuery tables with SEC facts, prices and company metadata: the repo does not include data, see [docs/data-schema.md](docs/data-schema.md) for the tables, columns and a minimal DDL

### GCP setup

```bash
gcloud services enable \
  aiplatform.googleapis.com \
  bigquery.googleapis.com \
  --account=YOUR_ACCOUNT@gmail.com \
  --project=YOUR_PROJECT_ID
```

For deployment also enable `run.googleapis.com`, `cloudbuild.googleapis.com` and `artifactregistry.googleapis.com`.

Your account needs `roles/bigquery.jobUser`, `roles/bigquery.dataViewer` on the datasets and `roles/aiplatform.user` on the project.

**Costs:** no fixed monthly minimums. Gemini is billed per token (roughly a cent or less per question, thinking tokens included) and BigQuery queries are capped at 100 MB billed each, well inside the monthly free tier. These are estimates; check current GCP pricing.

## Quick start

```bash
# 1. Authenticate locally (Application Default Credentials)
gcloud auth application-default login --account=YOUR_ACCOUNT@gmail.com

# 2. Install dependencies and build the shared package
npm install
npm run build:shared

# 3. Configure the backend
cp packages/backend/.env.example packages/backend/.env
# edit packages/backend/.env: GOOGLE_CLOUD_PROJECT, GEMINI_LOCATION, GEMINI_MODEL

# 4. Run (two terminals)
npm run dev:backend    # http://localhost:3001
npm run dev:frontend   # http://localhost:5173 (proxies /api to the backend)
```

More on credentials (including keeping a personal account apart from a corporate one) and troubleshooting: [SETUP.md](SETUP.md).

## Configuration

Set in `packages/backend/.env` locally and as environment variables on Cloud Run:

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLOUD_PROJECT` | yes | GCP project with the BigQuery datasets; also used for Vertex AI |
| `GEMINI_LOCATION` | yes | Vertex AI region for Gemini, for example `europe-central2` |
| `GEMINI_MODEL` | yes | Model name, for example `gemini-2.5-flash` (must exist in `GEMINI_LOCATION`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | no | Path to a credentials file instead of the default ADC |
| `PORT`, `HOST` | no | Server port and host (defaults `3001`, `0.0.0.0`) |

Dataset names and the BigQuery location are constants in `packages/backend/src/data/bigquery.ts` (see [docs/data-schema.md](docs/data-schema.md)).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:backend` | Backend in watch mode (`tsx`) |
| `npm run dev:frontend` | Vite dev server |
| `npm run build` | Build shared, backend and frontend |
| `npm run build:shared` / `build:backend` / `build:frontend` | Build one workspace |

After `npm run build`, `npm run start --workspace=packages/backend` runs the production server (API and built frontend on one port).

## API

### GET /health

Returns `{ "status": "ok", "timestamp": "..." }`.

### POST /api/agent

**Request** (`query`: 3-500 characters):

```json
{ "query": "Compare Apple's and Walmart's net income in 2019." }
```

**Response:**

```json
{
  "answer": "...",
  "tool_calls": [
    {
      "name": "getFacts",
      "args": { "ticker": "AAPL", "metric": "net_income" },
      "ok": true,
      "result_preview": "{\"ticker\":\"AAPL\",\"facts\":[...",
      "duration_ms": 312
    }
  ],
  "rounds": 2,
  "round_limit_hit": false,
  "model": "gemini-2.5-flash",
  "usage": { "prompt_tokens": 3120, "output_tokens": 140, "thinking_tokens": 520 },
  "latency_ms": 4400
}
```

An invalid request returns 400 with a message; a failure of the agent returns 500 with a generic message (details only in the server log). Try it:

```bash
curl -X POST http://localhost:3001/api/agent \
  -H "Content-Type: application/json" \
  -d '{"query":"Which companies do you have data for?"}'
```

### Example questions

Typical timings: 1.5-4.5 s for one or two tool rounds, up to about 7 s for three rounds.

- "Which companies do you have data for?"
- "Compare Apple's and Walmart's net income in 2019."
- "How did Tesla's price change in the 90 days after its latest filing in the data?"
- A question the data cannot answer (a missing year, a company outside the list, a P/E ratio): the agent should say what is missing and why instead of inventing numbers.

## Using your own data

The prompts and example questions describe the maintainer's dataset (six companies, SEC data to about 2020, prices to 2026). If you load different data, adjust `DATA_NOTES`, `SYSTEM_INSTRUCTION` and the example questions; the list is in [docs/data-schema.md](docs/data-schema.md#data-dependent-text-in-the-code).

## Deployment

Deployed privately to Cloud Run (no public access, IAM only) for testing and portfolio demonstration. To repeat it in your project: [docs/deployment-plan.md](docs/deployment-plan.md) (service account, least-privilege permissions, build, deploy, access through `gcloud run services proxy`, rollback).

**Note:** Demo URL available on request (not published for security reasons).

## Known limitations

- No authentication or rate limiting of its own: do not expose it publicly (the Cloud Run deployment is private for that reason).
- P/E and other ratios mixing SEC figures with prices are not offered: prices are adjusted for splits and dividends while EPS is as reported.
- Single question per request: no conversation memory (the next POC).
- Dataset names and the BigQuery location are fixed in code.

## License

MIT
