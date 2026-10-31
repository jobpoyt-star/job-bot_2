'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { newPage: createPage } = require('./browser');

const CAREERS_URL = 'https://careers.zohocorp.com/jobs/Careers';
const DEFAULT_MAX_JOBS = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

function normalizeRecruitPosting(posting, {
  company = 'Zoho',
  careersHost = 'careers.zohocorp.com',
} = {}) {
  if (!posting || typeof posting !== 'object') return null;

  const title = String(posting.title || '').replace(/\s+/g, ' ').trim();
  const applyUrl = String(posting.url || '').trim();
  let applyUrlParts;
  try {
    applyUrlParts = new URL(applyUrl);
  } catch {
    return null;
  }
  if (
    !title
    || applyUrlParts.protocol !== 'https:'
    || applyUrlParts.hostname !== careersHost
    || !/^\/jobs\/Careers\/\d+\//i.test(applyUrlParts.pathname)
  ) return null;

  const eligibility = evaluateIndiaEligibility({
    location: posting.country || null,
    country: posting.country || null,
  });
  if (!eligibility.eligible) return null;

  return {
    title,
    company,
    company_name: company,
    location: eligibility.persistedLocation,
    country: posting.country,
    experience: null,
    employment_type: posting.employmentType || null,
    work_mode: null,
    salary: null,
    description: posting.description || null,
    summary: null,
    skills: null,
    apply_url: applyUrl,
    source: company,
    posted_date: null,
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: applyUrl.match(/\/jobs\/Careers\/(\d+)\//i)?.[1] || null,
  };
}

async function scrapeZohoJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const page = await (options.createPage || createPage)();
  const company = options.company || 'Zoho';
  const careersHost = options.careersHost || 'careers.zohocorp.com';
  const careersUrl = options.careersUrl || CAREERS_URL;
  const maxJobsValue = Number(options.maxJobs || DEFAULT_MAX_JOBS);
  const maxJobs = Number.isFinite(maxJobsValue) && maxJobsValue > 0
    ? Math.floor(maxJobsValue)
    : DEFAULT_MAX_JOBS;
  const timeout = Number(options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
  const stats = {
    pageCount: 1,
    listingJobsFetched: 0,
    detailJobsFetched: 0,
    recentJobs: 0,
    skippedIndia: 0,
    failed: 0,
    stopReason: 'completed',
  };
  const jobs = [];

  try {
    await page.goto(careersUrl, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForSelector('a[href*="/jobs/Careers/"]', { timeout });
    const listings = await page.$$eval('a[href*="/jobs/Careers/"]', (links, expectedHost) => links.map((link) => {
      const card = link.closest('.joblist-card') || link.parentElement?.parentElement?.parentElement;
      if (new URL(link.href).hostname !== expectedHost) return null;
      return {
        title: link.textContent?.trim() || null,
        url: link.href || null,
        description: card?.querySelector('p')?.textContent?.trim() || null,
      };
    }, careersHost).filter((posting) => posting && (
      posting.title
      && /^https:\/\/[^/]+\/jobs\/Careers\/\d+\//i.test(posting.url || '')
    )));
    stats.listingJobsFetched = listings.length;

    for (const listing of listings.slice(0, maxJobs)) {
      if (options.signal?.aborted) {
        stats.stopReason = 'aborted';
        break;
      }

      try {
        await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout });
        stats.detailJobsFetched += 1;
        const detail = await page.$$eval('li', (items) => {
          const countryItem = items.find((item) => {
            const label = item.children[0]?.textContent?.trim().toLowerCase();
            return label === 'country';
          });
          const countryValue = countryItem?.children[1]?.textContent?.trim() || '';
          return {
            country: countryValue || null,
          };
        });
        const job = normalizeRecruitPosting(
          { ...listing, country: detail.country },
          { company, careersHost }
        );
        if (job) jobs.push(job);
        else stats.skippedIndia += 1;
      } catch (error) {
        if (options.signal?.aborted) {
          stats.stopReason = 'aborted';
          break;
        }
        stats.failed += 1;
        logger.warn(`Zoho job detail failed url=${listing.url}: ${error.message}`);
      }
    }
  } finally {
    await page.close();
  }

  stats.recentJobs = jobs.length;
  return { result: jobs, stats };
}

module.exports = {
  CAREERS_URL,
  normalizeRecruitPosting,
  scrapeZohoJobs,
};
