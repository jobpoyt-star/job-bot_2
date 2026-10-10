'use strict';

const fs = require('fs');
const {
  initializeRunSummary,
  readRunSummary,
} = require('../src/utils/runSummary');

const QUERY_BATCH_SIZE = 100;
const QUEUE_IN_FLIGHT = new Set(['pending', 'processing', 'retrying']);

function uniqueIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).filter((id) => id != null).map(String)));
}

function createInFilter(ids) {
  return `in.(${ids.map((id) => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
}

async function queryRows({ baseUrl, apiKey, table, select, ids, fetchImpl = global.fetch }) {
  const url = new URL(`/rest/v1/${table}`, baseUrl);
  url.searchParams.set('select', select);
  url.searchParams.set('raw_job_id', createInFilter(ids));

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Run-summary reconciliation failed for ${table} (HTTP ${response.status})`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`Run-summary reconciliation returned invalid ${table} data`);
  return rows;
}

async function reconcileRunJobs(summary, options = {}) {
  const rawJobIds = uniqueIds(summary.rawJobIds);
  if (rawJobIds.length === 0) {
    if (Number(summary.rawJobsInserted) > 0) {
      return { available: false, reason: 'New raw jobs could not be identified for run-specific reconciliation' };
    }
    return {
      available: true,
      aiJobsProcessed: 0,
      aiProcessingFailures: 0,
      aiJobsInFlight: 0,
      processedJobsWritten: 0,
      jobsInserted: 0,
      unknownQueueStatuses: 0,
    };
  }

  const baseUrl = options.baseUrl || process.env.SUPABASE_URL;
  const apiKey = options.apiKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !apiKey) {
    return { available: false, reason: 'Supabase credentials are unavailable' };
  }

  try {
    const queueRows = [];
    const processedRows = [];
    for (let start = 0; start < rawJobIds.length; start += QUERY_BATCH_SIZE) {
      const batch = rawJobIds.slice(start, start + QUERY_BATCH_SIZE);
      queueRows.push(...await queryRows({
        baseUrl,
        apiKey,
        table: 'ai_queue',
        select: 'raw_job_id,status',
        ids: batch,
        fetchImpl: options.fetchImpl,
      }));
      processedRows.push(...await queryRows({
        baseUrl,
        apiKey,
        table: 'processed_jobs',
        select: 'raw_job_id,published_job_id',
        ids: batch,
        fetchImpl: options.fetchImpl,
      }));
    }

    const queueStatusByRawId = new Map();
    for (const row of queueRows) {
      if (row?.raw_job_id != null) queueStatusByRawId.set(String(row.raw_job_id), String(row.status || '').toLowerCase());
    }
    const statuses = rawJobIds
      .filter((id) => queueStatusByRawId.has(id))
      .map((id) => queueStatusByRawId.get(id));
    const processedIds = new Set(processedRows
      .filter((row) => row?.raw_job_id != null)
      .map((row) => String(row.raw_job_id)));
    const publishedIds = new Set(processedRows
      .filter((row) => row?.raw_job_id != null && row.published_job_id != null)
      .map((row) => String(row.raw_job_id)));

    return {
      available: true,
      aiJobsProcessed: new Set(rawJobIds.filter((id) => queueStatusByRawId.get(id) === 'completed')).size,
      aiProcessingFailures: new Set(rawJobIds.filter((id) => queueStatusByRawId.get(id) === 'failed')).size,
      aiJobsInFlight: new Set(rawJobIds.filter((id) => QUEUE_IN_FLIGHT.has(queueStatusByRawId.get(id)))).size,
      processedJobsWritten: processedIds.size,
      jobsInserted: publishedIds.size,
      unknownQueueStatuses: statuses.filter((status) => !['pending', 'processing', 'retrying', 'completed', 'failed'].includes(status)).length,
      queueRowsMissing: rawJobIds.filter((id) => !queueStatusByRawId.has(id)).length,
    };
  } catch {
    return { available: false, reason: 'Supabase run-specific reconciliation could not be completed' };
  }
}

function determineRunStatus(summary, reconciliation, workflowOutcomes = []) {
  if (workflowOutcomes.some((outcome) => outcome === 'failure' || outcome === 'cancelled')) return 'FAILED';

  const scraperFailures = Object.values(summary.scrapers || {}).reduce(
    (total, scraper) => total + (Number(scraper?.failures) || 0),
    0
  );
  if (
    scraperFailures
    || summary.scraperFailures
    || summary.pipelineFailures
    || summary.jobInsertFailures
    || summary.unreconciledRawJobs
    || summary.aiQueueInsertFailures
    || summary.aiQueueUnverified
    || !reconciliation.available
    || reconciliation.aiProcessingFailures
    || reconciliation.aiJobsInFlight
    || reconciliation.unknownQueueStatuses
    || reconciliation.queueRowsMissing
  ) {
    return 'PARTIAL SUCCESS';
  }
  return 'SUCCESS';
}

