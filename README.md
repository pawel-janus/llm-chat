# LLM Chat

Financial Assistant with conversation memory: a Gemini function-calling agent over SEC facts and daily stock prices in BigQuery, with chat sessions stored in Firestore, so follow-ups like "and Walmart's?" work.

**Part of:** [AI/LLM POC sequence](https://github.com/pawel-janus/ai-llm-pocs) - POC #5

**Status:** 🔄 In progress. Chat backend (`POST /api/chat`, sessions API) and UI work locally; private Cloud Run deployment is not done yet (plan: [docs/deployment-plan.md](docs/deployment-plan.md)).

**Example interaction:**
- **Turn 1:** "What was Apple's revenue in fiscal 2019?" - the model calls `getFacts` and answers with the figure and its period.
- **Turn 2:** "And Walmart's?" - the model resolves "and" to the same metric and year from the history and calls `getFacts` for Walmart.
- **Turn 3:** "Compare them." - answered from the history, without new tool calls.

## Features

- **Multi-turn conversations:** the whole history of a session is sent to Gemini with every question; the model resolves references ("it", "the other one", "the same year") itself
- **Session storage in Firestore:** durable sessions, no state in the backend (Cloud Run may scale to zero or run several instances)
- **Session management:** list, open, delete, "new conversation"; a new session has no memory of others
- **Long-conversation alert:** from 20 stored messages the API sets `long_history` and the UI suggests starting a new conversation (no trimming or summarizing yet, see [Known limitations](#known-limitations))
- **Function calling** with Gemini 2.5 Flash via Vertex AI (`@google/genai`), agent loop of max 6 rounds, parallel tool calls
- **Fixed tool list over BigQuery:** the model never writes SQL; queries are parameterized and capped at 100 MB billed
- **Tool argument validation** (Zod) and errors returned to the model instead of thrown
- **Honest "no data" behaviour:** an empty result carries a note and the nearest available periods
- **Tool execution log** stored with each answer and shown in the UI

## How it works

1. `POST /api/chat` receives a message and, for an existing conversation, a `sessionId`.
2. The backend loads the text turns of the session from Firestore (none for a new session).
3. `runAgent` sends the history plus the new message to Gemini with the tool declarations and a system instruction. If the model answers with function calls, the backend validates the arguments, runs the BigQuery queries and sends the results back, until the model answers in text or the round limit is hit.
4. The user message and the answer (with the tool log and token usage) are saved to Firestore in one batch.
5. The response carries the answer, `sessionId`, message count, the `long_history` flag, rounds, model and latency.

Only the text of the turns is stored in the history; when the model needs a number it no longer sees, it calls the tool again. The history is handled by code around `runAgent`, not by the tools.

### Firestore data model

- Database `llm-pocs`, collection `llm-chat-sessions`, one document per conversation: `title`, `created_at`, `updated_at`, `message_count`.
- Subcollection `messages`: `role` (`user` / `model`), `text`, `seq`, `created_at`; model messages also hold `tool_calls` and `usage`.

The database ID and collection names are constants in `packages/backend/src/config/firestore.ts`.

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
- **Conversations:** Firestore (`@google-cloud/firestore`)
- **Backend:** Fastify (TypeScript)
- **Frontend:** React + Vite (TypeScript)
- **Shared:** Zod schemas
- **Deploy:** Cloud Run (private)

## Architecture

Monorepo with npm workspaces:

```
llm-chat/
├── packages/
│   ├── shared/              # Zod schemas (agent and chat request/response)
│   ├── backend/             # Fastify API + agent
│   │   ├── .env.example     # Environment template
│   │   └── src/
│   │       ├── server.ts    # Routes: /health, /api/chat, /api/sessions, /api/agent, static frontend
│   │       ├── config/      # Constants: bigquery.ts (location, datasets, cost cap), firestore.ts (database, collections)
│   │       ├── agent/       # agent.ts (loop, system instruction), tools.ts (declarations, validation, executor)
│   │       ├── data/        # BigQuery access: bigquery.ts, companies.ts, sec.ts, prices.ts, metrics.ts
│   │       ├── db/          # sessions.ts: conversation storage in Firestore
│   │       └── llm/         # Gemini client
│   └── frontend/            # React + Vite chat UI (session list, history, tool log)
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
- A GCP project with billing enabled, with Vertex AI, BigQuery and Firestore enabled
- BigQuery tables with SEC facts, prices and company metadata: the repo does not include data, see [docs/data-schema.md](docs/data-schema.md) for the tables, columns and a minimal DDL
- A Firestore database in Native mode (see below)

### GCP setup

```bash
gcloud services enable \
  aiplatform.googleapis.com \
  bigquery.googleapis.com \
  firestore.googleapis.com \
  --account=YOUR_ACCOUNT@gmail.com \
  --project=YOUR_PROJECT_ID

# The database ID must match DATABASE_ID in packages/backend/src/config/firestore.ts
gcloud firestore databases create \
  --database=llm-pocs \
  --location=YOUR_REGION \
  --account=YOUR_ACCOUNT@gmail.com \
  --project=YOUR_PROJECT_ID
```

If you already have a database, change `DATABASE_ID` instead of creating one. For deployment also enable `run.googleapis.com`, `cloudbuild.googleapis.com` and `artifactregistry.googleapis.com`.

Your account needs `roles/bigquery.jobUser`, `roles/bigquery.dataViewer` on the datasets, `roles/aiplatform.user` and `roles/datastore.user` on the project.

**Costs:** no fixed monthly minimums. Gemini is billed per token (roughly a cent or less per question, thinking tokens included; a long history adds input tokens to every turn), BigQuery queries are capped at 100 MB billed each, well inside the monthly free tier, and Firestore at this scale (a few reads and writes per message) stays within its free quota. These are estimates; check current GCP pricing.

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
| `GOOGLE_CLOUD_PROJECT` | yes | GCP project with the BigQuery datasets and the Firestore database; also used for Vertex AI |
| `GEMINI_LOCATION` | yes | Vertex AI region for Gemini, for example `europe-central2` |
| `GEMINI_MODEL` | yes | Model name, for example `gemini-2.5-flash` (must exist in `GEMINI_LOCATION`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | no | Path to a credentials file instead of the default ADC |
| `PORT`, `HOST` | no | Server port and host (defaults `3001`, `0.0.0.0`) |

Values that describe the data rather than the environment are constants in `packages/backend/src/config/`: BigQuery location, dataset names and the per-query cost cap (`bigquery.ts`), Firestore database ID and collection names (`firestore.ts`). The long-conversation threshold (`LONG_HISTORY_MESSAGES`) is in `server.ts`.

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

### POST /api/chat

**Request** (`message`: 3-500 characters; omit `sessionId` to start a new conversation):

```json
{ "sessionId": "abc123", "message": "And Walmart's?" }
```

**Response:**

```json
{
  "sessionId": "abc123",
  "message": {
    "role": "model",
    "text": "...",
    "created_at": "2026-10-19T10:00:00.000Z",
    "tool_calls": [
      {
        "name": "getFacts",
        "args": { "ticker": "WMT", "metric": "revenue" },
        "ok": true,
        "result_preview": "{\"ticker\":\"WMT\",\"facts\":[...",
        "duration_ms": 312
      }
    ],
    "usage": { "prompt_tokens": 3120, "output_tokens": 140, "thinking_tokens": 520 }
  },
  "message_count": 4,
  "long_history": false,
  "rounds": 2,
  "round_limit_hit": false,
  "model": "gemini-2.5-flash",
  "latency_ms": 3100
}
```

An invalid request returns 400, an unknown `sessionId` returns 404, a failure returns 500 with a generic message (details only in the server log). Try it:

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Which companies do you have data for?"}'
```

### Sessions

| Endpoint | Description |
|----------|-------------|
| `GET /api/sessions` | The 50 most recently updated sessions (`id`, `title`, dates, `message_count`) |
| `GET /api/sessions/:id` | One session with all its messages |
| `DELETE /api/sessions/:id` | Delete a session with its messages (204) |

### POST /api/agent

The stateless single-question endpoint inherited from POC #4 (`{ "query": "..." }`); it returns the answer, tool calls, rounds, token usage and latency without storing anything.

### Example questions

Typical timings: 1.5-4.5 s for one or two tool rounds, up to about 7 s for three rounds.

- "What was Apple's revenue in fiscal 2019?" then "And Walmart's?" then "Compare them."
- "How did Tesla's price change in the 90 days after its latest filing in the data?"
- A question the data cannot answer (a missing year, a company outside the list, a P/E ratio): the agent should say what is missing and why instead of inventing numbers.

## Using your own data

The prompts and example questions describe the maintainer's dataset (six companies, SEC data to about 2020, prices to 2026). If you load different data, adjust `DATA_NOTES`, `SYSTEM_INSTRUCTION` and the example questions; the list is in [docs/data-schema.md](docs/data-schema.md#data-dependent-text-in-the-code).

## Deployment

Planned: private Cloud Run (no public access, IAM only) for testing and portfolio demonstration. Steps for your project: [docs/deployment-plan.md](docs/deployment-plan.md) (service account, least-privilege permissions, build, deploy, access through `gcloud run services proxy`, rollback).

**Note:** Demo URL available on request (not published for security reasons).

## Known limitations

- No authentication or rate limiting of its own: do not expose it publicly. All sessions are visible to whoever can reach the app (single user).
- The whole history is sent with every question: a long conversation costs more per turn and answers may get worse. The app only warns; trimming, summarizing and question rewriting are not implemented.
- Only the text of turns is stored, not the tool results, so a follow-up that needs a number again triggers a new tool call.
- Two messages sent at once in the same session can interleave.
- Follow-ups after a topic change can lose the reference, and "fiscal year" labels differ between companies (Apple's FY2019 ends in September, Walmart's in January); the agent does not align them.
- P/E and other ratios mixing SEC figures with prices are not offered: prices are adjusted for splits and dividends while EPS is as reported.

## License

MIT
