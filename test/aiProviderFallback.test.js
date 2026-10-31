const test = require('node:test');
const assert = require('node:assert/strict');

const { createJobEnricher, selectAIProvider } = require('../src/ai');
const { runAiWorker } = require('../src/workers/aiWorker');
const { GroqQuotaError, callGroq, isQuotaError } = require('../src/ai/groqClient');

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
  location: 'Bengaluru, India',
  salary: null,
  experience: null,
  employment_type: null,
  work_mode: 'Hybrid',
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

test('Groq treats HTTP 429 as a deferred quota/rate-limit error, not arbitrary HTTP 400', () => {
  assert.equal(isQuotaError({ status: 429, message: 'Request failed' }), true);
  assert.equal(isQuotaError({ status: 400, message: 'Invalid request body' }), false);
  assert.equal(isQuotaError({ status: 404, message: 'Not found' }), false);
});

test('Groq rotates through configured API keys after quota and rate-limit failures', async () => {
  const attemptedKeys = [];
  const keys = ['primary', 'secondary-2', 'secondary-3', 'secondary-4'];
  const response = await callGroq('prompt', {
    apiKeys: keys,
    createClient: ({ apiKey }) => {
      attemptedKeys.push(apiKey);
      return {
        chat: {
          completions: {
            async create() {
              if (apiKey !== 'secondary-4') {
                const error = new Error('rate limited');
                error.status = 429;
                throw error;
              }
              return { choices: [{ message: { content: 'valid response' } }] };
            },
          },
        },
      };
    },
  });

  assert.equal(response, 'valid response');
  assert.deepEqual(attemptedKeys, keys);
});

