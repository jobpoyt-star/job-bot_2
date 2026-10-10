# AI provider configuration

Gemini is the default primary provider. The existing enrichment prompt, response parser, and field-merging validation are used for both providers; a Gemini error or unusable response triggers a Groq attempt. If both providers fail, the existing `ai_queue` retry and failure handling remains in effect.

Set these environment variables locally or as GitHub Actions repository secrets:

- `GEMINI_API_KEY` (required for Gemini)
- `GROQ_API_KEY` (required for automatic Groq fallback)
- `GEMINI_MODEL` (optional; defaults to `gemini-2.5-flash-lite`)
- `GEMINI_TIMEOUT` (optional timeout in milliseconds; defaults to `60000`)

`AI_PRIMARY_PROVIDER` accepts `gemini`, `groq`, or `ollama` and takes precedence when set. The legacy `AI_PROVIDER` setting is still honored when `AI_PRIMARY_PROVIDER` is unset. Ollama remains available as a selectable provider.

Gemini calls are paced to one request per second per process, run with bounded transient-error retries, and use a temporary cooldown after repeated rate limits. A Gemini rate limit is not retried immediately; any `Retry-After` value is honored by the cooldown. No provider credentials should be committed to the repository.

The default model is listed as a Flash-Lite model in [Google's Gemini model documentation](https://ai.google.dev/gemini-api/docs/models).
