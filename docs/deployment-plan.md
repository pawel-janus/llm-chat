# Deployment plan (Cloud Run, private)

Status: **executed and verified** (19.10.2026) for service `llm-chat`: health check, a two-message session with a follow-up, and history surviving a new revision (Firestore). The commands are adapted from the deployment of POC #4 (`llm-agent`) and add Firestore for conversations.

The app is for private use: it has no authentication of its own and no rate limiting, and the price data has a private-use licence. It is therefore deployed **without public access** and reached through IAM.

Placeholders used below: `YOUR_PROJECT_ID`, `YOUR_REGION` (the region of the BigQuery datasets, also used for Cloud Run and Gemini), `YOUR_ACCOUNT@gmail.com`, `YOUR_REPOSITORY` (an existing Artifact Registry Docker repository).

## Steps

### 1. Service account

A dedicated account, not the default compute service account.

```bash
gcloud iam service-accounts create llm-chat-sa \
  --display-name="LLM chat runtime" \
  --account=YOUR_ACCOUNT@gmail.com --project=YOUR_PROJECT_ID
```

### 2. Permissions (least privilege)

| Where | Role | Why |
|-------|------|-----|
| project | `roles/bigquery.jobUser` | run queries |
| project | `roles/aiplatform.user` | call Gemini on Vertex AI |
| project | `roles/datastore.user` | read and write conversations in Firestore |
| datasets `sunny_sec`, `sunny_prices`, `sunny_meta` | `READER` | read only, no write |

```bash
SA=llm-chat-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${SA}" --role="roles/bigquery.jobUser" \
  --account=YOUR_ACCOUNT@gmail.com
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${SA}" --role="roles/aiplatform.user" \
  --account=YOUR_ACCOUNT@gmail.com
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${SA}" --role="roles/datastore.user" \
  --account=YOUR_ACCOUNT@gmail.com
```

`roles/datastore.user` is granted on the whole project. For a tighter scope add an IAM condition on the database (`resource.name` of the Firestore database ID from `config/firestore.ts`). The Firestore database itself must exist before the first request (creation command in the README, "GCP setup").

Dataset access: add the service account as `READER` to each dataset (for example with `bq show --format=prettyjson` to a file, adding an `access` entry `{"role": "READER", "userByEmail": "<SA>"}`, then `bq update --source`).

### 3. Build the image

```bash
gcloud builds submit \
  --account=YOUR_ACCOUNT@gmail.com --project=YOUR_PROJECT_ID \
  --tag YOUR_REGION-docker.pkg.dev/YOUR_PROJECT_ID/YOUR_REPOSITORY/llm-chat:latest
```

### 4. Deploy

```bash
gcloud run deploy llm-chat \
  --account=YOUR_ACCOUNT@gmail.com --project=YOUR_PROJECT_ID \
  --image=YOUR_REGION-docker.pkg.dev/YOUR_PROJECT_ID/YOUR_REPOSITORY/llm-chat:latest \
  --region=YOUR_REGION \
  --service-account=llm-chat-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --no-allow-unauthenticated \
  --port=3001 \
  --memory=1Gi --cpu=1 \
  --min-instances=0 --max-instances=2 \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GEMINI_MODEL=gemini-2.5-flash,GEMINI_LOCATION=YOUR_REGION"
```

`--no-allow-unauthenticated` is deliberate: access goes through IAM (the caller needs `roles/run.invoker`).

### 5. Access

A local authenticated tunnel, no public URL:

```bash
gcloud run services proxy llm-chat \
  --region=YOUR_REGION \
  --account=YOUR_ACCOUNT@gmail.com --project=YOUR_PROJECT_ID
# then open http://localhost:8080
```

The service has a `run.app` address, but it requires an IAM identity token, so anonymous requests are rejected with 403 before they reach the app. The address (`gcloud run services describe llm-chat --format='value(status.url)'`) is still not published anywhere.

### 6. Verify

- `GET /health` through the proxy returns `{"status":"ok", ...}`.
- Two messages in one session through the UI or `POST /api/chat` (for example "Apple revenue in fiscal 2019", then "and Walmart's?"); the second answer must use the first as context, and the tool log shows BigQuery calls.
- `GET /api/sessions` lists the session, and the same `sessionId` still works after the instance restarts (a scale-to-zero check that the history is in Firestore, not in memory).
- Check the Cloud Run logs for permission errors (`bigquery.jobs.create`, `aiplatform.endpoints.predict`, `datastore.*`).

## Costs

No fixed monthly minimums; everything scales to zero.

| Item | Kind | Estimate |
|------|------|----------|
| Cloud Run (`min-instances=0`) | per request | within the free tier at private use; $0 idle |
| Cloud Build | per build minute | about 3-5 minutes per build, within the free daily minutes |
| Artifact Registry | storage | image of about 200 MB, a few cents per month |
| Gemini 2.5 Flash | per question | roughly 0.3-0.5 cent per question (measured 1-4k input tokens plus thinking tokens) |
| BigQuery | per query | inside the 1 TiB monthly free tier; every query capped at 100 MB billed |
| Firestore | per read/write, storage | a few operations per message; within the free quota at private use (the database must have the free tier available) |
| Service account, IAM | | $0 |

The figures are estimates and were not re-checked against current GCP price lists.

## Rollback and cleanup

```bash
gcloud run services delete llm-chat --region=YOUR_REGION --account=YOUR_ACCOUNT@gmail.com --project=YOUR_PROJECT_ID
gcloud artifacts docker images delete YOUR_REGION-docker.pkg.dev/YOUR_PROJECT_ID/YOUR_REPOSITORY/llm-chat --delete-tags --account=YOUR_ACCOUNT@gmail.com --project=YOUR_PROJECT_ID
gcloud iam service-accounts delete llm-chat-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com --account=YOUR_ACCOUNT@gmail.com --project=YOUR_PROJECT_ID
```

Remove the dataset `READER` entries and the project-level `roles/datastore.user` binding of the service account as well. Conversations stay in Firestore after the service is deleted; delete them with `DELETE /api/sessions/:id` before that, or remove the collection `llm-chat-sessions` in the console.
