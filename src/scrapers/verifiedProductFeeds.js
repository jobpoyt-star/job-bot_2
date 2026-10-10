'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');

const REQUEST_TIMEOUT_MS = 20000;
const MAX_REQUEST_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30000;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const FEEDS = {
  razorpay: {
    company: 'Razorpay',
    type: 'greenhouse',
    url: 'https://boards-api.greenhouse.io/v1/boards/razorpaysoftwareprivatelimited/jobs',
  },
  groww: {
    company: 'Groww',
    type: 'greenhouse',
    url: 'https://boards-api.eu.greenhouse.io/v1/boards/groww/jobs',
  },
  paytm: {
    company: 'Paytm',
    type: 'lever',
    url: 'https://api.lever.co/v0/postings/paytm',
  },
  meesho: {
    company: 'Meesho',
    type: 'lever',
    url: 'https://api.lever.co/v0/postings/meesho',
  },
  cred: {
    company: 'CRED',
    type: 'lever',
    url: 'https://api.lever.co/v0/postings/cred',
  },
  swiggy: {
    company: 'Swiggy',
    type: 'swiggy',
    url: 'https://careers.swiggy.in/api/jobs.json',
  },
};

function getRetryAfterMs(error) {
  const value = error?.response?.headers?.['retry-after'];
  if (value == null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(new Error('Job feed request aborted'));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error('Job feed request aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function requestJson(url, params, options = {}) {
  const request = options.request || ((requestUrl, config) => axios.get(requestUrl, config));
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) throw new Error('Job feed request aborted');
    try {
      const response = await request(url, {
        params,
        headers: { Accept: 'application/json' },
        timeout: options.timeoutMs || REQUEST_TIMEOUT_MS,
        signal: options.signal,
      });
      return response?.data === undefined ? response : response.data;
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
        const safeError = new Error(
          status
            ? `Job feed request failed with HTTP ${status}`
            : `Job feed request failed (${retryable ? 'temporary network error' : 'request error'})`
        );
        safeError.status = status || undefined;
        throw safeError;
      }

      const delayMs = retryAfterMs ?? Math.min(5000, 500 * (2 ** (attempt - 1)));
      logger.warn(`Product job feed retry attempt=${attempt + 1}/${MAX_REQUEST_ATTEMPTS} status=${status || 'network'}`);
      await (options.wait || wait)(delayMs, options.signal);
    }
  }
  throw new Error('Job feed request failed');
}

function normalizeWorkMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (/\b(remote|work from home|work-from-home)\b/.test(mode)) return 'Remote';
  if (/\bhybrid\b/.test(mode)) return 'Hybrid';
  if (/\b(on[- ]?site|office)\b/.test(mode)) return 'Onsite';
  return null;
}

