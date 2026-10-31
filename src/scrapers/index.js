const logger = require('../utils/logger');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');
const { scrapeCompanyJobs } = require('./companyScraper');
const { scrapeFreshworksJobs } = require('./freshworks');
const { scrapeZohoJobs } = require('./zoho');
const { scrapeMastekJobs } = require('./mastek');
const { scrapeBirlasoftJobs } = require('./birlasoft');
const { scrapeDelhiveryJobs } = require('./delhivery');
const { scrapeSonataJobs } = require('./sonata');
const { scrapeSaskenJobs } = require('./sasken');
const { scrapeLttsJobs } = require('./ltts');
const { scrapeKpitJobs } = require('./kpit');
const { scrapeAtherEnergyJobs } = require('./atherEnergy');
const { scrapeAurionproJobs } = require('./aurionpro');
const { scrapeGenpactJobs } = require('./genpact');
const { scrapeBrowserStackJobs } = require('./browserstack');
const { scrapePostmanJobs } = require('./postman');
const { scrapeDarwinboxJobs } = require('./darwinbox');
const { scrapeWhatfixJobs } = require('./whatfix');
const productFeedScrapers = require('./verifiedProductFeeds');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');

const SCRAPER_REGISTRY = {
  zoho: scrapeZohoJobs,
  freshworks: scrapeFreshworksJobs,
  razorpay: productFeedScrapers.razorpay,
  paytm: productFeedScrapers.paytm,
  meesho: productFeedScrapers.meesho,
  swiggy: productFeedScrapers.swiggy,
  groww: productFeedScrapers.groww,
  cred: productFeedScrapers.cred,
  phonepe: productFeedScrapers.phonepe,
  flipkart: productFeedScrapers.flipkart,
  zerodha: productFeedScrapers.zerodha,
  zensar: productFeedScrapers.zensar,
  hexaware: productFeedScrapers.hexaware,
  nucleus: (_query, _location, _fullSync, options) => scrapeZohoJobs(_query, _location, _fullSync, {
    ...options,
    company: 'Nucleus Software',
    careersHost: 'nucleussoftware.zohorecruit.in',
    careersUrl: 'https://nucleussoftware.zohorecruit.in/jobs/Careers',
  }),
  mastek: scrapeMastekJobs,
  birlasoft: scrapeBirlasoftJobs,
  delhivery: scrapeDelhiveryJobs,
  sonata: scrapeSonataJobs,
  sasken: scrapeSaskenJobs,
  ltts: scrapeLttsJobs,
  kpit: scrapeKpitJobs,
  atherenergy: scrapeAtherEnergyJobs,
  olaelectric: productFeedScrapers.olaelectric,
  makemytrip: productFeedScrapers.makemytrip,
  aurionpro: scrapeAurionproJobs,
  genpact: scrapeGenpactJobs,
  browserstack: scrapeBrowserStackJobs,
  postman: scrapePostmanJobs,
  darwinbox: scrapeDarwinboxJobs,
  whatfix: scrapeWhatfixJobs,
  cyient: productFeedScrapers.cyient,
  happiestminds: productFeedScrapers.happiestminds,
  coforge: productFeedScrapers.coforge,
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

  const { signal, onMetrics } = options;
  const scraperRegistry = options.registry || SCRAPER_REGISTRY;
  const results = [];

  for (const item of urls) {
    try {
      const key = String(item).trim().toLowerCase();
      const registeredScraper = scraperRegistry[key];

      if (registeredScraper) {
        logger.info(`Starting registered scraper for ${key}`);
        const maxJobs = Number(process.env.MAX_JOBS_PER_COMPANY_RUN) || 100;
        const response = await registeredScraper('', '', false, {
          ...options,
          signal,
          maxJobs,
        });
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
        const eligibleJobs = filterIndiaEligibleJobs(jobs, key);
        const reportedIndiaRejected = Number(stats.skippedIndia ?? stats.skippedIndiaEligibility) || 0;
        onMetrics?.({
          name: key,
          fetched: Number(stats.listingJobsFetched ?? stats.fetched ?? jobs.length) || 0,
          indiaRejected: reportedIndiaRejected + jobs.length - eligibleJobs.length,
          failures: Number(stats.failed) || 0,
        });
        results.push(...eligibleJobs);
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
      onMetrics?.({
        name: String(item),
        fetched: jobs.length,
        indiaRejected: jobs.length - eligibleJobs.length,
      });
      logger.info(`Scraper finished for ${item}: jobs=${jobs.length}, indiaEligible=${eligibleJobs.length}, recent=${recentJobs.length}, skippedOld=${eligibleJobs.length - recentJobs.length}`);
      results.push(...recentJobs);
    } catch (error) {
      logger.error(`Scraper error for ${item}: ${error.message}`);
      onMetrics?.({ name: String(item).trim().toLowerCase(), failures: 1 });
    }
  }

  return results;
}

module.exports = {
  runScrapers,
  getRegisteredScraperKeys,
};
