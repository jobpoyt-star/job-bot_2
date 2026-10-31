'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runAiWorkerUntilIdle } = require('../src/scheduler/cron');

test('runAiWorkerUntilIdle drains historical pending work in batches without a raw-job filter', async () => {
  const calls = [];
  const onPublished = () => {};
  const worker = async (options) => {
    calls.push(options);
    const batch = calls.length;
    return {
      jobsLoaded: batch < 3 ? 5 : 2,
      jobsCompleted: batch < 3 ? 5 : 2,
      jobsFailed: 0,
      jobsQuarantined: 0,
      publisher: {
        publishedCount: batch < 3 ? 5 : 2,
        skippedCount: 0,
        failedCount: 0,
      },
    };
  };

  const result = await runAiWorkerUntilIdle({ batchSize: 5, worker, onPublished });

  assert.equal(calls.length, 3);
  assert.ok(calls.every((options) => options.batchSize === 5));
  assert.ok(calls.every((options) => options.onPublished === onPublished));
  assert.ok(calls.every((options) => !Object.hasOwn(options, 'rawJobIds')));
  assert.equal(result.jobsLoaded, 12);
  assert.equal(result.jobsCompleted, 12);
  assert.equal(result.batches, 3);
  assert.equal(result.publisher.publishedCount, 12);
});

test('runAiWorkerUntilIdle stops after AI provider failures', async () => {
  let calls = 0;
  const result = await runAiWorkerUntilIdle({
    batchSize: 5,
    worker: async () => {
      calls += 1;
      return { jobsLoaded: 5, jobsCompleted: 2, jobsFailed: 1, jobsQuarantined: 0 };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.jobsFailed, 1);
});
