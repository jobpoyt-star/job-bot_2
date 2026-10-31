'use strict';

const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');

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
    url: 'https://boards-api.greenhouse.io/v1/boards/groww/jobs',
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
  zensar: {
    company: 'Zensar Technologies',
    type: 'oracle',
    url: 'https://fa-etvl-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/11.13.18.05/recruitingCEJobRequisitions',
    siteNumber: 'CX_1',
  },
  hexaware: {
    company: 'Hexaware Technologies',
    type: 'oracle',
    url: 'https://fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/11.13.18.05/recruitingCEJobRequisitions',
    siteNumber: 'CX_1',
  },
  cyient: {
    company: 'Cyient',
    type: 'zwayam',
    url: 'https://public.zwayam.com/jobs/search',
    domain: 'careers.cyient.com',
    companyId: 'MTU0ODY=',
    careersUrl: 'https://careers.cyient.com/cyient',
  },
  happiestminds: {
    company: 'Happiest Minds',
    type: 'zwayam',
    url: 'https://public.zwayam.com/jobs/search',
    domain: 'jobs.happiestminds.com',
    companyId: 'MTU5NzQ=',
    careersUrl: 'https://jobs.happiestminds.com/happiestminds',
  },
  coforge: {
    company: 'Coforge',
    type: 'zwayam',
    url: 'https://public.zwayam.com/jobs/search',
    domain: 'careers.coforge.com',
    companyId: 'MTUxNzM=',
    careersUrl: 'https://careers.coforge.com/coforge',
  },
  swiggy: {
    company: 'Swiggy',
    type: 'swiggy',
    url: 'https://careers.swiggy.in/api/jobs.json',
  },
  phonepe: {
    company: 'PhonePe',
    type: 'phonepe',
    url: 'https://www.phonepe.com/apollo/job-postings/latest.json',
  },
  flipkart: {
    company: 'Flipkart',
    type: 'flipkart',
    url: 'https://thapi.azurewebsites.net/api/careerpagev2/filteredjobs',
    tokenUrl: 'https://thapi.azurewebsites.net/api/token/noauth',
    careersUrl: 'https://flipkart.turbohire.co/careerpage/4d757ba0-3d57-448a-b82c-238ed87ac90f',
    organizationId: '4d757ba0-3d57-448a-b82c-238ed87ac90f',
  },
  olaelectric: {
    company: 'Ola Electric',
    type: 'turbohire',
    url: 'https://thapi.azurewebsites.net/api/careerpagev2/filteredjobs',
    tokenUrl: 'https://thapi.azurewebsites.net/api/token/noauth',
    careersUrl: 'https://olacareers.turbohire.co/careerpage/e0c1eb37-eb7a-4ca4-bcc5-d59ce4ce9212',
    organizationId: 'e0c1eb37-eb7a-4ca4-bcc5-d59ce4ce9212',
  },
  makemytrip: {
    company: 'MakeMyTrip',
    type: 'makemytrip',
    url: 'https://careers.makemytrip.com/api/jobs',
    careersUrl: 'https://careers.makemytrip.com/prod/jobs',
    applyUrl: 'https://gommt.darwinbox.in/ms/candidatev2/main/careers/jobDetails',
  },
  zerodha: {
    company: 'Zerodha',
    type: 'zerodha',
    url: 'https://careers.zerodha.com/api/jobs',
    careersUrl: 'https://careers.zerodha.com/',
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
  const request = options.request || ((requestUrl, config) => axios.request({ url: requestUrl, ...config }));
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) throw new Error('Job feed request aborted');
    try {
      const response = await request(url, {
        method: options.method || 'GET',
        params,
        data: options.data,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; JOBPOYTJobBot/1.0)',
          ...(options.headers || {}),
        },
        timeout: options.timeoutMs || REQUEST_TIMEOUT_MS,
        signal: options.signal,
      });
      return response?.data === undefined ? response : response.data;
    } catch (error) {
      const status = Number(error?.response?.status || error?.status || 0);
      const networkErrorCodes = new Set([
        'ECONNABORTED',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EAI_AGAIN',
        'ENOTFOUND',
        'EHOSTUNREACH',
        'ENETUNREACH',
      ]);
      const retryable = RETRYABLE_STATUSES.has(status)
        || networkErrorCodes.has(error?.code)
        || (!status && (Boolean(error?.request) || /network error|fetch failed|socket hang up/i.test(error?.message || '')));
      const retryAfterMs = status === 429 ? getRetryAfterMs(error) : null;
      if (
        !retryable
        || attempt === MAX_REQUEST_ATTEMPTS
        || (status === 429 && (retryAfterMs == null || retryAfterMs > MAX_RETRY_AFTER_MS))
      ) {
        const safeError = new Error(
          status
            ? `Job feed request failed with HTTP ${status}`
            : `Job feed request failed (${retryable ? 'temporary network error' : 'request error'}${error?.code ? `, code ${error.code}` : ''})`
        );
        safeError.status = status || undefined;
        safeError.code = error?.code;
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

function normalizePosting(posting, company, metrics) {
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
    posted_date: normalizePostingDate(posting.postedDate ?? posting.posted_date ?? posting.createdAt),
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: posting.id == null ? applyUrl : String(posting.id),
  };
  const eligibility = evaluateIndiaEligibility(job);
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }
  job.location = eligibility.persistedLocation;
  return job;
}

