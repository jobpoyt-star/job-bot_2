'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');
const { newPage } = require('./browser');

const CAREERS_URL = 'https://sonataone.darwinbox.in/ms/candidatev2/main/careers/allJobs';
const JOBS_API_URL = 'https://sonataone.darwinbox.in/ms/candidateapi/job/alljobs?companyId=main';
const PAGE_SIZE = 10;

function normalizeSonataPosting(posting, metrics) {
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
    posting?.designation_display_name || posting?.title || posting?.designation_name || ''
  ).replace(/\s+/g, ' ').trim();
  if (!title) return null;

  const experience = String(posting?.experience || '').trim()
    || (posting?.experience_from || posting?.experience_to
      ? `${posting.experience_from || 'Unspecified'} - ${posting.experience_to || 'Unspecified'} Years`
      : null);

  return {
    title,
    company: 'Sonata Software',
    company_name: 'Sonata Software',
    location: eligibility.persistedLocation,
    country: 'India',
    experience,
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
    source: 'Sonata Software',
    posted_date: normalizePostingDate(posting?.posted_on || posting?.created_on),
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: String(posting?.internal_job_code || id),
  };
}

async function fetchSonataJobs(options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const pageSize = Math.min(PAGE_SIZE, maxJobs);
  const pageFactory = options.newPage || newPage;
  const page = await pageFactory();
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  let pageCount = 0;
  let fetched = 0;

  const abortPage = () => {
    page.close().catch(() => {});
  };
  if (options.signal?.aborted) {
    await page.close();
    throw new Error('Sonata Software jobs request aborted');
  }
  options.signal?.addEventListener('abort', abortPage, { once: true });

  try {
    await page.goto(CAREERS_URL, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs || 45000,
    });

    for (let pageNumber = 1; jobs.length < maxJobs; pageNumber += 1) {
      if (options.signal?.aborted) throw new Error('Sonata Software jobs request aborted');
      const response = await page.evaluate(async ({ apiUrl, companyId, pageNumber, pageSize, timeoutMs }) => {
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
              companyId,
              page: pageNumber,
              sort_option: 'new',
              limit: pageSize,
            }),
            signal: controller.signal,
          });
          return {
            status: result.status,
            data: await result.json(),
          };
        } finally {
          clearTimeout(timeout);
        }
      }, {
        apiUrl: JOBS_API_URL,
        companyId: 'main',
        pageNumber,
        pageSize,
        timeoutMs: options.timeoutMs || 20000,
      });

      if (response?.status !== 200 || response.data?.status !== 'success' || !Array.isArray(response.data.data)) {
        throw new Error(`Sonata Software public jobs API returned an invalid response (HTTP ${response?.status || 'unknown'})`);
      }

      const postings = response.data.data;
      pageCount += 1;
      fetched += postings.length;
      for (const posting of postings) {
        const id = String(posting?.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const job = normalizeSonataPosting(posting, metrics);
        if (job) jobs.push(job);
        if (jobs.length >= maxJobs) break;
      }
      if (postings.length < pageSize) break;
    }

    return {
      jobs,
      fetched,
      skippedIndia: metrics.skippedIndia,
      pageCount,
    };
  } finally {
    options.signal?.removeEventListener('abort', abortPage);
    await page.close();
  }
}

async function scrapeSonataJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const response = await fetchSonataJobs(options);
  logger.info(
    `Sonata Software public jobs feed completed: fetched=${response.fetched}, indiaEligible=${response.jobs.length}`
  );
  return {
    result: response.jobs,
    stats: {
      pageCount: response.pageCount,
      listingJobsFetched: response.fetched,
      detailJobsFetched: response.fetched,
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
  fetchSonataJobs,
  normalizeSonataPosting,
  scrapeSonataJobs,
};
