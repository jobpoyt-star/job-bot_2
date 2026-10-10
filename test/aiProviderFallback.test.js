const test = require('node:test');
const assert = require('node:assert/strict');

const { createJobEnricher } = require('../src/ai');
const { callGemini, resetGeminiRateLimitState } = require('../src/ai/geminiClient');
const { runAiWorker } = require('../src/workers/aiWorker');
const { GroqQuotaError } = require('../src/ai/groqClient');

const validResponse = JSON.stringify({
  title: 'Senior Software Engineer',
  description: 'We are seeking a skilled engineer to design reliable software, collaborate with product teams, improve service quality, and deliver thoughtful solutions that meet customer and business needs.',
  summary: 'Join a collaborative engineering team to build dependable software and improve products through thoughtful design, clear communication, and practical technical problem solving.',
  skills: ['JavaScript', 'Node.js', 'PostgreSQL', 'REST APIs', 'Git', 'Testing'],
  experience: '3-5 Years',
  employment_type: 'Full Time',
  salary: 'Competitive Salary',
  work_mode: 'Hybrid',
  responsibilities: ['Build software', 'Review code', 'Collaborate with teams', 'Improve services'],
  benefits: ['Flexible work', 'Learning support', 'Health coverage', 'Career development'],
});

const jobNeedingEnrichment = {
  id: 123,
  company_id: 7,
  company: 'Acme',
  title: 'Software Engineer',
  description: 'Quick job ad.',
  location: 'Remote',
  salary: null,
  experience: null,
  employment_type: null,
  work_mode: null,
  summary: null,
  skills: [],
  responsibilities: [],
  benefits: [],
  apply_url: 'https://example.test/jobs/123',
  source: 'Acme',
};

function quietLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function makeWorkerSupabase(rawJob = jobNeedingEnrichment) {
  const inserts = [];
  const queueUpdates = [];
  const queueItem = { id: 'queue-1', raw_job_id: rawJob.id, status: 'Pending', retry_count: 0 };

  function from(table) {
    const queryState = { operation: 'select', payload: null, filters: [], count: false };
    const query = {
      select(_columns, options = {}) {
        queryState.count = options.count === 'exact';
        return query;
      },
      eq(column, value) {
        queryState.filters.push([column, value]);
        return query;
      },
      neq(column, value) {
        queryState.filters.push([column, `not:${value}`]);
        return query;
      },
      lt(column, value) {
        queryState.filters.push([column, `lt:${value}`]);
        return query;
      },
      order() { return query; },
      limit() { return query; },
      update(payload) {
        queryState.operation = 'update';
        queryState.payload = payload;
        if (table === 'ai_queue') queueUpdates.push(payload);
        return query;
      },
      insert(payload) {
        queryState.operation = 'insert';
        queryState.payload = payload;
        if (table === 'processed_jobs') inserts.push(payload);
        return query;
      },
      single() {
        return Promise.resolve({ data: rawJob, error: null });
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve(resolveResult()).then(resolve, reject);
      },
    };

    function resolveResult() {
      if (queryState.operation === 'insert') {
        return { data: queryState.payload, error: null };
      }
      if (queryState.operation === 'update') {
        if (table === 'ai_queue' && queryState.payload?.status === 'Processing') {
          return { data: [{ id: queueItem.id, status: 'Processing' }], error: null };
        }
        return { data: [], error: null };
      }
      if (table === 'ai_queue' && queryState.filters.some(([column, value]) => column === 'status' && value === 'Processing')) {
        return { data: [], error: null };
      }
      if (table === 'ai_queue' && queryState.count) {
        return { count: 1, error: null };
      }
      if (table === 'ai_queue') return { data: [queueItem], error: null };
      return { data: [], error: null };
    }

    return query;
  }

  return {
    from,
    inserts,
    queueUpdates,
  };
}

test('Gemini succeeds without calling Groq', async () => {
  let groqCalls = 0;
  const enrich = createJobEnricher({
    provider: 'gemini',
    logger: quietLogger(),
    geminiClient: async () => validResponse,
    groqClient: async () => {
      groqCalls += 1;
      return validResponse;
    },
  });

  const result = await enrich(jobNeedingEnrichment);

  assert.equal(result.title, 'Senior Software Engineer');
  assert.equal(groqCalls, 0);
});

test('Gemini HTTP 429 falls back to Groq', async () => {
  const calls = [];
  const enrich = createJobEnricher({
    provider: 'gemini',
    logger: quietLogger(),
    geminiClient: async () => {
      calls.push('gemini');
      const error = new Error('rate limited');
      error.status = 429;
      throw error;
    },
    groqClient: async () => {
      calls.push('groq');
      return validResponse;
    },
  });

  await enrich(jobNeedingEnrichment);
  assert.deepEqual(calls, ['gemini', 'groq']);
});

