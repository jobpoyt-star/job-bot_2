'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');
const { newPage } = require('./browser');

const COMPANY = 'Darwinbox';
const CAREERS_URL = 'https://dbx.darwinbox.in/ms/candidatev2/main/careers/allJobs';
const JOBS_API_URL = 'https://dbx.darwinbox.in/ms/candidateapi/job/alljobs?companyId=main';
const PAGE_SIZE = 10;

function normalizeDarwinboxPosting(posting, metrics) {
  const id = String(posting?.id || '').trim();
  if (!/^[a-z0-9]+$/i.test(id)) return null;

  const locations = Array.isArray(posting?.tool_tip_locations)
    ? posting.tool_tip_locations
    : Array.isArray(posting?.officelocations_without_area)
      ? posting.officelocations_without_area
      : Array.isArray(posting?.locations)
        ? posting.locations
        : [];
  const location = locations
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' / ')
    || String(posting?.officelocation_show_arr || '').replace(/\s+/g, ' ').trim()
    || null;
  const eligibility = evaluateIndiaEligibility({
    location,
    country: posting?.country || null,
  });
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  const title = String(
    posting?.title || posting?.designation_display_name || posting?.designation_name || ''
  ).replace(/\s+/g, ' ').trim();
  if (!title) return null;

  return {
    title,
    company: COMPANY,
    company_name: COMPANY,
    location: eligibility.persistedLocation,
    country: 'India',
    experience: posting?.experience
      || (posting?.experience_from != null || posting?.experience_to != null
        ? `${posting.experience_from ?? 0}-${posting.experience_to ?? 'unspecified'} years`
        : null),
    employment_type: posting?.emp_type_name || posting?.employee_type || null,
    work_mode: Number(posting?.is_remote) === 1 ? 'Remote' : null,
    salary: posting?.salary_range || null,
    description: posting?.jd || posting?.jd_summary || null,
    summary: posting?.jd_summary || null,
    skills: null,
    apply_url: new URL(
      `/ms/candidatev2/main/careers/jobDetails/${encodeURIComponent(id)}`,
      CAREERS_URL
    ).href,
    source: COMPANY,
    posted_date: normalizePostingDate(posting?.posted_on || posting?.created_on),
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: String(posting?.internal_job_code || id),
  };
}

async function fetchDarwinboxJobs(options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const pageSize = Math.min(PAGE_SIZE, maxJobs);
  const pageFactory = options.newPage || newPage;
  const page = await pageFactory();
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  let pageCount = 0;
  let listingJobsFetched = 0;

  const abortPage = () => {
    page.close().catch(() => {});
  };
  if (options.signal?.aborted) {
    await page.close();
    throw new Error('Darwinbox jobs request aborted');
  }
  options.signal?.addEventListener('abort', abortPage, { once: true });

  try {
    await page.goto(CAREERS_URL, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs || 45000,
    });

    for (let pageNumber = 1; jobs.length < maxJobs; pageNumber += 1) {
      if (options.signal?.aborted) throw new Error('Darwinbox jobs request aborted');
      const response = await page.evaluate(async ({ apiUrl, pageNumber, pageSize, timeoutMs }) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const result = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              companyId: 'main',
              page: pageNumber,
              sort_option: 'new',
              limit: pageSize,
            }),
            signal: controller.signal,
          });
          let data;
          try {
            data = await result.json();
          } catch {
            throw new Error(`Darwinbox public jobs API returned non-JSON data (HTTP ${result.status})`);
          }
          return { status: result.status, data };
        } finally {
          clearTimeout(timeout);
        }
      }, {
        apiUrl: JOBS_API_URL,
        pageNumber,
        pageSize,
        timeoutMs: options.timeoutMs || 20000,
      });

      if (response?.status !== 200 || response.data?.status !== 'success' || !Array.isArray(response.data.data)) {
        throw new Error(`Darwinbox public jobs API returned an invalid response (HTTP ${response?.status || 'unknown'})`);
      }

      const postings = response.data.data;
      pageCount += 1;
      listingJobsFetched += postings.length;
      for (const posting of postings) {
        const id = String(posting?.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const job = normalizeDarwinboxPosting(posting, metrics);
        if (job) jobs.push(job);
        if (jobs.length >= maxJobs) break;
      }
      if (postings.length < pageSize) break;
    }

    return {
      jobs,
      listingJobsFetched,
      skippedIndia: metrics.skippedIndia,
      pageCount,
    };
  } finally {
    options.signal?.removeEventListener('abort', abortPage);
    await page.close();
  }
}

async function scrapeDarwinboxJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const response = await fetchDarwinboxJobs(options);
  logger.info(
    `${COMPANY} public jobs feed completed: fetched=${response.listingJobsFetched}, indiaEligible=${response.jobs.length}`
  );
  return {
    result: response.jobs,
    stats: {
      pageCount: response.pageCount,
      listingJobsFetched: response.listingJobsFetched,
      detailJobsFetched: response.listingJobsFetched,
      recentJobs: response.jobs.length,
      skippedIndia: response.skippedIndia,
      skippedOld: 0,
      stopReason: options.signal?.aborted ? 'timeout' : 'completed',
    },
  };
}

module.exports = {
  CAREERS_URL,
  JOBS_API_URL,
  fetchDarwinboxJobs,
  normalizeDarwinboxPosting,
  scrapeDarwinboxJobs,
};
