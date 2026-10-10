'use strict';

const fs = require('fs');
const path = require('path');

const NUMERIC_METRICS = [
  'jobsFetched',
  'rawJobsInserted',
  'unreconciledRawJobs',
  'jobInsertFailures',
  'duplicateJobsSkipped',
  'indiaRejected',
  'aiJobsQueued',
  'aiQueueInsertFailures',
  'aiQueueUnverified',
  'scraperFailures',
  'pipelineFailures',
];

function createEmptyRunSummary(runId = null) {
  return {
    version: 1,
    runId,
    startedAt: new Date().toISOString(),
    scrapers: {},
    rawJobIds: [],
    ...Object.fromEntries(NUMERIC_METRICS.map((metric) => [metric, 0])),
  };
}

function getSummaryPath(filePath = process.env.JOBBOT_RUN_SUMMARY_FILE) {
  return typeof filePath === 'string' && filePath.trim() ? filePath : null;
}

function readRunSummary(filePath = process.env.JOBBOT_RUN_SUMMARY_FILE) {
  const resolvedPath = getSummaryPath(filePath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return createEmptyRunSummary(process.env.JOBBOT_RUN_ID || null);
  }

  const summary = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  if (summary?.version !== 1 || !Array.isArray(summary.rawJobIds)) {
    throw new Error('Run summary file has an unsupported or invalid format');
  }
  for (const metric of NUMERIC_METRICS) {
    if (!Number.isFinite(summary[metric])) summary[metric] = 0;
  }
  if (!summary.scrapers || typeof summary.scrapers !== 'object' || Array.isArray(summary.scrapers)) {
    summary.scrapers = {};
  }
  return summary;
}

function writeRunSummary(summary, filePath = process.env.JOBBOT_RUN_SUMMARY_FILE) {
  const resolvedPath = getSummaryPath(filePath);
  if (!resolvedPath) return false;

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const temporaryPath = `${resolvedPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(summary)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, resolvedPath);
  return true;
}

function initializeRunSummary(options = {}) {
  const summary = createEmptyRunSummary(options.runId || process.env.JOBBOT_RUN_ID || null);
  writeRunSummary(summary, options.filePath);
  return summary;
}

function recordRunMetrics(delta, options = {}) {
  const summary = readRunSummary(options.filePath);
  for (const metric of NUMERIC_METRICS) {
    const amount = Number(delta?.[metric]);
    if (Number.isFinite(amount) && amount > 0) summary[metric] += amount;
  }

  if (delta?.scraper && typeof delta.scraper.name === 'string') {
    const scraperName = delta.scraper.name;
    const scraper = summary.scrapers[scraperName] || { fetched: 0, indiaRejected: 0, failures: 0 };
    const fetched = Math.max(0, Number(delta.scraper.fetched) || 0);
    const indiaRejected = Math.max(0, Number(delta.scraper.indiaRejected) || 0);
    scraper.fetched += fetched;
    scraper.indiaRejected += indiaRejected;
    scraper.failures += Math.max(0, Number(delta.scraper.failures) || 0);
    summary.jobsFetched += fetched;
    summary.indiaRejected += indiaRejected;
    summary.scrapers[scraperName] = scraper;
  }

  const newIds = Array.isArray(delta?.rawJobIds)
    ? delta.rawJobIds.filter((id) => id != null && String(id).length > 0).map(String)
    : [];
  if (newIds.length) {
    const ids = new Set(summary.rawJobIds.map(String));
    for (const id of newIds) ids.add(id);
    summary.rawJobIds = Array.from(ids);
  }

  writeRunSummary(summary, options.filePath);
  return summary;
}

module.exports = {
  NUMERIC_METRICS,
  createEmptyRunSummary,
  initializeRunSummary,
  readRunSummary,
  recordRunMetrics,
  writeRunSummary,
};
