'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');
const { newPage: createPage } = require('./browser');

const CAREERS_HOST = 'jobs.birlasoft.com';
const CAREERS_BASE_URL = `https://${CAREERS_HOST}`;
const CAREERS_SEARCH_URL = `${CAREERS_BASE_URL}/search/`;
const PAGE_SIZE = 25;
const DEFAULT_MAX_JOBS = 100;
const DEFAULT_TIMEOUT_MS = 30000;

function normalizeBirlasoftPosting(posting) {
  if (!posting || typeof posting !== 'object') return null;

  const title = String(posting.title || '').replace(/\s+/g, ' ').trim();
  const location = String(posting.location || '').replace(/\s+/g, ' ').trim();
  let jobUrl;
  let applyUrl;

  try {
    jobUrl = new URL(String(posting.url || ''), CAREERS_BASE_URL);
    applyUrl = new URL(String(posting.applyUrl || ''), CAREERS_BASE_URL);
  } catch {
    return null;
  }

  const jobId = jobUrl.pathname.match(/^\/job\/[^/]+\/(\d+)\/?$/i)?.[1];
  const applyJobId = applyUrl.pathname.match(/^\/talentcommunity\/apply\/(\d+)\/?$/i)?.[1];
  const country = String(posting.country || '').trim().toUpperCase();
  if (
    !title
    || jobUrl.protocol !== 'https:'
    || jobUrl.hostname !== CAREERS_HOST
    || applyUrl.protocol !== 'https:'
    || applyUrl.hostname !== CAREERS_HOST
    || !jobId
    || jobId !== applyJobId
    || (country !== 'IN' && country !== 'INDIA')
  ) return null;

  const eligibility = evaluateIndiaEligibility({ location, country });
  if (!eligibility.eligible) return null;

  return {
    title,
    company: 'Birlasoft',
    company_name: 'Birlasoft',
    location: eligibility.persistedLocation,
    country: 'India',
    experience: null,
    employment_type: null,
    work_mode: posting.workMode || null,
    salary: null,
    description: posting.description || null,
    summary: null,
    skills: null,
    apply_url: applyUrl.href,
    source: 'Birlasoft',
    posted_date: normalizePostingDate(posting.postedDate),
    expiry_date: normalizePostingDate(posting.expiryDate),
    status: 'active',
    is_active: true,
    external_job_id: jobId,
  };
}

function buildSearchUrl(startRow) {
  const url = new URL(CAREERS_SEARCH_URL);
  url.searchParams.set('q', '');
  url.searchParams.set('locationsearch', 'India');
  if (startRow > 0) url.searchParams.set('startrow', String(startRow));
  return url.href;
}

async function scrapeBirlasoftJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const page = await (options.createPage || createPage)();
  const maxJobsValue = Number(options.maxJobs || DEFAULT_MAX_JOBS);
  const maxJobs = Number.isFinite(maxJobsValue) && maxJobsValue > 0
    ? Math.floor(maxJobsValue)
    : DEFAULT_MAX_JOBS;
  const timeout = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const stats = {
    pageCount: 0,
    listingJobsFetched: 0,
    detailJobsFetched: 0,
    recentJobs: 0,
    skippedIndia: 0,
    failed: 0,
    stopReason: 'completed',
  };
  const listings = new Map();
  const jobs = [];

  try {
    let startRow = 0;
    while (listings.size < maxJobs) {
      if (options.signal?.aborted) {
        stats.stopReason = 'aborted';
        break;
      }

      await page.goto(buildSearchUrl(startRow), { waitUntil: 'domcontentloaded', timeout });
      await page.waitForSelector('#searchresults', { timeout });
      const rows = await page.$$eval('tr.data-row', (items) => items.map((row) => {
        const link = row.querySelector('a.jobTitle-link[href*="/job/"]');
        const cells = [...row.querySelectorAll('td')];
        return {
          title: link?.textContent?.trim() || null,
          url: link?.href || null,
          location: cells[2]?.innerText?.trim() || null,
          postedDate: cells[3]?.innerText?.trim() || null,
          workMode: cells[4]?.innerText?.trim() || null,
        };
      }).filter((posting) => posting.title && posting.url));

      stats.pageCount += 1;
      stats.listingJobsFetched += rows.length;
      for (const listing of rows) {
        listings.set(listing.url, listing);
        if (listings.size >= maxJobs) break;
      }

      if (rows.length < PAGE_SIZE || listings.size >= maxJobs) break;
      startRow += PAGE_SIZE;
    }

    for (const listing of [...listings.values()].slice(0, maxJobs)) {
      if (options.signal?.aborted) {
        stats.stopReason = 'aborted';
        break;
      }

      try {
        await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForSelector('.jobDisplayShell', { timeout, state: 'attached' });
        const detail = await page.$$eval('.jobDisplayShell', (shells) => {
          const shell = shells[0];
          const getMetaContent = (name) => shell
            ?.querySelector(`meta[itemprop="${name}"]`)
            ?.getAttribute('content') || null;
          return {
            country: getMetaContent('addressCountry'),
            postedDate: getMetaContent('datePosted'),
            expiryDate: getMetaContent('validThrough'),
            applyUrl: shell?.querySelector('a.apply[href]')?.href || null,
            description: shell?.querySelector('[itemprop="description"]')?.innerText?.trim() || null,
          };
        });
        stats.detailJobsFetched += 1;
        const job = normalizeBirlasoftPosting({
          ...listing,
          ...detail,
          postedDate: detail.postedDate || listing.postedDate,
        });
        if (job) jobs.push(job);
        else stats.skippedIndia += 1;
      } catch (error) {
        if (options.signal?.aborted) {
          stats.stopReason = 'aborted';
          break;
        }
        stats.failed += 1;
        logger.warn(`Birlasoft job detail failed url=${listing.url}: ${error.message}`);
      }
    }
  } finally {
    await page.close();
  }

  stats.recentJobs = jobs.length;
  return { result: jobs, stats };
}

module.exports = {
  CAREERS_SEARCH_URL,
  normalizeBirlasoftPosting,
  scrapeBirlasoftJobs,
};
