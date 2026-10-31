# AI provider configuration

AI enrichment runs through Groq only. Configure up to four Groq API keys locally or as GitHub Actions repository secrets:

- `GROQ_API_KEY`
- `GROQ_API_KEY_2`
- `GROQ_API_KEY_3`
- `GROQ_API_KEY_4`

Keys are tried in order for each request. A failed request or rate limit moves processing to the next configured key. Each key's daily quota is managed independently by Groq; the application does not track or reset provider quotas. The existing `ai_queue` retry and failure handling remains in effect if all configured keys fail.

`GROQ_MODEL` is optional and defaults to `openai/gpt-oss-20b`. No provider credentials should be committed to the repository.
