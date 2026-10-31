'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');
const { requestJson } = require('./verifiedProductFeeds');

const COMPANY = 'BrowserStack';
const CAREERS_URL = 'https://www.browserstack.com/careers';
const WORKDAY_HOST = 'browserstack.wd3.myworkdayjobs.com';
const WORKDAY_SITE = 'External';
const WORKDAY_BASE_URL = `https://${WORKDAY_HOST}/${WORKDAY_SITE}`;
const WORKDAY_API_URL = `https://${WORKDAY_HOST}/wday/cxs/browserstack/${WORKDAY_SITE}`;
const JOBS_URL = `${WORKDAY_API_URL}/jobs`;
const PAGE_SIZE = 20;

function getBrowserStackApplyUrl(value, externalPath) {
  try {
    const url = new URL(String(value || ''));
    const expectedPath = `${new URL(WORKDAY_BASE_URL).pathname}${externalPath}`;
    if (
      url.protocol !== 'https:'
      || url.hostname !== WORKDAY_HOST
      || url.pathname !== expectedPath
      || !/^\/job\/[a-z0-9-]+\/[a-z0-9-]+_JR[a-z0-9-]+$/i.test(externalPath)
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeBrowserStackPosting(posting, detail, metrics) {
  const externalPath = String(posting?.externalPath || '').trim();
  if (!/^\/job\/[a-z0-9-]+\/[a-z0-9-]+_JR[a-z0-9-]+$/i.test(externalPath)) return null;

  const title = String(detail?.title || posting?.title || '').replace(/\s+/g, ' ').trim();
  const location = String(detail?.location || posting?.locationsText || '').replace(/\s+/g, ' ').trim();
  const country = String(detail?.country?.descriptor || detail?.country || '').trim();
  const externalJobId = String(detail?.jobReqId || posting?.bulletFields?.[0] || '').trim();
  const applyUrl = detail?.canApply === true
    ? getBrowserStackApplyUrl(detail?.externalUrl, externalPath)
    : null;

  if (!title || !location || !externalJobId || !applyUrl) return null;

  const eligibility = evaluateIndiaEligibility({ location, country });
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  return {
    title,
    company: COMPANY,
    company_name: COMPANY,
    location: eligibility.persistedLocation,
    country: 'India',
    experience: null,
    employment_type: detail?.timeType || null,
    work_mode: detail?.remoteType || null,
    salary: null,
    description: detail?.jobDescription || null,
    summary: null,
    skills: null,
    apply_url: applyUrl,
    source: COMPANY,
    posted_date: normalizePostingDate(detail?.startDate),
    expiry_date: normalizePostingDate(detail?.endDate || detail?.jobPostingEndDate),
    status: 'active',
    is_active: true,
    external_job_id: externalJobId,
  };
}

function validateJobsResponse(response) {
  if (
    !response
    || !Number.isInteger(Number(response.total))
    || !Array.isArray(response.jobPostings)
  ) {
    throw new Error('BrowserStack public jobs API returned an invalid response');
  }
  return response;
}

function validateJobDetailResponse(response) {
  if (!response?.jobPostingInfo || typeof response.jobPostingInfo !== 'object') {
    throw new Error('BrowserStack public job-details API returned an invalid response');
  }
  return response.jobPostingInfo;
}

async function fetchBrowserStackJobs(options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  if (options.signal?.aborted) throw new Error('BrowserStack jobs request aborted');

  const request = async (url, data, method = 'POST') => requestJson(url, null, {
    ...options,
    method,
    data: method === 'POST' ? data : undefined,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: CAREERS_URL,
      ...(options.headers || {}),
    },
  });

  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  let pageCount = 0;
  let listingJobsFetched = 0;
  let detailJobsFetched = 0;
  let total = null;
  let offset = 0;

  while (total === null || offset < total) {
    if (options.signal?.aborted) throw new Error('BrowserStack jobs request aborted');
    const response = validateJobsResponse(await request(JOBS_URL, {
      appliedFacets: {},
      limit: PAGE_SIZE,
      offset,
      searchText: '',
    }));
    total = Number(response.total);
    const postings = response.jobPostings;
    pageCount += 1;
    listingJobsFetched += postings.length;

    if (!postings.length && offset < total) {
      throw new Error('BrowserStack public jobs API returned an incomplete results page');
    }

    for (const posting of postings) {
      const externalPath = String(posting?.externalPath || '').trim();
      if (!/^\/job\/[a-z0-9-]+\/[a-z0-9-]+_JR[a-z0-9-]+$/i.test(externalPath) || seen.has(externalPath)) continue;
      seen.add(externalPath);

      const detail = validateJobDetailResponse(await request(`${WORKDAY_API_URL}${externalPath}`, null, 'GET'));
      detailJobsFetched += 1;
      const job = normalizeBrowserStackPosting(posting, detail, metrics);
      if (job) jobs.push(job);
      if (jobs.length >= maxJobs) break;
    }

    offset += postings.length;
    if (jobs.length >= maxJobs || !postings.length || postings.length < PAGE_SIZE) break;
  }

  return { jobs, listingJobsFetched, detailJobsFetched, skippedIndia: metrics.skippedIndia, pageCount };
}

async function scrapeBrowserStackJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const response = await fetchBrowserStackJobs(options);
  logger.info(
    `${COMPANY} public jobs feed completed: fetched=${response.listingJobsFetched}, indiaEligible=${response.jobs.length}`
  );
  return {
    result: response.jobs,
    stats: {
      pageCount: response.pageCount,
      listingJobsFetched: response.listingJobsFetched,
      detailJobsFetched: response.detailJobsFetched,
      recentJobs: response.jobs.length,
      skippedIndia: response.skippedIndia,
      skippedOld: 0,
      stopReason: options.signal?.aborted ? 'timeout' : 'completed',
    },
  };
}

module.exports = {
  CAREERS_URL,
  JOBS_URL,
  WORKDAY_API_URL,
  WORKDAY_BASE_URL,
  fetchBrowserStackJobs,
  getBrowserStackApplyUrl,
  normalizeBrowserStackPosting,
  scrapeBrowserStackJobs,
};
