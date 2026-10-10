'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  initializeRunSummary,
  readRunSummary,
  recordRunMetrics,
} = require('../src/utils/runSummary');
const {
  determineRunStatus,
  finalizeRunSummary,
  reconcileRunJobs,
} = require('../scripts/runSummary');

function withSummaryFile(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jobbot-summary-'));
  const filePath = path.join(directory, 'run.json');
  try {
    callback(filePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('run metrics aggregate scraper counts, duplicates, successful inserts, and failed inserts', () => {
  withSummaryFile((filePath) => {
    initializeRunSummary({ filePath, runId: 'workflow-1' });
    recordRunMetrics({
      scraper: { name: 'freshworks', fetched: 12, indiaRejected: 3 },
      duplicateJobsSkipped: 4,
      rawJobsInserted: 5,
      aiJobsQueued: 4,
      rawJobIds: ['raw-1', 'raw-2', 'raw-3', 'raw-4'],
    }, { filePath });
    recordRunMetrics({
      scraper: { name: 'freshworks', fetched: 2, indiaRejected: 1 },
      duplicateJobsSkipped: 2,
      jobInsertFailures: 1,
      aiQueueInsertFailures: 1,
      rawJobIds: ['raw-4'],
    }, { filePath });

    const summary = readRunSummary(filePath);
    assert.equal(summary.runId, 'workflow-1');
    assert.equal(summary.jobsFetched, 14);
    assert.equal(summary.indiaRejected, 4);
    assert.equal(summary.scrapers.freshworks.fetched, 14);
    assert.equal(summary.duplicateJobsSkipped, 6);
    assert.equal(summary.rawJobsInserted, 5);
    assert.equal(summary.aiJobsQueued, 4);
    assert.equal(summary.jobInsertFailures, 1);
    assert.equal(summary.aiQueueInsertFailures, 1);
    assert.deepEqual(summary.rawJobIds, ['raw-1', 'raw-2', 'raw-3', 'raw-4']);
  });
});

test('reconciliation counts unique current-run AI outcomes and published job references', async () => {
  const summary = {
    rawJobIds: ['raw-1', 'raw-2', 'raw-3', 'raw-4', 'raw-5', 'raw-6'],
  };
  const fetchImpl = async (url) => {
    const table = new URL(url).pathname.split('/').pop();
    const rows = table === 'ai_queue'
      ? [
        { raw_job_id: 'raw-1', status: 'Completed' },
        { raw_job_id: 'raw-2', status: 'Failed' },
        { raw_job_id: 'raw-3', status: 'Pending' },
        { raw_job_id: 'raw-4', status: 'Processing' },
        { raw_job_id: 'raw-5', status: null },
      ]
      : [
        { raw_job_id: 'raw-1', published_job_id: 'job-1' },
        { raw_job_id: 'raw-1', published_job_id: 'job-1' },
        { raw_job_id: 'raw-2', published_job_id: null },
      ];
    return { ok: true, json: async () => rows };
  };

  const result = await reconcileRunJobs(summary, {
    baseUrl: 'https://supabase.example',
    apiKey: 'test-placeholder',
    fetchImpl,
  });

  assert.equal(result.available, true);
  assert.equal(result.aiJobsProcessed, 1);
  assert.equal(result.aiProcessingFailures, 1);
  assert.equal(result.aiJobsInFlight, 2);
  assert.equal(result.processedJobsWritten, 2);
  assert.equal(result.jobsInserted, 1);
  assert.equal(result.queueRowsMissing, 1);
  assert.equal(result.unknownQueueStatuses, 1);
});

test('summary reports missing Supabase reconciliation instead of fabricated zeros', async () => {
  const result = await finalizeRunSummary({
    summary: { rawJobIds: ['raw-1'], rawJobsInserted: 1, scrapers: {} },
    workflowOutcomes: ['success'],
    fetchImpl: async () => { throw new Error('network unavailable'); },
    baseUrl: 'https://supabase.example',
    apiKey: 'test-placeholder',
  });

  assert.equal(result.reconciliation.available, false);
  assert.equal(result.status, 'PARTIAL SUCCESS');
  assert.match(result.markdown, /UNAVAILABLE/);
  assert.doesNotMatch(result.markdown, /test-placeholder/);
});

test('pending AI work is partial success, completed work is success, and failed workflow steps are failed', () => {
  const summary = {
    scrapers: { freshworks: { fetched: 2, failures: 0 } },
    rawJobIds: ['raw-1'],
  };
  const completed = {
    available: true,
    aiJobsProcessed: 1,
    aiProcessingFailures: 0,
    aiJobsInFlight: 0,
    unknownQueueStatuses: 0,
    queueRowsMissing: 0,
  };
  const pending = { ...completed, aiJobsInFlight: 1 };

  assert.equal(determineRunStatus(summary, completed, ['success']), 'SUCCESS');
  assert.equal(determineRunStatus(summary, pending, ['success']), 'PARTIAL SUCCESS');
  assert.equal(determineRunStatus(summary, completed, ['failure']), 'FAILED');
});

test('missing run-specific IDs make raw inserts unreconciled', async () => {
  const result = await reconcileRunJobs({ rawJobIds: [], rawJobsInserted: 3 });
  assert.equal(result.available, false);
  assert.match(result.reason, /could not be identified/);
});