function normalizeGreenhousePosting(job, company, metrics) {
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
  }, company, metrics);
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

function normalizeLeverPosting(posting, company, metrics) {
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
  }, company, metrics);
}

function normalizeSwiggyPosting(posting, metrics) {
  return normalizePosting({
    id: posting?.u,
    title: posting?.t,
    location: posting?.l,
    employmentType: posting?.e,
    applyUrl: posting?.u,
  }, 'Swiggy', metrics);
}

function normalizePhonePePosting(posting, metrics) {
  if (String(posting?.status || '').toUpperCase() !== 'PUBLIC') return null;

  const applyUrl = String(posting?.applyUrl || '').trim();
  let applyUrlParts;
  try {
    applyUrlParts = new URL(applyUrl);
  } catch {
    return null;
  }
  if (
    applyUrlParts.protocol !== 'https:'
    || applyUrlParts.hostname !== 'jobs.smartrecruiters.com'
    || !/^\/PHONEPELIMITED\/\d+-[a-z0-9-]+\/?$/i.test(applyUrlParts.pathname)
  ) return null;

  return normalizePosting({
    id: applyUrlParts.pathname.match(/^\/PHONEPELIMITED\/(\d+)-/i)?.[1],
    title: posting?.title,
    location: posting?.location,
    employmentType: posting?.type,
    applyUrl: applyUrlParts.href,
  }, 'PhonePe', metrics);
}

function getFlipkartLocation(posting) {
  const value = posting?.Location ?? posting?.location;
  if (typeof value !== 'string') return value || null;
  try {
    const locations = JSON.parse(value);
    if (!Array.isArray(locations)) return value;
    return locations
      .map((location) => String(location?.Address || '').trim())
      .filter(Boolean)
      .join(' / ') || null;
  } catch {
    return value;
  }
}

function normalizeTurboHirePosting(posting, feed, metrics) {
  const organizationName = String(posting?.OrgDetails?.OrgName || '').trim().toLowerCase();
  if (feed.organizationName && organizationName !== feed.organizationName.toLowerCase()) return null;

  const obfuscatedId = String(posting?.JobIdObfuscated || '').trim();
  if (!/^[a-z0-9_-]+(?:%2f[a-z0-9_-]+)*$/i.test(obfuscatedId)) return null;
  const location = getFlipkartLocation(posting);
  const eligibility = evaluateIndiaEligibility({ location });
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  const jobId = String(posting?.JobId || '').trim();
  const jobCode = String(posting?.JobCode || '').trim();
  const title = String(posting?.JobTitle || '').replace(/\s+/g, ' ').trim();
  if (!jobId || !jobCode || !title) return null;

  const detailUrl = new URL(`/job/publicjobs/${obfuscatedId}`, feed.careersUrl);
  const experience = posting?.Experience || {};
  const minExperience = Number(experience.MinExp);
  const maxExperience = Number(experience.MaxExp);
  const experienceText = Number.isFinite(minExperience) && Number.isFinite(maxExperience)
    ? `${minExperience}-${maxExperience} years`
    : Number.isFinite(minExperience)
      ? `${minExperience}+ years`
      : null;

  return {
    title,
    company: feed.company,
    company_name: feed.company,
    location: eligibility.persistedLocation,
    country: 'India',
    experience: experienceText,
    employment_type: posting.Type && posting.Type !== 'UNSPECIFIED' ? posting.Type : null,
    work_mode: null,
    salary: null,
    description: posting.JobDescV2 || null,
    summary: null,
    skills: Array.isArray(posting.Skills) ? posting.Skills.join(', ') || null : null,
    apply_url: detailUrl.href,
    source: feed.company,
    posted_date: normalizePostingDate(posting.PublishedDate),
    expiry_date: normalizePostingDate(posting.ExpiryDates?.CAREERPAGE),
    status: 'active',
    is_active: true,
    external_job_id: jobCode,
  };
}

