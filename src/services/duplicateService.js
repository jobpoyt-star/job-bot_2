const supabase = require('../config/supabase');
const logger = require('../utils/logger');

const DEFAULT_DUPLICATE_QUERY_TIMEOUT_MS = 15000;

function getQueryTimeoutMs(value) {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_DUPLICATE_QUERY_TIMEOUT_MS;
}

async function awaitQueryWithTimeout(query, timeoutMs) {
  if (typeof query?.abortSignal !== 'function') {
    throw new Error('Supabase duplicate-check query does not support cancellation');
  }

  const controller = new AbortController();
  let timeoutId;
  const queryPromise = Promise.resolve(query.abortSignal(controller.signal));
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`Supabase duplicate check timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeJob(job) {
  if (!job || typeof job !== 'object') {
    return null;
  }

  return {
    title: job.title?.trim() || null,
    location: job.location?.trim() || null,
    experience: job.experience || null,
    description: job.description || null,
    applyUrl: job.applyUrl || job.apply_url || null,
    source: job.source || null,
  };
}

function validateJob(job) {
  return job && job.applyUrl;
}

async function fetchExistingJobs(jobs, options = {}) {
  const activeSupabase = options.supabase || supabase;
  const queryTimeoutMs = getQueryTimeoutMs(options.queryTimeoutMs);
  const applyUrls = [];

  jobs.forEach((job) => {
    if (job.applyUrl) {
      applyUrls.push(job.applyUrl);
    }
  });

  if (!applyUrls.length) {
    return [];
  }

  const chunks = [];
  const batchSize = 100;
  for (let i = 0; i < applyUrls.length; i += batchSize) {
    chunks.push(applyUrls.slice(i, i + batchSize));
  }

  const rows = [];

  for (const chunk of chunks) {
    const query = activeSupabase
      .from('raw_jobs')
      .select('id,apply_url,source')
      .in('apply_url', chunk);
    const { data, error } = await awaitQueryWithTimeout(query, queryTimeoutMs);

    if (error) {
      logger.error(`Error fetching existing jobs for deduplication: ${error.message}`);
      throw error;
    }

    rows.push(...(data || []));
  }

  return rows;
}

async function deduplicateJobs(jobs, options = {}) {
  const normalizedJobPairs = jobs
    .map((job) => ({ original: job, normalized: normalizeJob(job) }))
    .filter((jobPair) => validateJob(jobPair.normalized));

  if (normalizedJobPairs.length === 0) {
    return {
      uniqueJobs: [],
      duplicateJobs: [],
      duplicateCount: 0,
    };
  }

  try {
    logger.info('Checking for duplicate jobs in Supabase');

    const existingJobs = await fetchExistingJobs(
      normalizedJobPairs.map((jobPair) => jobPair.normalized),
      options
    );
    const existingByApplyUrl = new Set(
      existingJobs.filter((row) => row.apply_url).map((row) => row.apply_url)
    );

    const uniqueJobs = [];
    const duplicateJobs = [];

    normalizedJobPairs.forEach(({ original, normalized }) => {
      const applyUrlMatch = normalized.applyUrl && existingByApplyUrl.has(normalized.applyUrl);

      if (applyUrlMatch) {
        duplicateJobs.push({
          job: original,
          reason: 'applyUrl already exists',
        });
      } else {
        uniqueJobs.push(original);
      }
    });

    return {
      uniqueJobs,
      duplicateJobs,
      duplicateCount: duplicateJobs.length,
    };
  } catch (error) {
    logger.error(`Duplicate detection failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  deduplicateJobs,
};
