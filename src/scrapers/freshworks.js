'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { shouldSaveJob } = require('../parsers/common/jobFilters');

const COMPANY_IDENTIFIER = 'Freshworks';
const LISTINGS_URL = `https://api.smartrecruiters.com/v1/companies/${COMPANY_IDENTIFIER}/postings`;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_JOBS = 100;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_REQUEST_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30000;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function normalizeText(value) {
  if (value == null) return null;
  const text = String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

function decodeHtml(value) {
  if (value == null) return null;
  return normalizeText(String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'"));
}

function getPostingDescription(details) {
  const sections = details?.jobAd?.sections;
  if (!sections || typeof sections !== 'object') return null;

  return [
    sections.jobDescription?.text,
    sections.qualifications?.text,
    sections.additionalInformation?.text,
  ].map(decodeHtml).filter(Boolean).join('\n\n') || null;
}

function normalizeFreshworksPosting(posting, details = {}) {
  if (!posting || typeof posting !== 'object' || !posting.id || !posting.name) return null;
  const location = details.location || posting.location || {};
  const applyUrl = normalizeText(details.applyUrl || details.postingUrl);
  if (!applyUrl || !/^https?:\/\//i.test(applyUrl)) return null;

  const cityRegion = [location.city, location.region].map(normalizeText).filter(Boolean).join(', ');
  const normalizedLocation = normalizeText(location.fullLocation) || cityRegion || null;
  const countryCode = normalizeText(location.countryCode || location.country || posting.countryCode || posting.country);
  const remote = location.remote === true || details.remote === true;
  const hybrid = location.hybrid === true || details.hybrid === true;

  return {
    title: normalizeText(posting.name || details.name),
    company: COMPANY_IDENTIFIER,
    company_name: COMPANY_IDENTIFIER,
    location: remote && !normalizedLocation ? 'Remote' : normalizedLocation,
    country: countryCode,
    work_mode: remote ? 'Remote' : hybrid ? 'Hybrid' : null,
    employment_type: normalizeText(
      details.typeOfEmployment?.label || posting.typeOfEmployment?.label
    ),
    description: getPostingDescription(details),
    summary: null,
    skills: null,
    apply_url: applyUrl,
    source: COMPANY_IDENTIFIER,
    posted_date: details.releasedDate || posting.releasedDate || null,
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: String(posting.id),
  };
}

function getRetryAfterMs(error) {
  const value = error?.response?.headers?.['retry-after'];
  if (value == null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(new Error('Freshworks request aborted'));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error('Freshworks request aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function requestWithRetry(request, options = {}) {
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const status = Number(error?.response?.status || error?.status || 0);
      const retryable = RETRYABLE_STATUSES.has(status)
        || ['ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error?.code);
      const retryAfterMs = status === 429 ? getRetryAfterMs(error) : null;
      if (
        !retryable
        || attempt === MAX_REQUEST_ATTEMPTS
        || (status === 429 && (retryAfterMs == null || retryAfterMs > MAX_RETRY_AFTER_MS))
      ) {
        if (status) {
          const safeError = new Error(`SmartRecruiters request failed with HTTP ${status}`);
          safeError.status = status;
          throw safeError;
        }
        throw new Error(`SmartRecruiters request failed (${retryable ? 'temporary network error' : 'request error'})`);
      }

      const delayMs = retryAfterMs ?? Math.min(5000, 500 * (2 ** (attempt - 1)));
      logger.warn(`Freshworks SmartRecruiters retry attempt=${attempt + 1}/${MAX_REQUEST_ATTEMPTS} status=${status || 'network'}`);
      await wait(delayMs, options.signal);
    }
  }

  throw new Error('SmartRecruiters request failed');
}

async function fetchFreshworksPage(offset, limit, options = {}) {
  if (options.fetchPage) return options.fetchPage(offset, limit);

  const response = await requestWithRetry(() => axios.get(LISTINGS_URL, {
    params: { offset, limit },
    headers: { Accept: 'application/json' },
    timeout: options.timeoutMs || REQUEST_TIMEOUT_MS,
    signal: options.signal,
  }), options);
  return response.data;
}

async function fetchFreshworksPostingDetails(postingId, options = {}) {
  if (options.fetchDetails) return options.fetchDetails(postingId);

  const response = await requestWithRetry(() => axios.get(`${LISTINGS_URL}/${encodeURIComponent(postingId)}`, {
    headers: { Accept: 'application/json' },
    timeout: options.timeoutMs || REQUEST_TIMEOUT_MS,
    signal: options.signal,
  }), options);
  return response.data;
}

async function fetchFreshworksJobs(options = {}) {
  const pageSizeValue = Number(options.pageSize || DEFAULT_PAGE_SIZE);
  const pageSize = Number.isFinite(pageSizeValue) && pageSizeValue > 0
    ? Math.min(Math.floor(pageSizeValue), DEFAULT_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const maxJobsValue = Number(options.maxJobs || DEFAULT_MAX_JOBS);
  const maxJobs = Number.isFinite(maxJobsValue) && maxJobsValue > 0
    ? Math.min(Math.floor(maxJobsValue), DEFAULT_MAX_JOBS)
    : DEFAULT_MAX_JOBS;
  const stats = {
    fetched: 0,
    normalized: 0,
    eligible: 0,
    skippedIndiaEligibility: 0,
    skippedMissingApplyUrl: 0,
    failed: 0,
    pageCount: 0,
    stopReason: 'completed',
    jobs: [],
  };
  const listings = [];
  const seenPostingIds = new Set();
  let offset = 0;
  let totalFound = Infinity;

  while (listings.length < maxJobs && offset < totalFound) {
    if (options.signal?.aborted) throw new Error('Freshworks scrape aborted');
    const page = await fetchFreshworksPage(offset, Math.min(pageSize, maxJobs - listings.length), options);
    const pageJobs = Array.isArray(page?.content) ? page.content : [];
    stats.pageCount += 1;
    stats.fetched += pageJobs.length;
    totalFound = Number(page?.totalFound);
    listings.push(...pageJobs);
    offset += pageJobs.length;

    if (!pageJobs.length || pageJobs.length < pageSize || !Number.isFinite(totalFound)) break;
  }

  for (const posting of listings.slice(0, maxJobs)) {
    const postingId = String(posting?.id || '');
    if (!postingId || seenPostingIds.has(postingId)) continue;
    seenPostingIds.add(postingId);
    if (options.signal?.aborted) throw new Error('Freshworks scrape aborted');
    let details;
    try {
      details = await fetchFreshworksPostingDetails(posting.id, options);
    } catch (error) {
      stats.failed += 1;
      logger.warn(`Freshworks posting detail failed id=${postingId} status=${error.status || 'request'}`);
      if (error.status === 429) {
        stats.stopReason = 'rate_limited';
        break;
      }
      continue;
    }
    const job = normalizeFreshworksPosting(posting, details);
    if (!job) {
      stats.skippedMissingApplyUrl += 1;
      continue;
    }
    stats.normalized += 1;

    if (!shouldSaveJob(job)) {
      stats.skippedIndiaEligibility += 1;
      continue;
    }

    stats.jobs.push(job);
    stats.eligible += 1;
  }

  return stats;
}

async function scrapeFreshworksJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const stats = await fetchFreshworksJobs(options);
  logger.info(
    `Freshworks SmartRecruiters completed: pages=${stats.pageCount}, fetched=${stats.fetched}, eligible=${stats.eligible}, skippedIndia=${stats.skippedIndiaEligibility}, missingApplyUrl=${stats.skippedMissingApplyUrl}, failed=${stats.failed}, stopReason=${stats.stopReason}`
  );
  return {
    result: stats.jobs,
    stats: {
      pageCount: stats.pageCount,
      listingJobsFetched: stats.fetched,
      detailJobsFetched: stats.normalized,
      recentJobs: stats.eligible,
      skippedOld: 0,
      skippedIndia: stats.skippedIndiaEligibility,
      failed: stats.failed,
      stopReason: stats.stopReason,
    },
  };
}

module.exports = {
  fetchFreshworksJobs,
  fetchFreshworksPage,
  normalizeFreshworksPosting,
  scrapeFreshworksJobs,
};
