'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function clearRepositoryModules() {
  for (const modulePath of [
    '../src/database/jobRepository',
    '../src/database/supabaseClient',
  ]) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withRepository(options, callback) {
  clearRepositoryModules();
  const supabaseClientPath = require.resolve('../src/database/supabaseClient');
  const calls = { upserts: [], queueInserts: [] };
  const supabaseStub = {
    from(table) {
      if (table === 'raw_jobs') {
        return {
          select() {
            return {
              in: async () => ({
                data: options.existingRawJobs || [],
                error: options.lookupError || null,
              }),
            };
          },
          upsert(payload, config) {
            calls.upserts.push({ payload, config });
            return {
              select: async () => options.insertError
                ? { data: null, error: options.insertError }
                : {
                  data: payload.map((job, index) => ({
                    id: `raw-${index + 1}`,
                    apply_url: job.apply_url,
                  })),
                  error: null,
                },
            };
          },
        };
      }
      if (table === 'ai_queue') {
        return {
          select() {
            return {
              in: async () => ({ data: options.existingQueueRows || [], error: null }),
            };
          },
          insert: async (payload) => {
            calls.queueInserts.push(payload);
            return { error: options.queueError || null };
          },
        };
      }
      assert.fail(`Unexpected Supabase table access: ${table}`);
    },
  };

  require.cache[supabaseClientPath] = {
    id: supabaseClientPath,
    filename: supabaseClientPath,
    loaded: true,
    exports: supabaseStub,
  };

  try {
    const repository = require('../src/database/jobRepository');
    await callback(repository, calls);
  } finally {
    clearRepositoryModules();
  }
}

function job(overrides = {}) {
  return {
    company_id: 'company-1',
    title: 'Software Engineer',
    location: 'Bengaluru, India',
    apply_url: 'https://jobs.example/apply/1',
    ...overrides,
  };
}

test('persists Unix second and millisecond posting dates as ISO before database insert', async () => {
  await withRepository({}, async ({ saveJobs }, calls) => {
    const timestamp = Date.now() - 60_000;
    const timestampSeconds = Math.floor(timestamp / 1000);
    const inputJobs = [
      job({ apply_url: 'https://jobs.example/apply/ms-number', posted_date: timestamp }),
      job({ apply_url: 'https://jobs.example/apply/ms-string', posted_date: String(timestamp) }),
      job({ apply_url: 'https://jobs.example/apply/seconds-number', posted_date: timestampSeconds }),
      job({ apply_url: 'https://jobs.example/apply/seconds-string', posted_date: String(timestampSeconds) }),
    ];
    const previousLookbackDays = process.env.JOB_LOOKBACK_DAYS;
    process.env.JOB_LOOKBACK_DAYS = '30';
    let result;
    try {
      result = await saveJobs(inputJobs);
    } finally {
      if (previousLookbackDays === undefined) delete process.env.JOB_LOOKBACK_DAYS;
      else process.env.JOB_LOOKBACK_DAYS = previousLookbackDays;
    }

    assert.equal(result.error, null);
    assert.equal(calls.upserts.length, 1);
    assert.deepEqual(
      calls.upserts[0].payload.map((payload) => payload.posted_date),
      [
        new Date(timestamp).toISOString(),
        new Date(timestamp).toISOString(),
        new Date(timestampSeconds * 1000).toISOString(),
        new Date(timestampSeconds * 1000).toISOString(),
      ]
    );
    assert.deepEqual(result.stats.newRawJobIds, ['raw-1', 'raw-2', 'raw-3', 'raw-4']);
    assert.equal(result.stats.inserted, 4);
    assert.equal(result.stats.aiQueueInserted, 4);
    assert.equal(calls.queueInserts[0].length, 4);
    assert.equal(calls.queueInserts[0][0].raw_job_id, 'raw-1');
    assert.equal(calls.queueInserts[0][0].status, 'Pending');
    assert.equal(calls.queueInserts[0][0].retry_count, 0);
  });
});

test('retains invalid and missing dates as null under the existing persistence policy', async () => {
  await withRepository({}, async ({ prepareJobsForInsert }) => {
    const events = [];
    const previousLookbackDays = process.env.JOB_LOOKBACK_DAYS;
    process.env.JOB_LOOKBACK_DAYS = '3';
    const oldPostingDate = Date.now() - (4 * 24 * 60 * 60 * 1000);
    try {
      const prepared = await prepareJobsForInsert([
        job({ apply_url: 'https://jobs.example/invalid', posted_date: 'not-a-date' }),
        job({ apply_url: 'https://jobs.example/missing' }),
        job({ apply_url: 'https://jobs.example/old', posted_date: oldPostingDate }),
      ], { onMetrics: (event) => events.push(event) });

      assert.deepEqual(prepared.map((row) => row.posted_date), [null, null]);
      assert.deepEqual(events, [
        { invalidPostingDates: 1 },
        { missingPostingDates: 1 },
        { lookbackRejected: 1 },
      ]);
    } finally {
      if (previousLookbackDays === undefined) delete process.env.JOB_LOOKBACK_DAYS;
      else process.env.JOB_LOOKBACK_DAYS = previousLookbackDays;
    }
  });
});

test('does not report a failed batch upsert as inserted or successfully saved', async () => {
  await withRepository({ insertError: new Error('simulated database insert failure') }, async ({ saveJobs }, calls) => {
    const result = await saveJobs([
      job({ apply_url: 'https://jobs.example/fail-1' }),
      job({ apply_url: 'https://jobs.example/fail-2' }),
    ]);

    assert.match(result.error.message, /simulated database insert failure/);
    assert.equal(result.stats.inserted, 0);
    assert.equal(result.stats.updated, 0);
    assert.equal(result.stats.failed, 2);
    assert.equal(result.data, null);
    assert.equal(calls.queueInserts.length, 0);
  });
});

test('failed duplicate lookup stops persistence rather than writing with unverified duplicate state', async () => {
  await withRepository({ lookupError: new Error('simulated duplicate lookup failure') }, async ({ saveJobs }, calls) => {
    const result = await saveJobs([job()]);

    assert.match(result.error.message, /simulated duplicate lookup failure/);
    assert.equal(result.stats.inserted, 0);
    assert.equal(result.stats.failed, 1);
    assert.equal(calls.upserts.length, 0);
  });
});

test('reports queue insertion failures without claiming an AI job was queued', async () => {
  await withRepository({ queueError: new Error('simulated queue insert failure') }, async ({ saveJobs }) => {
    const result = await saveJobs([job()]);

    assert.equal(result.error, null);
    assert.equal(result.stats.inserted, 1);
    assert.equal(result.stats.aiQueueInserted, 0);
    assert.equal(result.stats.aiQueueInsertFailures, 1);
    assert.deepEqual(result.stats.newRawJobIds, ['raw-1']);
  });
});
