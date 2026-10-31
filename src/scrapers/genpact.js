'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');
const { requestJson } = require('./verifiedProductFeeds');

const COMPANY = 'Genpact';
const CAREERS_URL = 'https://www.genpact.com/careers';
const WORKDAY_HOST = 'genpact.wd108.myworkdayjobs.com';
const WORKDAY_SITE = 'External_Careers';
const WORKDAY_BASE_URL = `https://${WORKDAY_HOST}/${WORKDAY_SITE}`;
const WORKDAY_API_URL = `https://${WORKDAY_HOST}/wday/cxs/genpact/${WORKDAY_SITE}`;
const JOBS_URL = `${WORKDAY_API_URL}/jobs`;
const PAGE_SIZE = 20;
const INDIA_LOCATION_PREFIXES = [
  /^1401-GIPL:/i,
  /^1410-GMS Ind:/i,
  /^1415-G-ENTERPRISE RISK CONSULTING:/i,
  /^1415-GERC:/i,
  /^1415-G ERC:/i,
];

function isIndiaLocationFacet(value) {
  const descriptor = String(value?.descriptor || '').trim();
  return /\bindia\b/i.test(descriptor)
    || INDIA_LOCATION_PREFIXES.some((prefix) => prefix.test(descriptor));
}

function getIndiaLocationIds(response) {
  const locationGroup = response?.facets
    ?.find((facet) => facet?.facetParameter === 'locationMainGroup')
    ?.values
    ?.find((group) => group?.facetParameter === 'locations');

  if (!Array.isArray(locationGroup?.values)) {
    throw new Error('Genpact public jobs API did not include its location facets');
  }

  return locationGroup.values
    .filter(isIndiaLocationFacet)
    .map((facet) => String(facet.id || '').trim())
    .filter(Boolean);
}

function getGenpactApplyUrl(value, externalPath) {
  try {
    const url = new URL(String(value || ''));
    const expectedPath = `${WORKDAY_BASE_URL}${externalPath}`;
    if (
      url.protocol !== 'https:'
      || url.hostname !== WORKDAY_HOST
      || url.pathname !== new URL(expectedPath).pathname
      || !url.pathname.startsWith(`/${WORKDAY_SITE}/job/`)
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeGenpactPosting(posting, detail, metrics) {
  const externalPath = String(posting?.externalPath || '').trim();
  if (!/^\/job\/[a-z0-9-]+\/[a-z0-9-]+_JR[a-z0-9-]+$/i.test(externalPath)) return null;

  const title = String(detail?.title || posting?.title || '').replace(/\s+/g, ' ').trim();
  const location = String(detail?.location || posting?.locationsText || '').replace(/\s+/g, ' ').trim();
  const country = String(detail?.country?.descriptor || detail?.country || '').trim();
  const applyUrl = detail?.canApply === true
    ? getGenpactApplyUrl(detail?.externalUrl, externalPath)
    : null;
  const externalJobId = String(detail?.jobReqId || posting?.bulletFields?.[0] || '').trim();

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
    throw new Error('Genpact public jobs API returned an invalid response');
  }
  return response;
}

function validateJobDetailResponse(response) {
  if (!response?.jobPostingInfo || typeof response.jobPostingInfo !== 'object') {
    throw new Error('Genpact public job-details API returned an invalid response');
  }
  return response.jobPostingInfo;
}

async function fetchGenpactJobs(options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  if (options.signal?.aborted) throw new Error('Genpact jobs request aborted');

  const request = async (url, data) => requestJson(url, null, {
    ...options,
    method: 'POST',
    data,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: CAREERS_URL,
      ...(options.headers || {}),
    },
  });

  const facetResponse = validateJobsResponse(await request(JOBS_URL, {
    appliedFacets: {},
    limit: 1,
    offset: 0,
    searchText: '',
  }));
  const indiaLocationIds = getIndiaLocationIds(facetResponse);
  if (indiaLocationIds.length === 0) {
    return { jobs: [], fetched: 0, detailJobsFetched: 0, skippedIndia: 0, pageCount: 1 };
  }

  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  const pageSize = Math.min(PAGE_SIZE, maxJobs);
  let pageCount = 0;
  let fetched = 0;
  let total = null;
  let offset = 0;
  let detailJobsFetched = 0;

  while (jobs.length < maxJobs && (total === null || offset < total)) {
    if (options.signal?.aborted) throw new Error('Genpact jobs request aborted');
    const response = validateJobsResponse(await request(JOBS_URL, {
      appliedFacets: { locations: indiaLocationIds },
      limit: pageSize,
      offset,
      searchText: '',
    }));
    total = Number(response.total);
    const postings = response.jobPostings;
    pageCount += 1;
    fetched += postings.length;

    if (!postings.length && offset < total) {
      throw new Error('Genpact public jobs API returned an incomplete results page');
    }

    for (const posting of postings) {
      const externalPath = String(posting?.externalPath || '').trim();
      if (!/^\/job\/[a-z0-9-]+\/[a-z0-9-]+_JR[a-z0-9-]+$/i.test(externalPath) || seen.has(externalPath)) continue;
      seen.add(externalPath);

      const detailsResponse = await requestJson(`${WORKDAY_API_URL}${externalPath}`, null, {
        ...options,
        headers: {
          Accept: 'application/json',
          Referer: CAREERS_URL,
          ...(options.headers || {}),
        },
      });
      detailJobsFetched += 1;
      const detail = validateJobDetailResponse(detailsResponse);
      const job = normalizeGenpactPosting(posting, detail, metrics);
      if (job) jobs.push(job);
      if (jobs.length >= maxJobs) break;
    }

    offset += postings.length;
    if (postings.length < pageSize) break;
  }

  return { jobs, fetched, detailJobsFetched, skippedIndia: metrics.skippedIndia, pageCount };
}

async function scrapeGenpactJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const response = await fetchGenpactJobs(options);
  logger.info(
    `${COMPANY} public jobs feed completed: fetched=${response.fetched}, indiaEligible=${response.jobs.length}`
  );
  return {
    result: response.jobs,
    stats: {
      pageCount: response.pageCount,
      listingJobsFetched: response.fetched,
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
  fetchGenpactJobs,
  getGenpactApplyUrl,
  getIndiaLocationIds,
  normalizeGenpactPosting,
  scrapeGenpactJobs,
};
