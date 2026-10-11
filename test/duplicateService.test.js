'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deduplicateJobs } = require('../src/services/duplicateService');

function createSupabaseQuery({ result, neverResolve = false, onSignal } = {}) {
  const query = {
    select() { return query; },
    in() { return query; },
    abortSignal(signal) {
      onSignal?.(signal);
      return query;
    },
    then(resolve, reject) {
      if (neverResolve) return new Promise(() => {}).then(resolve, reject);
      return Promise.resolve(result || { data: [], error: null }).then(resolve, reject);
    },
  };
  return {
    from(table) {
      assert.equal(table, 'raw_jobs');
      return query;
    },
  };
}

const jobs = [{
  title: 'Software Engineer',
  apply_url: 'https://jobs.example.test/engineer',
}];

test('deduplicateJobs filters existing apply URLs using Supabase', async () => {
  const result = await deduplicateJobs(jobs, {
    supabase: createSupabaseQuery({
      result: {
        data: [{ id: 'raw-1', apply_url: jobs[0].apply_url }],
        error: null,
      },
    }),
  });

  assert.equal(result.uniqueJobs.length, 0);
  assert.equal(result.duplicateCount, 1);
});

test('deduplicateJobs aborts timed-out Supabase checks and fails closed', async () => {
  let querySignal;
  await assert.rejects(
    deduplicateJobs(jobs, {
      queryTimeoutMs: 10,
      supabase: createSupabaseQuery({
        neverResolve: true,
        onSignal: (signal) => { querySignal = signal; },
      }),
    }),
    /Supabase duplicate check timed out after 10ms/
  );
  assert.equal(querySignal.aborted, true);
});
