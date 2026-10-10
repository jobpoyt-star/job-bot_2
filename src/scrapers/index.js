const logger = require('../utils/logger');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');
const { scrapeCompanyJobs } = require('./companyScraper');
const { scrapeFreshworksJobs } = require('./freshworks');
const productFeedScrapers = require('./verifiedProductFeeds');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');

const SCRAPER_REGISTRY = {
  freshworks: scrapeFreshworksJobs,
  razorpay: productFeedScrapers.razorpay,
  paytm: productFeedScrapers.paytm,
  meesho: productFeedScrapers.meesho,
  swiggy: productFeedScrapers.swiggy,
  groww: productFeedScrapers.groww,
  cred: productFeedScrapers.cred,
};

const ACTIVE_SCRAPER_ORDER = Object.keys(SCRAPER_REGISTRY);

function getRegisteredScraperKeys() {
  return ACTIVE_SCRAPER_ORDER.filter((key) => Object.hasOwn(SCRAPER_REGISTRY, key));
}

function filterIndiaEligibleJobs(jobs, target) {
  const eligibleJobs = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const eligibility = evaluateIndiaEligibility(job);
    if (!eligibility.eligible) {
      logger.info(JSON.stringify({
        event: 'scraper_job_skipped_india_eligibility',
        source: job?.source || target,
        reason: eligibility.reason,
      }));
      continue;
    }

    eligibleJobs.push({ ...job, location: eligibility.persistedLocation });
  }
  return eligibleJobs;
}

async function runScrapers(urls = [], options = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    logger.warn('No scraper URLs provided');
    return [];
  }

  const { signal } = options;
  const scraperRegistry = options.registry || SCRAPER_REGISTRY;
  const results = [];

  for (const item of urls) {
    try {
      const key = String(item).trim().toLowerCase();
      const registeredScraper = scraperRegistry[key];

      if (registeredScraper) {
        logger.info(`Starting registered scraper for ${key}`);
        const maxJobs = Number(process.env.MAX_JOBS_PER_COMPANY_RUN) || 100;
        const response = await registeredScraper('', '', false, { signal, maxJobs });
        const jobs = Array.isArray(response?.result) ? response.result.slice(0, maxJobs) : [];
        const stats = response?.stats || {
          pageCount: 0,
          listingJobsFetched: jobs.length,
          detailJobsFetched: 0,
          recentJobs: jobs.length,
          skippedOld: 0,
          stopReason: signal?.aborted ? 'timeout' : 'completed',
        };
        logger.info(
          `Scraper finished for ${key}: pageCount=${stats.pageCount || 0}, listingJobsFetched=${stats.listingJobsFetched ?? jobs.length}, detailJobsFetched=${stats.detailJobsFetched ?? 0}, recentJobs=${stats.recentJobs ?? jobs.length}, skippedOld=${stats.skippedOld ?? 0}, stopReason=${stats.stopReason || 'completed'}`
        );
        results.push(...filterIndiaEligibleJobs(jobs, key));
        continue;
      }

      if (!/^https?:\/\//i.test(String(item))) {
        logger.warn(`Unregistered scraper target skipped: ${key}`);
        continue;
      }

      logger.info(`Starting generic page scraper for ${item}`);
      const jobs = await scrapeCompanyJobs(item);
      const eligibleJobs = filterIndiaEligibleJobs(jobs, item);
      const recentJobs = eligibleJobs.filter((job) => filterJobsWithinRecentCutoff([job], { includeUnknownDate: true }).length > 0);
      logger.info(`Scraper finished for ${item}: jobs=${jobs.length}, indiaEligible=${eligibleJobs.length}, recent=${recentJobs.length}, skippedOld=${eligibleJobs.length - recentJobs.length}`);
      results.push(...recentJobs);
    } catch (error) {
      logger.error(`Scraper error for ${item}: ${error.message}`);
    }
  }

  return results;
}

module.exports = {
  runScrapers,
  getRegisteredScraperKeys,
};