test('Groq loads primary and numbered backup keys from environment configuration', async () => {
  const names = ['GROQ_API_KEY', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3', 'GROQ_API_KEY_4'];
  const originalValues = names.map((name) => process.env[name]);
  const expectedKeys = ['test-primary', 'test-secondary-2', 'test-secondary-3', 'test-secondary-4'];
  const attemptedKeys = [];
  names.forEach((name, index) => {
    process.env[name] = expectedKeys[index];
  });

  try {
    const response = await callGroq('prompt', {
      createClient: ({ apiKey }) => ({
        chat: {
          completions: {
            async create() {
              attemptedKeys.push(apiKey);
              if (apiKey !== expectedKeys[3]) {
                const error = new Error('rate limited');
                error.status = 429;
                throw error;
              }
              return { choices: [{ message: { content: 'valid response' } }] };
            },
          },
        },
      }),
    });
    assert.equal(response, 'valid response');
    assert.deepEqual(attemptedKeys, expectedKeys);
  } finally {
    names.forEach((name, index) => {
      if (originalValues[index] === undefined) delete process.env[name];
      else process.env[name] = originalValues[index];
    });
  }
});

test('Groq keeps its bounded same-key retry before moving on to another key', async () => {
  const attemptedKeys = [];
  const response = await callGroq('prompt', {
    apiKeys: ['primary', 'secondary'],
    createClient: ({ apiKey }) => ({
      chat: {
        completions: {
          async create() {
            attemptedKeys.push(apiKey);
            if (apiKey === 'primary') {
              const error = new Error('temporary connection reset');
              error.code = 'ECONNRESET';
              throw error;
            }
            return { choices: [{ message: { content: 'valid response' } }] };
          },
        },
      },
    }),
  });

  assert.equal(response, 'valid response');
  assert.deepEqual(attemptedKeys, ['primary', 'primary', 'secondary']);
});

test('Groq reports quota exhaustion only after all configured keys are rate limited', async () => {
  const attemptedKeys = [];
  await assert.rejects(
    callGroq('prompt', {
      apiKeys: ['primary', 'secondary'],
      createClient: ({ apiKey }) => ({
        chat: {
          completions: {
            async create() {
              attemptedKeys.push(apiKey);
              const error = new Error('rate limited');
              error.status = 429;
              throw error;
            },
          },
        },
      }),
    }),
    (error) => error instanceof GroqQuotaError && error.isQuotaError === true
  );
  assert.deepEqual(attemptedKeys, ['primary', 'secondary']);
});

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

test('AI enrichment always uses Groq, even when Gemini is explicitly requested', async () => {
  const originalProvider = process.env.AI_PRIMARY_PROVIDER;
  process.env.AI_PRIMARY_PROVIDER = 'gemini';
  let geminiCalls = 0;
  let groqCalls = 0;

  try {
    assert.equal(selectAIProvider(), 'groq');
    const enrich = createJobEnricher({
      provider: 'gemini',
      logger: quietLogger(),
      geminiClient: async () => {
        geminiCalls += 1;
        return validResponse;
      },
      groqClient: async () => {
        groqCalls += 1;
        return validResponse;
      },
    });

    const result = await enrich(jobNeedingEnrichment);

    assert.equal(result.title, 'Senior Software Engineer');
    assert.equal(groqCalls, 1);
    assert.equal(geminiCalls, 0);
  } finally {
    if (originalProvider === undefined) delete process.env.AI_PRIMARY_PROVIDER;
    else process.env.AI_PRIMARY_PROVIDER = originalProvider;
  }
});

test('Groq failures preserve the worker queue retry behavior', async () => {
  const fakeSupabase = makeWorkerSupabase();
  const enrich = createJobEnricher({
    provider: 'groq',
    logger: quietLogger(),
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

test('provider quota failures remain Pending with backoff instead of being abandoned', async () => {
  const fakeSupabase = makeWorkerSupabase();
  const enrich = createJobEnricher({
    provider: 'groq',
    logger: quietLogger(),
    groqClient: async () => {
      throw new GroqQuotaError('quota exhausted');
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
  assert.ok(fakeSupabase.queueUpdates.some((payload) => (
    payload.status === 'Pending' && payload.retry_count === 1
  )));
  assert.equal(fakeSupabase.queueUpdates.some((payload) => payload.status === 'Failed'), false);
});

test('Groq saves one processed enrichment for a job', async () => {
  const fakeSupabase = makeWorkerSupabase();
  const enrich = createJobEnricher({
    provider: 'groq',
    logger: quietLogger(),
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

test('AI worker quarantines legacy foreign jobs before calling any provider', async () => {
  const fakeSupabase = makeWorkerSupabase({
    ...jobNeedingEnrichment,
    location: 'Austin, United States',
    work_mode: 'Onsite',
  });
  let providerCalls = 0;
  const enrich = createJobEnricher({
    provider: 'groq',
    logger: quietLogger(),
    groqClient: async () => {
      providerCalls += 1;
      return validResponse;
    },
  });

  const result = await runAiWorker({
    batchSize: 1,
    enrichJob: enrich,
    logger: quietLogger(),
    supabase: fakeSupabase,
  });

  assert.equal(result.jobsQuarantined, 1);
  assert.equal(providerCalls, 0);
  assert.equal(fakeSupabase.inserts.length, 0);
  assert.ok(fakeSupabase.queueUpdates.some((payload) => (
    payload.status === 'Failed' && payload.last_error.startsWith('india_eligibility:outside_india:')
  )));
});

test('AI worker debug reprocessing refuses jobs outside India before enrichment', async () => {
  let providerCalls = 0;
  const supabase = {
    from(table) {
      assert.equal(table, 'raw_jobs');
      const query = {
        select() { return query; },
        eq() { return query; },
        single() {
          return Promise.resolve({
            data: {
              id: 'legacy-foreign',
              title: 'Engineer',
              location: 'London, UK',
              work_mode: 'Onsite',
            },
            error: null,
          });
        },
      };
      return query;
    },
  };

  await assert.rejects(
    runAiWorker({
      debug: true,
      rawJobId: 'legacy-foreign',
      logger: quietLogger(),
      supabase,
      enrichJob: async () => {
        providerCalls += 1;
        return {};
      },
    }),
    /AI debug mode blocked by India eligibility: outside_india/
  );
  assert.equal(providerCalls, 0);
});

test('legacy Groq quota errors retain their queue failure classification', async () => {
  const quotaError = new GroqQuotaError('quota exhausted');
  const enrich = createJobEnricher({
    provider: 'groq',
    logger: quietLogger(),
    groqClient: async () => {
      throw quotaError;
    },
  });

  await assert.rejects(enrich(jobNeedingEnrichment), (error) => error.isQuotaError === true);
});
