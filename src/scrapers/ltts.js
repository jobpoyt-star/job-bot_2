'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');
const { requestJson } = require('./verifiedProductFeeds');

const COMPANY = 'L&T Technology Services';
const CAREERS_URL = 'https://www.ltts.com/careers';
const JOBS_URL = 'https://jobs.ltts.com/search/';
const INDIA_JOBS_URL = `${JOBS_URL}?createNewAlert=false&q=&locationsearch=India`;
const PAGE_SIZE = 10;

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function normalizeText(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function getCellText(row, className) {
  const cell = row.match(new RegExp(`<td\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`, 'i'));
  return cell ? normalizeText(cell[1]) : '';
}

function getLttsApplyUrl(href) {
  try {
    const url = new URL(String(href || ''), JOBS_URL);
    if (
      url.protocol !== 'https:'
      || url.hostname !== 'jobs.ltts.com'
      || !/^\/job\/[a-z0-9()%._-]+\/\d+\/?$/i.test(url.pathname)
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseLttsListing(html) {
  if (typeof html !== 'string') {
    throw new Error('LTTS public jobs page returned an invalid response');
  }

  const totalMatch = html.match(/class=["']paginationLabel["'][^>]*>[\s\S]*?\bof\s*<b>([\d,]+)<\/b>/i);
  if (!totalMatch) {
    throw new Error('LTTS public jobs page did not include a results count');
  }
  const total = Number(totalMatch[1].replace(/,/g, ''));
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('LTTS public jobs page returned an invalid results count');
  }

  const rows = [...html.matchAll(/<tr\b[^>]*class=["'][^"']*\bdata-row\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(([, row]) => {
      const link = row.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bjobTitle-link\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
        || row.match(/<a\b[^>]*class=["'][^"']*\bjobTitle-link\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!link) return null;

      return {
        title: normalizeText(link[2]),
        detailHref: decodeHtml(link[1]),
        requisitionId: getCellText(row, 'colFacility'),
        postedDate: getCellText(row, 'colDate'),
        location: getCellText(row, 'colLocation'),
      };
    })
    .filter(Boolean);

  if (rows.length > total) {
    throw new Error('LTTS public jobs page returned more postings than its results count');
  }

  return { rows, total };
}

function normalizeLttsPosting(posting, metrics) {
  const title = normalizeText(posting?.title);
  const requisitionId = String(posting?.requisitionId || '').trim();
  const applyUrl = getLttsApplyUrl(posting?.detailHref);
  if (!title || !/^[a-z0-9-]+$/i.test(requisitionId) || !applyUrl) return null;

  const location = normalizeText(posting?.location);
  const countrySuffix = location.match(/(?:^|,\s*)([A-Z]{2,3})$/)?.[1]
    || (/\bIndia$/i.test(location) ? 'India' : null);
  const eligibility = evaluateIndiaEligibility({ location, country: countrySuffix });
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  const jobId = new URL(applyUrl).pathname.match(/\/(\d+)\/?$/)?.[1];
  if (!jobId) return null;

  return {
    title,
    company: COMPANY,
    company_name: COMPANY,
    location: eligibility.persistedLocation,
    country: 'India',
    experience: null,
    employment_type: null,
    work_mode: null,
    salary: null,
    description: null,
    summary: null,
    skills: null,
    apply_url: applyUrl,
    source: COMPANY,
    posted_date: normalizePostingDate(posting?.postedDate),
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: requisitionId,
  };
}

async function fetchLttsJobs(options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  let offset = 0;
  let total = Infinity;
  let pageCount = 0;
  let fetched = 0;

  while (jobs.length < maxJobs && offset < total) {
    if (options.signal?.aborted) throw new Error('LTTS jobs request aborted');
    const html = await requestJson(JOBS_URL, {
      createNewAlert: 'false',
      q: '',
      locationsearch: 'India',
      startrow: offset,
    }, options);
    const page = parseLttsListing(html);
    pageCount += 1;
    total = page.total;
    if (!page.rows.length) {
      if (offset < total) throw new Error('LTTS public jobs page returned no postings before the results ended');
      break;
    }

    fetched += page.rows.length;
    for (const posting of page.rows) {
      const id = String(posting.requisitionId || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const job = normalizeLttsPosting(posting, metrics);
      if (job) jobs.push(job);
      if (jobs.length >= maxJobs) break;
    }
    offset += page.rows.length;
  }

  return { jobs, fetched, skippedIndia: metrics.skippedIndia, pageCount };
}

async function scrapeLttsJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const response = await fetchLttsJobs(options);
  logger.info(
    `${COMPANY} public jobs feed completed: fetched=${response.fetched}, indiaEligible=${response.jobs.length}`
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
  INDIA_JOBS_URL,
  JOBS_URL,
  fetchLttsJobs,
  getLttsApplyUrl,
  normalizeLttsPosting,
  parseLttsListing,
  scrapeLttsJobs,
};