function normalizeFlipkartPosting(posting, feed, metrics) {
  return normalizeTurboHirePosting(posting, {
    ...feed,
    organizationName: 'Flipkart Internet Private Limited',
  }, metrics);
}

function normalizeZerodhaPosting(posting, feed, metrics) {
  const id = String(posting?.name || posting?.id || '').trim();
  const applyUrl = new URL(feed.careersUrl);
  return normalizePosting({
    id,
    title: posting?.job_title,
    location: posting?.location,
    workMode: posting?.location_type,
    description: posting?.description,
    applyUrl: applyUrl.href,
  }, feed.company, metrics);
}

function normalizeOraclePosting(posting, feed, metrics) {
  const country = String(posting?.PrimaryLocationCountry || '').trim().toUpperCase();
  if (country !== 'IN' && country !== 'INDIA') {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  return normalizePosting({
    id: posting?.Id,
    title: posting?.Title,
    location: posting?.PrimaryLocation || 'India',
    country,
    description: posting?.ShortDescriptionStr,
    applyUrl: posting?.Id
      ? `${new URL(feed.url).origin}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(feed.siteNumber)}/job/${encodeURIComponent(posting.Id)}`
      : null,
    postedDate: posting?.PostedDate,
  }, feed.company, metrics);
}

function normalizeCyientPosting(posting, feed, metrics) {
  const jobUrl = String(posting?.jobUrl || '').trim();
  if (!/^[a-z0-9-]+$/i.test(jobUrl)) return null;

  return normalizePosting({
    id: posting?.referenceNumber || posting?.jobCode,
    title: posting?.jobTitle,
    location: posting?.locationSeparatedbySlash || posting?.location || posting?.city,
    description: posting?.mediumDescriptionWithoutHtml || posting?.shortDescriptionWithoutHtml,
    applyUrl: `${feed.careersUrl}/jobview/${encodeURIComponent(jobUrl)}`,
    postedDate: posting?.createdDate || posting?.jobCreatedDate || posting?.startDate,
  }, feed.company, metrics);
}

async function fetchGreenhouseJobs(feed, options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const data = await requestJson(feed.url, {}, options);
  const postings = Array.isArray(data?.jobs) ? data.jobs : [];
  const seen = new Set();
  const jobs = [];
  const metrics = { skippedIndia: 0 };
  for (const posting of postings) {
    const id = String(posting?.id || posting?.absolute_url || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const normalized = normalizeGreenhousePosting(posting, feed.company, metrics);
    if (normalized) jobs.push(normalized);
    if (jobs.length >= maxJobs) break;
  }
  return { jobs, fetched: seen.size, skippedIndia: metrics.skippedIndia };
}

async function fetchOracleJobs(feed, options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const pageSize = Math.min(maxJobs, 100);
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  let offset = 0;
  let totalJobs = Infinity;
  let pageCount = 0;
  let fetched = 0;

  while (jobs.length < maxJobs && offset < totalJobs) {
    const data = await requestJson(feed.url, {
      onlyData: 'true',
      expand: 'requisitionList',
      finder: `findReqs;siteNumber=${feed.siteNumber},limit=${pageSize},offset=${offset}`,
    }, options);
    const result = Array.isArray(data?.items) ? data.items[0] : null;
    const postings = Array.isArray(result?.requisitionList) ? result.requisitionList : [];
    pageCount += 1;
    totalJobs = Number(result?.TotalJobsCount);
    if (!postings.length) break;

    fetched += postings.length;
    for (const posting of postings) {
      const id = String(posting?.Id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const job = normalizeOraclePosting(posting, feed, metrics);
      if (job) jobs.push(job);
      if (jobs.length >= maxJobs) break;
    }

    offset += postings.length;
  }

  return { jobs, fetched, skippedIndia: metrics.skippedIndia, pageCount };
}

async function fetchZwayamJobs(feed, options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  let offset = 0;
  let pageCount = 0;
  let fetched = 0;
  let hasMoreData = true;

  while (jobs.length < maxJobs && hasMoreData) {
    const createForm = () => {
      const form = options.request ? new FormData() : new globalThis.FormData();
      form.append('filterCri', JSON.stringify({
        paginationStartNo: offset,
        selectedCall: 'sort',
        sortCriteria: { name: 'modifiedDate', isAscending: false },
        anyOfTheseWords: '',
      }));
      form.append('domain', feed.domain);
      form.append('companyId', feed.companyId);
      return form;
    };

    const request = options.request
      ? (url, config) => options.request(url, { ...config, data: createForm() })
      : async (url, config) => {
        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, config.timeout);
        const abortFromCaller = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted) abortFromCaller();
        else options.signal?.addEventListener('abort', abortFromCaller, { once: true });

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: Object.fromEntries(
              Object.entries(config.headers || {})
                .filter(([name]) => name.toLowerCase() !== 'user-agent')
            ),
            body: createForm(),
            signal: controller.signal,
          });
          if (!response.ok) {
            const error = new Error(`Job feed request failed with HTTP ${response.status}`);
            error.response = { status: response.status, headers: response.headers };
            throw error;
          }
          return { data: await response.json() };
        } catch (error) {
          if (timedOut) {
            const timeoutError = new Error('Job feed request timed out');
            timeoutError.code = 'ECONNABORTED';
            timeoutError.cause = error;
            throw timeoutError;
          }
          throw error;
        } finally {
          clearTimeout(timeout);
          options.signal?.removeEventListener('abort', abortFromCaller);
        }
      };
    const response = await requestJson(feed.url, null, { ...options, request });
    const payload = response?.data || {};
    const postings = Array.isArray(payload.data) ? payload.data : [];
    pageCount += 1;
    fetched += postings.length;

    for (const item of postings) {
      const posting = item?._source;
      const id = String(posting?.referenceNumber || posting?.jobCode || posting?.jobUrl || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const job = normalizeCyientPosting(posting, feed, metrics);
      if (job) jobs.push(job);
      if (jobs.length >= maxJobs) break;
    }

    offset += postings.length;
    hasMoreData = payload.hasMoreData === true && postings.length > 0;
  }

  return { jobs, fetched, skippedIndia: metrics.skippedIndia, pageCount };
}

