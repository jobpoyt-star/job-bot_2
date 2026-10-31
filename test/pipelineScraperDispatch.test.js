'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveScraperTargets, runJobPipeline } = require('../src/scheduler/cron');

test('pipeline invokes every registered scraper even when one company fails', async () => {
  const targets = resolveScraperTargets();
  const invoked = [];

  await runJobPipeline({
    seedCompanies: async () => ({ succeeded: [], failed: [] }),
    scraperTargets: targets,
    runScrapers: async ([target]) => {
      invoked.push(target);
      if (target === targets[0]) throw new Error('source unavailable');
      return [];
    },
    runAiWorker: false,
  });

  assert.deepEqual(invoked, targets);
});