function normalizePosting(posting, company) {
  const title = String(posting?.title || '').replace(/\s+/g, ' ').trim();
  const applyUrl = String(posting?.applyUrl || '').trim();
  if (!title || !/^https?:\/\//i.test(applyUrl)) return null;

  const job = {
    title,
    company,
    company_name: company,
    location: posting.location || null,
    country: posting.country || null,
    work_mode: normalizeWorkMode(posting.workMode),
    employment_type: posting.employmentType || null,
    description: posting.description || null,
    summary: null,
    skills: null,
    apply_url: applyUrl,
    source: company,
    posted_date: posting.postedDate || null,
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: posting.id == null ? applyUrl : String(posting.id),
  };
  const eligibility = evaluateIndiaEligibility(job);
  if (!eligibility.eligible) return null;
  job.location = eligibility.persistedLocation;
  return job;
}

function normalizeGreenhousePosting(job, company) {
  const location = job?.location;
  const locationName = typeof location === 'string'
    ? location
    : location?.name || location?.city || null;
  return normalizePosting({
    id: job?.id,
    title: job?.title,
    location: locationName,
    country: location?.country || job?.country || null,
    applyUrl: job?.absolute_url,
    postedDate: job?.first_published || null,
  }, company);
}

function getLeverIndiaLocations(posting) {
  const categories = posting?.categories || {};
  const alternatives = Array.isArray(categories.allLocations)
    ? categories.allLocations
    : [];
  const indiaLocations = alternatives.filter((location) => (
    evaluateIndiaEligibility({ location }).eligible
  ));
  if (indiaLocations.length) {
    return { location: indiaLocations.join(' / '), country: null };
  }
  return { location: categories.location || null, country: posting?.country || null };
}

function normalizeLeverPosting(posting, company) {
  const categories = posting?.categories || {};
  const location = getLeverIndiaLocations(posting);
  return normalizePosting({
    id: posting?.id,
    title: posting?.text,
    ...location,
    workMode: posting?.workplaceType,
    employmentType: categories.commitment || null,
    description: posting?.descriptionPlain || posting?.openingPlain || null,
    applyUrl: posting?.applyUrl || posting?.hostedUrl,
    postedDate: posting?.createdAt || null,
  }, company);
}

function normalizeSwiggyPosting(posting) {
  return normalizePosting({
    id: posting?.u,
    title: posting?.t,
    location: posting?.l,
    employmentType: posting?.e,
    applyUrl: posting?.u,
  }, 'Swiggy');
}

async function fetchGreenhouseJobs(feed, options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const data = await requestJson(feed.url, {}, options);
  const postings = Array.isArray(data?.jobs) ? data.jobs : [];
  const seen = new Set();
  const jobs = [];
  for (const posting of postings) {
    const id = String(posting?.id || posting?.absolute_url || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const normalized = normalizeGreenhousePosting(posting, feed.company);
    if (normalized) jobs.push(normalized);
    if (jobs.length >= maxJobs) break;
  }
  return { jobs, fetched: seen.size };
}

async function fetchLeverJobs(feed, options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const jobs = [];
  const seen = new Set();
  let skip = 0;
  const limit = Math.min(50, maxJobs);
  while (jobs.length < maxJobs) {
    const data = await requestJson(feed.url, { skip, limit, mode: 'json' }, options);
    if (!Array.isArray(data) || !data.length) break;
    let newJobs = 0;
    for (const posting of data) {
      const id = String(posting?.id || posting?.hostedUrl || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      newJobs += 1;
      const normalized = normalizeLeverPosting(posting, feed.company);
      if (normalized) jobs.push(normalized);
      if (jobs.length >= maxJobs) break;
    }
    if (!newJobs || data.length < limit) break;
    skip += data.length;
  }
  return { jobs, fetched: seen.size };
}

async function fetchSwiggyJobs(feed, options = {}) {
  const data = await requestJson(feed.url, {}, options);
  const postings = Array.isArray(data?.jobs) ? data.jobs : [];
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const seen = new Set();
  const jobs = [];
  for (const posting of postings) {
    const key = String(posting?.u || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const normalized = normalizeSwiggyPosting(posting);
    if (normalized) jobs.push(normalized);
    if (jobs.length >= maxJobs) break;
  }
  return { jobs, fetched: seen.size };
}

async function fetchCompanyJobs(companyKey, options = {}) {
  const feed = FEEDS[companyKey];
  if (!feed) throw new Error(`No verified job feed configured for ${companyKey}`);
  let result;
  if (feed.type === 'greenhouse') result = await fetchGreenhouseJobs(feed, options);
  else if (feed.type === 'lever') result = await fetchLeverJobs(feed, options);
  else result = await fetchSwiggyJobs(feed, options);

  return {
    ...result,
    stats: {
      pageCount: feed.type === 'lever' ? Math.ceil(result.fetched / Math.min(50, Number(options.maxJobs) || 100)) : 1,
      listingJobsFetched: result.fetched,
      detailJobsFetched: result.fetched,
      recentJobs: result.jobs.length,
      skippedOld: 0,
      stopReason: options.signal?.aborted ? 'timeout' : 'completed',
    },
  };
}

function createCompanyScraper(companyKey) {
  return async function scrapeVerifiedCompanyJobs(_query = '', _location = '', _fullSync = false, options = {}) {
    const response = await fetchCompanyJobs(companyKey, options);
    logger.info(
      `${FEEDS[companyKey].company} public feed completed: fetched=${response.stats.listingJobsFetched}, indiaEligible=${response.jobs.length}`
    );
    return { result: response.jobs, stats: response.stats };
  };
}

const scrapers = Object.fromEntries(Object.keys(FEEDS).map((companyKey) => [
  companyKey,
  createCompanyScraper(companyKey),
]));

module.exports = {
  FEEDS,
  fetchCompanyJobs,
  fetchGreenhouseJobs,
  fetchLeverJobs,
  fetchSwiggyJobs,
  normalizeGreenhousePosting,
  normalizeLeverPosting,
  normalizeSwiggyPosting,
  requestJson,
  ...scrapers,
};