async function fetchLeverJobs(feed, options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
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
      const normalized = normalizeLeverPosting(posting, feed.company, metrics);
      if (normalized) jobs.push(normalized);
      if (jobs.length >= maxJobs) break;
    }
    if (!newJobs || data.length < limit) break;
    skip += data.length;
  }
  return { jobs, fetched: seen.size, skippedIndia: metrics.skippedIndia };
}

async function fetchSwiggyJobs(feed, options = {}) {
  const data = await requestJson(feed.url, {}, options);
  const postings = Array.isArray(data?.jobs) ? data.jobs : [];
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const seen = new Set();
  const jobs = [];
  const metrics = { skippedIndia: 0 };
  for (const posting of postings) {
    const key = String(posting?.u || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const normalized = normalizeSwiggyPosting(posting, metrics);
    if (normalized) jobs.push(normalized);
    if (jobs.length >= maxJobs) break;
  }
  return { jobs, fetched: seen.size, skippedIndia: metrics.skippedIndia };
}

async function fetchPhonePeJobs(feed, options = {}) {
  const data = await requestJson(feed.url, {}, options);
  const postings = Array.isArray(data?.results) ? data.results : [];
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const seen = new Set();
  const jobs = [];
  const metrics = { skippedIndia: 0 };
  for (const posting of postings) {
    if (String(posting?.status || '').toUpperCase() !== 'PUBLIC') continue;
    const key = String(posting?.applyUrl || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const normalized = normalizePhonePePosting(posting, metrics);
    if (normalized) jobs.push(normalized);
    if (jobs.length >= maxJobs) break;
  }
  return { jobs, fetched: seen.size, skippedIndia: metrics.skippedIndia };
}

async function fetchTurboHireJobs(feed, options = {}) {
  const portalOrigin = new URL(feed.careersUrl).origin;
  const portalHeaders = {
    Origin: portalOrigin,
    Referer: feed.careersUrl,
  };
  const tokenData = await requestJson(feed.tokenUrl, {}, {
    ...options,
    headers: portalHeaders,
  });
  const accessToken = String(tokenData?.access_token || '').trim();
  if (!accessToken) throw new Error(`${feed.company} public jobs API did not return an access token`);

  const requestBody = {
    SortByV2: { Key: 'PostedDate', Order: 2 },
    BunitIds: { Value: null, FilterType: 0 },
    Experience: { Value: null, FilterType: 0 },
    JobTypes: { Value: null, FilterType: 0 },
    JobTypeV2: { Value: null, FilterType: 0 },
    Locations: { Value: null, FilterType: 0 },
    CreatedDate: { Value: null, FilterType: 0 },
    Compensation: { Value: null, FilterType: 0 },
    Skills: { Value: null, FilterType: 0 },
    Keyword: '',
    ClientIds: { Value: null, FilterType: 0 },
    Department: '',
    CustomFields: {},
  };
  const query = new URLSearchParams({
    orgId: feed.organizationId,
    pageType: '0',
  });
  const data = await requestJson(`${feed.url}?${query}`, null, {
    ...options,
    method: 'POST',
    data: requestBody,
    headers: {
      ...portalHeaders,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const postings = Array.isArray(data?.Result) ? data.Result : [];
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const metrics = { skippedIndia: 0 };
  const jobs = [];
  const seen = new Set();
  for (const posting of postings) {
    const id = String(posting?.JobId || posting?.JobCode || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const normalized = feed.type === 'flipkart'
      ? normalizeFlipkartPosting(posting, feed, metrics)
      : normalizeTurboHirePosting(posting, feed, metrics);
    if (normalized) jobs.push(normalized);
    if (jobs.length >= maxJobs) break;
  }
  return {
    jobs,
    fetched: postings.length,
    skippedIndia: metrics.skippedIndia,
  };
}

async function fetchFlipkartJobs(feed, options = {}) {
  return fetchTurboHireJobs(feed, options);
}

async function fetchZerodhaJobs(feed, options = {}) {
  const data = await requestJson(feed.url, {}, options);
  if (data?.success !== true || !Array.isArray(data.data)) {
    throw new Error('Zerodha public jobs API returned an invalid response');
  }

  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  for (const posting of data.data) {
    const id = String(posting?.name || posting?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const job = normalizeZerodhaPosting(posting, feed, metrics);
    if (job) jobs.push(job);
    if (jobs.length >= maxJobs) break;
  }
  return { jobs, fetched: data.data.length, skippedIndia: metrics.skippedIndia };
}

function normalizeMakeMyTripPosting(posting, feed, metrics) {
  if (
    Number(posting?.post_on_careers_page) !== 1
    || String(posting?.group_company || '').trim().toLowerCase() !== 'makemytrip (india) limited'
  ) return null;

  const id = String(posting?.job_id || '').trim();
  if (!/^[a-z0-9]+$/i.test(id)) return null;

  const locationValue = posting?.location;
  const location = Array.isArray(locationValue)
    ? locationValue.map((value) => String(value || '').trim()).filter(Boolean).join(' / ')
    : String(locationValue || '').trim();
  const eligibility = evaluateIndiaEligibility({
    location,
    country: posting?.location_country || null,
  });
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  const title = String(posting?.job_title || '').replace(/\s+/g, ' ').trim();
  const jobCode = String(posting?.job_code || '').trim();
  if (!title || !jobCode) return null;

  const experienceFromValue = String(posting?.experience_from ?? '').trim();
  const experienceToValue = String(posting?.experience_to ?? '').trim();
  const experienceFrom = experienceFromValue ? Number(experienceFromValue) : NaN;
  const experienceTo = experienceToValue ? Number(experienceToValue) : NaN;
  const experience = Number.isFinite(experienceFrom) && Number.isFinite(experienceTo)
    ? `${experienceFrom}-${experienceTo} years`
    : Number.isFinite(experienceFrom)
      ? `${experienceFrom}+ years`
      : Number.isFinite(experienceTo)
        ? `Up to ${experienceTo} years`
        : null;

  return {
    title,
    company: feed.company,
    company_name: feed.company,
    location: eligibility.persistedLocation,
    country: 'India',
    experience,
    employment_type: posting?.employee_type || null,
    work_mode: Number(posting?.is_remote) === 1 ? 'Remote' : null,
    salary: null,
    description: posting?.job_description || posting?.job_description_html || null,
    summary: null,
    skills: null,
    apply_url: `${feed.applyUrl}/${encodeURIComponent(id)}?from=all`,
    source: feed.company,
    posted_date: null,
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: jobCode,
  };
}

async function fetchCompanyJobs(companyKey, options = {}) {
  const feed = FEEDS[companyKey];
  if (!feed) throw new Error(`No verified job feed configured for ${companyKey}`);
  let result;
  if (feed.type === 'greenhouse') result = await fetchGreenhouseJobs(feed, options);
  else if (feed.type === 'lever') result = await fetchLeverJobs(feed, options);
  else if (feed.type === 'oracle') result = await fetchOracleJobs(feed, options);
  else if (feed.type === 'zwayam') result = await fetchZwayamJobs(feed, options);
  else if (feed.type === 'phonepe') result = await fetchPhonePeJobs(feed, options);
  else if (feed.type === 'flipkart' || feed.type === 'turbohire') {
    result = await fetchTurboHireJobs(feed, options);
  }
  else if (feed.type === 'makemytrip') result = await fetchMakeMyTripJobs(feed, options);
  else if (feed.type === 'zerodha') result = await fetchZerodhaJobs(feed, options);
  else result = await fetchSwiggyJobs(feed, options);

  return {
    ...result,
    stats: {
      pageCount: result.pageCount || (feed.type === 'lever' ? Math.ceil(result.fetched / Math.min(50, Number(options.maxJobs) || 100)) : 1),
      listingJobsFetched: result.fetched,
      detailJobsFetched: result.fetched,
      recentJobs: result.jobs.length,
      skippedIndia: result.skippedIndia,
      skippedOld: 0,
      stopReason: options.signal?.aborted ? 'timeout' : 'completed',
    },
  };
}

async function fetchMakeMyTripJobs(feed, options = {}) {
  const data = await requestJson(feed.url, {}, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Referer: 'https://careers.makemytrip.com/',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!Array.isArray(data?.allJobs)) {
    throw new Error('MakeMyTrip public jobs API returned an invalid response');
  }

  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  for (const posting of data.allJobs) {
    const id = String(posting?.job_id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const job = normalizeMakeMyTripPosting(posting, feed, metrics);
    if (job) jobs.push(job);
    if (jobs.length >= maxJobs) break;
  }
  return {
    jobs,
    fetched: seen.size,
    skippedIndia: metrics.skippedIndia,
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
  fetchOracleJobs,
  fetchLeverJobs,
  fetchSwiggyJobs,
  fetchPhonePeJobs,
  fetchTurboHireJobs,
  fetchFlipkartJobs,
  fetchZerodhaJobs,
  fetchMakeMyTripJobs,
  normalizeGreenhousePosting,
  normalizeLeverPosting,
  normalizeSwiggyPosting,
  normalizePhonePePosting,
  normalizeTurboHirePosting,
  normalizeFlipkartPosting,
  normalizeZerodhaPosting,
  normalizeMakeMyTripPosting,
  normalizeOraclePosting,
  normalizeCyientPosting,
  fetchZwayamJobs,
  requestJson,
  ...scrapers,
};
