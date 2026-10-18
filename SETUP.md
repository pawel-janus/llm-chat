# Local Development Setup

This guide explains how to set up local development environment to connect to GCP services.

## Prerequisites

- Node.js 20+
- Google Cloud SDK (`gcloud` CLI)
- GCP project with the APIs enabled (see [README.md](README.md#gcp-setup)) and the BigQuery tables ([docs/data-schema.md](docs/data-schema.md))

## Step 1: Check if ADC is already configured

```bash
# Try to print access token
gcloud auth application-default print-access-token

# If this works (prints token) → you're already authenticated ✅
# If error → proceed to Step 2
```

## Step 2: Configure Application Default Credentials (ADC)

**Only if Step 1 failed:**

```bash
gcloud auth application-default login --account=YOUR_ACCOUNT@gmail.com
```

This will:
1. Open browser for Google login
2. Save credentials to `~/.config/gcloud/application_default_credentials.json`
3. All GCP SDKs (BigQuery, Vertex AI) will use these credentials automatically

**Verify it works:**

```bash
gcloud auth application-default print-access-token
# Should print: ya29.xxx... (access token)
```

### Corporate vs Personal Account Isolation (Advanced)

If you have **two Google accounts** (corporate + personal) and want to keep them separate:

**Problem:**
- System-wide ADC might use corporate account (e.g., for Claude CLI sessions)
- Project should use personal GCP account (for billing, resources)

**Solution:** Use separate credentials file via `GOOGLE_APPLICATION_CREDENTIALS`:

```bash
# 1. Login with personal account and save to separate file
gcloud auth application-default login --account=YOUR_PERSONAL@gmail.com

# 2. Copy credentials to project directory
cp ~/.config/gcloud/application_default_credentials.json ./adc-private.json

# 3. Set environment variable to use this file (in packages/backend/.env)
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-project/adc-private.json

# 4. Add to .gitignore (already done)
echo "adc-private.json" >> .gitignore
```

**Result:**
- System-wide ADC: corporate account (untouched)
- This project: personal account (via GOOGLE_APPLICATION_CREDENTIALS)
- No conflicts, full isolation

**Verify which account is used:**

```bash
# System-wide ADC
gcloud auth application-default print-access-token | head -c 50

# Project-specific (with GOOGLE_APPLICATION_CREDENTIALS set)
cd packages/backend
npx tsx -e "
import { BigQuery } from '@google-cloud/bigquery';
const bq = new BigQuery();
console.log('Project:', process.env.GOOGLE_CLOUD_PROJECT);
"
```

## Step 3: Configure environment variables

Create `packages/backend/.env` from the template and fill it in:

```bash
cp packages/backend/.env.example packages/backend/.env
```

```bash
# GCP Project
GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID

# ADC credentials (if using a separate file - optional)
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-project/adc-private.json

# Gemini configuration (Vertex AI)
GEMINI_MODEL=gemini-2.5-flash
GEMINI_LOCATION=europe-central2   # the region of your BigQuery datasets
```

**Required env vars:**
- `GOOGLE_CLOUD_PROJECT` - GCP project ID
- `GEMINI_MODEL` - Gemini model name (e.g., `gemini-2.5-flash`)
- `GEMINI_LOCATION` - Vertex AI region for Gemini (e.g., `europe-central2`)

**Note:** Gemini model availability varies by region; check that your model is available in `GEMINI_LOCATION`. `gemini-2.5-flash` was verified in `europe-central2`.

## Step 4: Install dependencies

```bash
npm install
```

## Step 5: Build shared package

```bash
npm run build:shared
```

## Step 6: Start development servers

```bash
# Terminal 1 - Backend
npm run dev:backend
# Runs on http://localhost:3001

# Terminal 2 - Frontend
npm run dev:frontend
# Runs on http://localhost:5173
```

## Verify GCP connection

Test BigQuery access:

```bash
cd packages/backend
npx tsx -e "
import 'dotenv/config';
import { BigQuery } from '@google-cloud/bigquery';
const bq = new BigQuery({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const [datasets] = await bq.getDatasets();
console.log('✅ BigQuery connected! Datasets:', datasets.length);
"
```

Expected output: `✅ BigQuery connected! Datasets: X`

## Troubleshooting

### Error: "Could not load the default credentials"

**Solution:** Run Step 2 (ADC login)

### Error: "Permission denied"

**Check:**
1. Your GCP account has required IAM roles:
   - `roles/bigquery.user`
   - `roles/bigquery.dataViewer`
   - `roles/aiplatform.user`

2. APIs are enabled (see [README.md](README.md#gcp-setup))

### Error: "quota exceeded"

**BigQuery:** Free tier = 1 TB queries/month  
**Vertex AI:** Free tier varies by model

Check quota: https://console.cloud.google.com/iam-admin/quotas

## What's different in Cloud Run?

**Local development:**
- Uses **your personal credentials** (ADC)
- Access controlled by your GCP account permissions

**Cloud Run production:**
- Uses a dedicated **Service Account**
- Access controlled by Service Account IAM roles
- No ADC needed (automatic)

**Same code works in both!** GCP SDK auto-detects environment.

## Next Steps

After setup is complete:
1. Test backend: `curl http://localhost:3001/health`
2. Test frontend: Open `http://localhost:5173` and run an example question
3. Ask a question from the command line, see "API" in [README.md](README.md#api)
