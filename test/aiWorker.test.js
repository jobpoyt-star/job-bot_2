const test = require('node:test');
const assert = require('node:assert/strict');
const { mapRawJobToProcessedJob } = require('../src/workers/aiWorker');

function expectedAiModel() {
  const provider = (process.env.AI_PRIMARY_PROVIDER || process.env.AI_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'groq') return process.env.GROQ_MODEL || 'unknown';
  if (provider === 'ollama') return process.env.OLLAMA_MODEL || 'unknown';
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
}

test('mapRawJobToProcessedJob maps raw job fields into processed job payload', () => {
  const payload = mapRawJobToProcessedJob({
    id: 42,
    company_id: 7,
    title: 'Engineer',
    location: 'Pune, India',
    experience: '3+ years',
    employment_type: 'Full-time',
    work_mode: 'Hybrid',
    salary: '$120k',
    description: 'Build things',
    summary: 'Great role',
    skills: ['Node.js', 'Postgres'],
    apply_url: 'https://example.com/apply',
    source: 'ATS',
    posted_date: '2024-01-01',
    expiry_date: '2024-02-01',
    status: 'active',
    is_active: true,
  });

  assert.equal(payload.raw_job_id, 42);
  assert.equal(payload.company_id, 7);
  assert.equal(payload.title, 'Engineer');
  assert.equal(payload.location, 'Pune, India');
  assert.equal(payload.ai_processed, true);
  assert.equal(payload.ai_model, expectedAiModel());
  assert.equal(payload.status, 'active');
  assert.equal(payload.is_active, true);
});

test('mapRawJobToProcessedJob refuses legacy jobs without verified India eligibility', () => {
  const payload = mapRawJobToProcessedJob({
    id: 43,
    title: 'Engineer',
    location: 'Remote',
    work_mode: 'Remote',
    description: 'Remote work from India.',
  });

  assert.equal(payload, null);
});
