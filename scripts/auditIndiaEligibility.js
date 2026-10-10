'use strict';

const supabase = require('../src/database/supabaseClient');
const { evaluateIndiaEligibility } = require('../src/parsers/common/jobFilters');

const PAGE_SIZE = 500;
const LOOKUP_BATCH_SIZE = 50;

async function fetchAllRows(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function classifyPublishedJob(job) {
  const eligibility = evaluateIndiaEligibility(job);
  if (eligibility.eligible) return null;
  if (eligibility.status === 'rejected') return 'clearly_non_indian';
  if (eligibility.reason === 'remote_india_eligibility_unverified') {
    return 'remote_india_eligibility_unverified';
  }
  return 'missing_or_ambiguous_location';
}

async function fetchProcessedRowsForJobs(jobs) {
  const publishedIds = jobs.map((job) => job.id).filter(Boolean);
  const processedRows = [];
  for (let offset = 0; offset < publishedIds.length; offset += LOOKUP_BATCH_SIZE) {
    const ids = publishedIds.slice(offset, offset + LOOKUP_BATCH_SIZE);
    const { data, error } = await supabase
      .from('processed_jobs')
      .select('id,raw_job_id,published_job_id,apply_url')
      .in('published_job_id', ids);
    if (error) throw error;
    processedRows.push(...(Array.isArray(data) ? data : []));
  }
  return processedRows;
}

async function fetchRawRowsForProcessed(processedRows) {
  const rawIds = [...new Set(processedRows.map((row) => row.raw_job_id).filter(Boolean))];
  const rawRows = [];
  for (let offset = 0; offset < rawIds.length; offset += LOOKUP_BATCH_SIZE) {
    const ids = rawIds.slice(offset, offset + LOOKUP_BATCH_SIZE);
    const { data, error } = await supabase
      .from('raw_jobs')
      .select('id,title,location,work_mode,apply_url')
      .in('id', ids);
    if (error) throw error;
    rawRows.push(...(Array.isArray(data) ? data : []));
  }
  return rawRows;
}

async function auditPublishedJobs() {
  const jobs = await fetchAllRows(() => supabase
    .from('jobs')
    .select('id,title,location,work_mode,description,application_link,status')
    .eq('status', 'published')
    .order('id', { ascending: true }));
  const findings = {
    clearly_non_indian: [],
    remote_india_eligibility_unverified: [],
    missing_or_ambiguous_location: [],
  };

  for (const job of jobs) {
    const category = classifyPublishedJob(job);
    if (category) {
      findings[category].push({
        id: job.id,
        title: job.title || null,
        location: job.location || null,
        work_mode: job.work_mode || null,
        application_link: job.application_link || null,
        reason: evaluateIndiaEligibility(job).reason,
      });
    }
  }

  const findingIds = new Set(Object.values(findings).flat().map((row) => row.id));
  const affectedJobs = jobs.filter((job) => findingIds.has(job.id));
  const processedRows = await fetchProcessedRowsForJobs(affectedJobs);
  const rawRows = await fetchRawRowsForProcessed(processedRows);
  const processedByPublishedId = new Map();
  for (const row of processedRows) {
    const rows = processedByPublishedId.get(row.published_job_id) || [];
    rows.push(row);
    processedByPublishedId.set(row.published_job_id, rows);
  }
  const rawById = new Map(rawRows.map((row) => [row.id, row]));

  for (const finding of Object.values(findings).flat()) {
    const linkedProcessed = processedByPublishedId.get(finding.id) || [];
    finding.processed_job_ids = linkedProcessed.map((row) => row.id);
    finding.raw_jobs = linkedProcessed
      .map((row) => rawById.get(row.raw_job_id))
      .filter(Boolean)
      .map((raw) => ({
        id: raw.id,
        title: raw.title || null,
        location: raw.location || null,
        work_mode: raw.work_mode || null,
      }));
  }

  return {
    read_only: true,
    published_jobs_scanned: jobs.length,
    findings: Object.fromEntries(
      Object.entries(findings).map(([category, records]) => [
        category,
        { count: records.length, records },
      ])
    ),
  };
}

if (require.main === module) {
  auditPublishedJobs()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error) => {
      console.error(`India eligibility audit failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { auditPublishedJobs, classifyPublishedJob };
