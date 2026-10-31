'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { newPage: createPage } = require('./browser');

const CAREERS_HOST = 'careers.mastek.com';
const CAREERS_URL = 'https://careers.mastek.com/search';
const DEFAULT_MAX_JOBS = 100;
const DEFAULT_TIMEOUT_MS = 30000;

function normalizeMastekPosting(posting) {
  const title = String(posting?.title || '').replace(/\s+/g, ' ').trim();
  const location = String(posting?.location || '').replace(/\s+/g, ' ').trim();
  const jobUrl = String(posting?.url || '').trim();
  const applyUrl = String(posting?.applyUrl || '').trim();
  let jobUrlParts;
  let applyUrlParts;

  try {
    jobUrlParts = new URL(jobUrl);
    applyUrlParts = new URL(applyUrl);
  } catch {
    return null;
  }

  const jobId = jobUrlParts.pathname.match(/^\/job\/[^/]+\/(\d+)\/?$/i)?.[1];
  const applyJobId = applyUrlParts.pathname.match(/^\/talentcommunity\/apply\/(\d+)\/?$/i)?.[1];
  if (
    !title
    || !location
    || jobUrlParts.protocol !== 'https:'
    || jobUrlParts.hostname !== CAREERS_HOST
    || applyUrlParts.protocol !== 'https:'
    || applyUrlParts.hostname !== CAREERS_HOST
    || !jobId
    || jobId !== applyJobId
  ) return null;

  const eligibility = evaluateIndiaEligibility({ location });
  if (!eligibility.eligible) return null;

  return {
    title,
    company: 'Mastek',
    company_name: 'Mastek',
    location: /\bindia\b/i.test(eligibility.persistedLocation)
      ? eligibility.persistedLocation
      : `${eligibility.persistedLocation}, India`,
    country: 'India',
    experience: null,
    employment_type: null,
    work_mode: null,
    salary: null,
    description: posting.description || null,
    summary: null,
    skills: null,
    apply_url: applyUrl,
    source: 'Mastek',
    posted_date: null,
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: jobId,
  };
}

async function scrapeMastekJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const page = await (options.createPage || createPage)();
  const maxJobsValue = Number(options.maxJobs || DEFAULT_MAX_JOBS);
  const maxJobs = Number.isFinite(maxJobsValue) && maxJobsValue > 0
    ? Math.floor(maxJobsValue)
    : DEFAULT_MAX_JOBS;
  const timeout = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
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
    await page.goto(CAREERS_URL, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForSelector('a[href*="/job/"]', { timeout });

    const listings = new Map();
    let previousCount = -1;
    while (listings.size < maxJobs && listings.size !== previousCount) {
      previousCount = listings.size;
      const current = await page.$$eval('a[href*="/job/"]', (links, expectedHost) => (
        links.map((link) => {
          const url = new URL(link.href);
          if (url.hostname !== expectedHost) return null;
          const card = link.closest('li') || link.parentElement?.parentElement;
          return {
            title: link.textContent?.trim() || null,
            url: link.href,
            description: card?.querySelector('p')?.textContent?.trim() || null,
          };
        }).filter((posting) => posting?.title && posting.url)
      ), CAREERS_HOST);
      for (const listing of current) listings.set(listing.url, listing);
      if (listings.size >= maxJobs) break;

      const moreResults = page.getByRole('button', { name: 'More Search Results' });
      if (await moreResults.count() === 0) break;
      await moreResults.click();
      await page.waitForTimeout(250);
    }

    stats.listingJobsFetched = listings.size;
    for (const listing of [...listings.values()].slice(0, maxJobs)) {
      if (options.signal?.aborted) {
        stats.stopReason = 'aborted';
        break;
      }

      try {
        await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout });
        stats.detailJobsFetched += 1;
        const detail = await page.$$eval('p', (paragraphs) => {
          const locationText = paragraphs
            .map((paragraph) => paragraph.textContent?.trim() || '')
            .find((text) => /^Location\s*:/i.test(text));
          const applyLink = [...document.querySelectorAll('a[href]')].find((link) => {
            try {
              const url = new URL(link.href);
              return url.hostname === 'careers.mastek.com'
                && /^\/talentcommunity\/apply\/\d+\/?$/i.test(url.pathname);
            } catch {
              return false;
            }
          });
          return {
            location: locationText?.replace(/^Location\s*:\s*/i, '').trim() || null,
            applyUrl: applyLink?.href || null,
          };
        });
        const job = normalizeMastekPosting({ ...listing, ...detail });
        if (job) jobs.push(job);
        else stats.skippedIndia += 1;
      } catch (error) {
        if (options.signal?.aborted) {
          stats.stopReason = 'aborted';
          break;
        }
        stats.failed += 1;
        logger.warn(`Mastek job detail failed url=${listing.url}: ${error.message}`);
      }
    }
  } finally {
    await page.close();
  }

  stats.recentJobs = jobs.length;
  return { result: jobs, stats };
}

module.exports = { CAREERS_URL, normalizeMastekPosting, scrapeMastekJobs };