function formatRunSummary(summary, reconciliation, status) {
  const scraperRows = Object.entries(summary.scrapers || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, scraper]) => `| ${name} | ${scraper.fetched || 0} | ${scraper.indiaRejected || 0} | ${scraper.failures || 0} |`);
  const fetchedTotal = Object.values(summary.scrapers || {}).reduce(
    (total, scraper) => total + (Number(scraper?.fetched) || 0),
    0
  );
  const value = (field) => reconciliation.available ? reconciliation[field] : 'UNAVAILABLE';
  const metrics = [
    ['Jobs fetched total', fetchedTotal],
    ['New raw jobs persisted', summary.rawJobsInserted || 0],
    ['Raw jobs unavailable for run-specific reconciliation', summary.unreconciledRawJobs || 0],
    ['Jobs inserted into jobs table', value('jobsInserted')],
    ['Duplicate jobs skipped', summary.duplicateJobsSkipped || 0],
    ['India eligibility rejections', summary.indiaRejected || 0],
    ['AI jobs added to queue', summary.aiJobsQueued || 0],
    ['AI jobs processed successfully', value('aiJobsProcessed')],
    ['AI processing failures', value('aiProcessingFailures')],
    ['AI jobs pending / retrying / processing', value('aiJobsInFlight')],
    ['processed_jobs rows written', value('processedJobsWritten')],
    ['AI queue insert failures', summary.aiQueueInsertFailures || 0],
    ['AI queue status unverified during insertion', summary.aiQueueUnverified || 0],
    ['Raw-job insert failures', summary.jobInsertFailures || 0],
  ];

  const lines = [
    `## JOBPOYT execution summary — ${status}`,
    '',
    '| Metric | Current run |',
    '|---|---:|',
    ...metrics.map(([label, count]) => `| ${label} | ${count} |`),
    '',
    '| Scraper | Jobs fetched | India rejected | Failures |',
    '|---|---:|---:|---:|',
    ...(scraperRows.length ? scraperRows : ['| (none) | 0 | 0 | 0 |']),
    `| **Total** | **${fetchedTotal}** | **${summary.indiaRejected || 0}** | **${Object.values(summary.scrapers || {}).reduce((total, scraper) => total + (Number(scraper?.failures) || 0), 0)}** |`,
  ];
  if (!reconciliation.available) lines.push('', `Queue reconciliation unavailable: ${reconciliation.reason}`);
  if (reconciliation.available && reconciliation.queueRowsMissing) {
    lines.push('', `Queue rows missing for current-run raw jobs: ${reconciliation.queueRowsMissing}`);
  }
  if (reconciliation.available && reconciliation.unknownQueueStatuses) {
    lines.push('', `Unrecognized queue statuses: ${reconciliation.unknownQueueStatuses}`);
  }
  return lines.join('\n');
}

async function finalizeRunSummary(options = {}) {
  const summary = options.summary || readRunSummary(options.filePath);
  const reconciliation = await reconcileRunJobs(summary, options);
  const workflowOutcomes = options.workflowOutcomes || [
    process.env.JOBBOT_SETUP_OUTCOME,
    process.env.JOBBOT_INIT_OUTCOME,
    process.env.JOBBOT_INSTALL_OUTCOME,
    process.env.JOBBOT_BROWSER_OUTCOME,
    process.env.JOBBOT_SCRAPE_OUTCOME,
  ];
  const status = determineRunStatus(summary, reconciliation, workflowOutcomes);
  return { summary, reconciliation, status, markdown: formatRunSummary(summary, reconciliation, status) };
}

async function main() {
  const command = process.argv[2];
  if (command === 'init') {
    initializeRunSummary({ runId: process.env.JOBBOT_RUN_ID });
    return;
  }
  if (command !== 'finalize') throw new Error('Expected command: init or finalize');

  const result = await finalizeRunSummary();
  console.log(result.markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.markdown}\n`);
  }
  if (result.status === 'FAILED') process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Execution summary failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createInFilter,
  determineRunStatus,
  finalizeRunSummary,
  formatRunSummary,
  queryRows,
  reconcileRunJobs,
};