test('Gemini timeout falls back to Groq', async () => {
  const calls = [];
  const enrich = createJobEnricher({
    provider: 'gemini',
    logger: quietLogger(),
    geminiClient: async () => {
      calls.push('gemini');
      const error = new Error('request timed out');
      error.isAiTimeout = true;
      throw error;
    },
    groqClient: async () => {
      calls.push('groq');
      return validResponse;
    },
  });

  await enrich(jobNeedingEnrichment);
  assert.deepEqual(calls, ['gemini', 'groq']);
});

test('malformed Gemini output is rejected by the parser and retried through Groq', async () => {
  let groqCalls = 0;
  const enrich = createJobEnricher({
    provider: 'gemini',
    logger: quietLogger(),
    geminiClient: async () => 'not valid JSON',
    groqClient: async () => {
      groqCalls += 1;
      return validResponse;
    },
  });

  const result = await enrich(jobNeedingEnrichment);
  assert.equal(groqCalls, 1);
  assert.equal(result.title, 'Senior Software Engineer');
});

test('missing Gemini key falls back safely to configured Groq', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  let groqCalls = 0;

  try {
    const enrich = createJobEnricher({
      provider: 'gemini',
      logger: quietLogger(),
      groqClient: async () => {
        groqCalls += 1;
        return validResponse;
      },
    });

    const result = await enrich(jobNeedingEnrichment);
    assert.equal(result.title, 'Senior Software Engineer');
    assert.equal(groqCalls, 1);
  } finally {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('Gemini retries transient timeouts only within its bounded retry policy', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  resetGeminiRateLimitState();
  let calls = 0;

  try {
    const text = await callGemini('prompt', {
      client: {
        models: {
          async generateContent() {
            calls += 1;
            if (calls === 1) {
              const error = new Error('request timeout');
              error.isAiTimeout = true;
              throw error;
            }
            return { text: 'valid response' };
          },
        },
      },
      requestIntervalMs: 0,
      sleep: async () => {},
      random: () => 0,
    });

    assert.equal(text, 'valid response');
    assert.equal(calls, 2);
  } finally {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    resetGeminiRateLimitState();
  }
});

test('Gemini honors Retry-After through a cooldown instead of retrying a 429', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  resetGeminiRateLimitState();
  let calls = 0;

  try {
    const client = {
      models: {
        async generateContent() {
          calls += 1;
          const error = new Error('rate limited');
          error.status = 429;
          error.headers = { 'retry-after': '60' };
          throw error;
        },
      },
    };

    await assert.rejects(callGemini('prompt', { client, requestIntervalMs: 0 }), /HTTP 429/);
    await assert.rejects(callGemini('prompt', { client, requestIntervalMs: 0 }), /HTTP 429/);
    assert.equal(calls, 1);
  } finally {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    resetGeminiRateLimitState();
  }
});

test('both provider failures preserve the worker queue retry behavior', async () => {
  const fakeSupabase = makeWorkerSupabase();
  const enrich = createJobEnricher({
    provider: 'gemini',
    logger: quietLogger(),
    geminiClient: async () => {
      throw new Error('Gemini unavailable');
    },
    groqClient: async () => {
      throw new Error('Groq unavailable');
    },
  });

  const result = await runAiWorker({
    batchSize: 1,
    enrichJob: enrich,
    logger: quietLogger(),
    supabase: fakeSupabase,
  });

  assert.equal(result.jobsFailed, 1);
  assert.equal(fakeSupabase.inserts.length, 0);
  assert.ok(fakeSupabase.queueUpdates.some((payload) => payload.status === 'Pending' && payload.retry_count === 1));
});

test('fallback saves only one processed enrichment for a job', async () => {
  const fakeSupabase = makeWorkerSupabase();
  const enrich = createJobEnricher({
    provider: 'gemini',
    logger: quietLogger(),
    geminiClient: async () => {
      const error = new Error('rate limited');
      error.status = 429;
      throw error;
    },
    groqClient: async () => validResponse,
  });

  const result = await runAiWorker({
    batchSize: 1,
    enrichJob: enrich,
    logger: quietLogger(),
    supabase: fakeSupabase,
  });

  assert.equal(result.jobsCompleted, 1);
  assert.equal(fakeSupabase.inserts.length, 1);
  assert.equal(fakeSupabase.inserts[0].ai_model, process.env.GROQ_MODEL || 'openai/gpt-oss-20b');
});

test('legacy Groq quota errors retain their queue failure classification', async () => {
  const quotaError = new GroqQuotaError('quota exhausted');
  const enrich = createJobEnricher({
    provider: 'gemini',
    logger: quietLogger(),
    geminiClient: async () => {
      throw new Error('Gemini unavailable');
    },
    groqClient: async () => {
      throw quotaError;
    },
  });

  await assert.rejects(enrich(jobNeedingEnrichment), (error) => error.isQuotaError === true);
});
