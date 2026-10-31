'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');
const { newPage } = require('./browser');

const CAREERS_URL = 'https://careers.atherenergy.com/jobs';
const JOBS_API_URL = 'https://careers.atherenergy.com/api/get-all-jobs';

function normalizeAtherDate(value) {
  const match = String(value || '').trim().match(
    /^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})-(\d{2})-(\d{4})$/
  );
  if (!match) return normalizePostingDate(value);

  const [, hoursText, minutesText, secondsText, dayText, monthText, yearText] = match;
  const [hours, minutes, seconds, day, month, year] = [
    hoursText, minutesText, secondsText, dayText, monthText, yearText,
  ].map(Number);
  const localDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  if (
    Number.isNaN(localDate.getTime())
    || localDate.getUTCFullYear() !== year
    || localDate.getUTCMonth() !== month - 1
    || localDate.getUTCDate() !== day
    || localDate.getUTCHours() !== hours
    || localDate.getUTCMinutes() !== minutes
    || localDate.getUTCSeconds() !== seconds
  ) return null;
  return new Date(localDate.getTime() - (5 * 60 + 30) * 60 * 1000).toISOString();
}

function normalizeAtherPosting(posting, metrics) {
  if (
    Number(posting?.post_on_carrers_page) !== 1
    || String(posting?.group_company || '').trim().toLowerCase() !== 'ather energy limited'
  ) return null;

  const id = String(posting?.openingid || posting?.job_id || '').trim();
  if (!/^[a-z0-9]+$/i.test(id)) return null;

  const title = String(posting?.posting_title || posting?.title || '').replace(/\s+/g, ' ').trim();
  const location = String(posting?.location || posting?.city || '').replace(/\s+/g, ' ').trim();
  const eligibility = evaluateIndiaEligibility({
    location,
    country: posting?.location_country || null,
  });
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }
  if (!title) return null;

  return {
    title,
    company: 'Ather Energy',
    company_name: 'Ather Energy',
    location: eligibility.persistedLocation,
    country: 'India',
    experience: null,
    employment_type: posting?.employee_type || null,
    work_mode: null,
    salary: null,
    description: null,
    summary: null,
    skills: null,
    apply_url: new URL(`/application-form/${encodeURIComponent(id)}`, CAREERS_URL).href,
    source: 'Ather Energy',
    posted_date: normalizeAtherDate(posting?.job_created_timestamp),
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: String(posting?.job_code || id),
  };
}

async function fetchAtherEnergyJobs(options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const pageFactory = options.newPage || newPage;
  const page = await pageFactory();
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };

  const abortPage = () => {
    page.close().catch(() => {});
  };
  if (options.signal?.aborted) {
    await page.close();
    throw new Error('Ather Energy jobs request aborted');
  }
  options.signal?.addEventListener('abort', abortPage, { once: true });

  try {
    await page.goto(CAREERS_URL, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs || 45000,
    });

    if (options.signal?.aborted) throw new Error('Ather Energy jobs request aborted');
    const response = await page.evaluate(async ({ apiUrl, timeoutMs }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await fetch(apiUrl, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        return { status: result.status, body: await result.text() };
      } finally {
        clearTimeout(timeout);
      }
    }, {
      apiUrl: JOBS_API_URL,
      timeoutMs: options.timeoutMs || 20000,
    });

    if (response?.status !== 200) {
      throw new Error(`Ather Energy public jobs API returned HTTP ${response?.status || 'unknown'}`);
    }

    let envelope;
    try {
      envelope = JSON.parse(response.body);
    } catch (error) {
      throw new Error(`Ather Energy public jobs API returned invalid JSON: ${error.message}`);
    }
    if (typeof envelope?.data !== 'string') {
      throw new Error('Ather Energy public jobs API returned an invalid response');
    }

    let groupedPostings;
    try {
      groupedPostings = JSON.parse(envelope.data);
    } catch (error) {
      throw new Error(`Ather Energy jobs payload was invalid JSON: ${error.message}`);
    }
    if (!groupedPostings || typeof groupedPostings !== 'object' || Array.isArray(groupedPostings)) {
      throw new Error('Ather Energy jobs payload did not contain department groups');
    }

    let fetched = 0;
    for (const departmentGroups of Object.values(groupedPostings)) {
      if (!Array.isArray(departmentGroups)) {
        throw new Error('Ather Energy jobs payload contained an invalid department group');
      }
      for (const department of departmentGroups) {
        if (!Array.isArray(department?.jobs)) {
          throw new Error('Ather Energy jobs payload contained an invalid jobs list');
        }
        for (const posting of department.jobs) {
          fetched += 1;
          const id = String(posting?.openingid || posting?.job_id || '').trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const job = normalizeAtherPosting(posting, metrics);
          if (job) jobs.push(job);
          if (jobs.length >= maxJobs) {
            return {
              jobs,
              fetched,
              skippedIndia: metrics.skippedIndia,
              pageCount: 1,
            };
          }
        }
      }
    }

    return {
      jobs,
      fetched,
      skippedIndia: metrics.skippedIndia,
      pageCount: 1,
    };
  } finally {
    options.signal?.removeEventListener('abort', abortPage);
    await page.close();
  }
}

async function scrapeAtherEnergyJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const response = await fetchAtherEnergyJobs(options);
  logger.info(
    `Ather Energy public jobs feed completed: fetched=${response.fetched}, indiaEligible=${response.jobs.length}`
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
  fetchAtherEnergyJobs,
  normalizeAtherDate,
  normalizeAtherPosting,
  scrapeAtherEnergyJobs,
};
