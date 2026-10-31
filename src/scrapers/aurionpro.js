'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');
const { requestJson } = require('./verifiedProductFeeds');

const COMPANY = 'Aurionpro Solutions';
const CAREERS_URL = 'https://www.aurionpro.com/careers/';
const CAREER_CLIENT_KEY = 'AHJX1-HGSAB-BSHB1';
const JOBS_URL = 'https://mservices.zinghr.com/recruitment/api/v1/CareerConfig/GetCareerJobPostings';
const JOB_DETAILS_URL = 'https://mservices.zinghr.com/recruitment/api/v1/CareerConfig/GetJobDescriptionByRequisitionId';
const PAGE_SIZE = 50;

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function getHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function getCountry(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return value.name || value.countryName || value.display || '';
  }
  return '';
}

function normalizeAurionproPosting(posting, detail, metrics) {
  const title = normalizeText(detail?.jobTitle || posting?.jobTitle);
  const location = normalizeText(detail?.location || posting?.location);
  const country = normalizeText(getCountry(detail?.country || posting?.country));
  const applyUrl = detail?.isCandidateApplyOnBoardingForm === true
    ? getHttpsUrl(detail?.candidateApplyLink)
    : null;
  const requisitionId = String(detail?.requisitionId || posting?.requisitionId || '').trim();

  if (!title || !location || !requisitionId || !applyUrl) return null;

  const eligibility = evaluateIndiaEligibility({ location, country });
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  const description = normalizeText(detail?.jobDescription);
  const skills = normalizeText(detail?.skillsAndCompetencies);

  return {
    title,
    company: COMPANY,
    company_name: COMPANY,
    location: eligibility.persistedLocation,
    country: 'India',
    experience: normalizeText(detail?.experience) || null,
    employment_type: normalizeText(detail?.eT_Desc || detail?.employementType) || null,
    work_mode: null,
    salary: null,
    description: description || null,
    summary: null,
    skills: skills || null,
    apply_url: applyUrl,
    source: COMPANY,
    posted_date: normalizePostingDate(detail?.startDate || posting?.startDate),
    expiry_date: normalizePostingDate(detail?.endDate || posting?.endDate),
    status: 'active',
    is_active: true,
    external_job_id: requisitionId,
  };
}

function validateListingResponse(response) {
  if (
    response?.code !== 1
    || !response.data
    || !Array.isArray(response.data.careerJobPostings)
    || !Number.isInteger(Number(response.data.totalCount))
  ) {
    throw new Error('Aurionpro public jobs API returned an invalid response');
  }
  return response.data;
}

function validateDetailResponse(response) {
  if (response?.code !== 1 || !response.data || typeof response.data !== 'object') {
    throw new Error('Aurionpro public job-details API returned an invalid response');
  }
  return response.data;
}

async function fetchAurionproJobs(options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  if (options.signal?.aborted) throw new Error('Aurionpro jobs request aborted');

  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  let pageIndex = 1;
  let pageCount = 0;
  let listingJobsFetched = 0;
  let detailJobsFetched = 0;
  let totalCount = null;

  while (totalCount === null || listingJobsFetched < totalCount) {
    if (options.signal?.aborted) throw new Error('Aurionpro jobs request aborted');
    const response = await requestJson(JOBS_URL, {
      careerClientKey: CAREER_CLIENT_KEY,
      pageIndex,
      pageSize: PAGE_SIZE,
      searchText: '',
    }, {
      ...options,
      headers: {
        Referer: CAREERS_URL,
        ...(options.headers || {}),
      },
    });
    const data = validateListingResponse(response);
    const postings = data.careerJobPostings;
    totalCount = Number(data.totalCount);
    pageCount += 1;
    listingJobsFetched += postings.length;

    for (const posting of postings) {
      const requisitionId = String(posting?.requisitionId || '').trim();
      if (!requisitionId || seen.has(requisitionId)) continue;
      seen.add(requisitionId);

      const detailResponse = await requestJson(JOB_DETAILS_URL, {
        careerClientKey: CAREER_CLIENT_KEY,
        requisitionId,
      }, {
        ...options,
        headers: {
          Referer: CAREERS_URL,
          ...(options.headers || {}),
        },
      });
      detailJobsFetched += 1;
      const detail = validateDetailResponse(detailResponse);
      const job = normalizeAurionproPosting(posting, detail, metrics);
      if (job) jobs.push(job);
      if (jobs.length >= maxJobs) break;
    }

    if (!postings.length || jobs.length >= maxJobs) break;
    pageIndex += 1;
  }

  return {
    jobs,
    listingJobsFetched,
    detailJobsFetched,
    skippedIndia: metrics.skippedIndia,
    pageCount,
  };
}

async function scrapeAurionproJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const response = await fetchAurionproJobs(options);
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
  CAREER_CLIENT_KEY,
  CAREERS_URL,
  JOBS_URL,
  JOB_DETAILS_URL,
  fetchAurionproJobs,
  normalizeAurionproPosting,
  scrapeAurionproJobs,
};
