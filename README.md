# JOBPOYT job-bot

Node.js job ingestion, validation, Supabase persistence, AI enrichment, and publication pipeline.

## Setup

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env` and configure the required Supabase and AI-provider values.
3. Start continuous local scraping with `npm start`. It runs all configured scrapers, waits one hour after each completed cycle, then starts the next cycle. Use Ctrl+C to stop it.
4. Run tests with `npm test`.

## Current behavior

- New raw jobs pass the centralized India eligibility check before persistence.
- Remote jobs are retained only when India eligibility is explicit; unknown locations are skipped with a reason.
- The publisher repeats the India eligibility check for previously stored or reprocessed jobs and quarantines ineligible rows using existing processed-job fields.
- AI enrichment uses Groq only. It tries `GROQ_API_KEY` through `GROQ_API_KEY_4` in order and moves to the next configured key after a request failure or rate limit; the existing AI queue and Supabase persistence contract are retained.
- Each pipeline cycle processes pending AI queue entries regardless of when their raw jobs were scraped, in batches until the queue is idle or the provider reports failures, then retries publication for eligible processed jobs.
- Company-specific scraping targets and integration status are documented in [docs/INDIA-TARGETS.md](./docs/INDIA-TARGETS.md).
- The pipeline idempotently ensures company rows for active, verified scrapers before each scrape cycle. Run `npm run seed:companies` to register them explicitly; inactive or unverified career targets are not seeded.

## GitHub Actions

The JOBPOYT Job Scraper workflow has no scheduled runs. Scraping starts locally when you run `npm start`; the workflow can still be started manually with `workflow_dispatch`. The local loop interval defaults to one hour and can be overridden with `PIPELINE_LOOP_MS` or `SCRAPE_INTERVAL_MS`. Configure these repository secrets only if you use that manual workflow:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY`
- `GROQ_API_KEY_2`
- `GROQ_API_KEY_3`
- `GROQ_API_KEY_4`

Never commit `.env` or API keys.
