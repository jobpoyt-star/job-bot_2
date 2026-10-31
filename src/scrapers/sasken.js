'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');
const { requestJson } = require('./verifiedProductFeeds');
const { newPage } = require('./browser');

const CAREERS_URL = 'https://careers.sasken.com/tb/saskenjobs/';
const INDIA_LISTING_URL = 'https://www.hirewand.com/apply/job/listing?id=2022&country=ind&embed=true';
const JOBS_API_URL = 'https://www.hirewand.com/public/listingdata';
const ACCOUNT_ID = 2022;
const PAGE_SIZE = 50;

function getSaskenApplyUrl(posting, id) {
  if (!/^\d+$/.test(id)) return null;
  try {
    const url = new URL(String(posting?.jobURL || ''));
    if (
      url.protocol !== 'https:'
      || url.hostname !== 'www.hirewand.com'
      || url.pathname !== '/apply/job/detail'
      || url.searchParams.get('jid') !== id
      || url.searchParams.get('cpid') !== String(ACCOUNT_ID)
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

function formatExperience(experience) {
  const minMonths = Number(experience?.min);
  const maxMonths = Number(experience?.max);
  if (!Number.isFinite(minMonths) && !Number.isFinite(maxMonths)) return null;

  const formatYears = (months) => {
    const years = months / 12;
    return Number.isInteger(years) ? String(years) : String(Number(years.toFixed(1)));
  };
  if (Number.isFinite(minMonths) && Number.isFinite(maxMonths)) {
    return `${formatYears(minMonths)} - ${formatYears(maxMonths)} years`;
  }
  if (Number.isFinite(minMonths)) return `${formatYears(minMonths)}+ years`;
  return `Up to ${formatYears(maxMonths)} years`;
}

function normalizeSaskenPosting(posting, metrics, options = {}) {
  const id = String(posting?._id || '').trim();
  if (!/^\d+$/.test(id)) return null;

  const locations = Array.isArray(posting?.needjson?.location)
    ? posting.needjson.location
    : [];
  const countries = [...new Set(
    locations
      .map((location) => String(location?.country?.display || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  )];
  if (countries.some((country) => country.toLowerCase() !== 'india')) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  const location = locations
    .map((value) => String(
      value?.uniqueuiref
      || [value?.city?.display, value?.state?.display, value?.country?.display].filter(Boolean).join(', ')
      || ''
    ).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' / ');
  if (!location && !options.indiaListingVerified) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }
  const eligibility = evaluateIndiaEligibility({
    location: location || 'India',
    country: countries.join(' / ') || (options.indiaListingVerified ? 'India' : null),
  });
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  const title = String(posting?.title || '').replace(/\s+/g, ' ').trim();
  const applyUrl = getSaskenApplyUrl(posting, id);
  if (!title || !applyUrl) return null;

  const skills = [
    ...(Array.isArray(posting?.jd_primary_skills) ? posting.jd_primary_skills : []),
    ...(Array.isArray(posting?.jd_secondary_skills) ? posting.jd_secondary_skills : []),
  ].map((skill) => String(skill || '').replace(/\s+/g, ' ').trim()).filter(Boolean);

  return {
    title,
    company: 'Sasken Technologies',
    company_name: 'Sasken Technologies',
    location: eligibility.persistedLocation,
    country: 'India',
    experience: formatExperience(posting?.needjson?.experience),
    employment_type: null,
    work_mode: null,
    salary: null,
    description: posting?.jd_summary || null,
    summary: posting?.jd_summary || null,
    skills: skills.length ? [...new Set(skills)] : null,
    apply_url: applyUrl,
    source: 'Sasken Technologies',
    posted_date: normalizePostingDate(posting?.created_at),
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: id,
  };
}

async function fetchSaskenJobs(options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  if (options.signal?.aborted) throw new Error('Sasken Technologies jobs request aborted');
  const page = await (options.newPage || newPage)();
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  let pageCount = 0;
  let fetched = 0;
  let offset = 0;
  const abortPage = () => {
    page.close().catch(() => {});
  };
  options.signal?.addEventListener('abort', abortPage, { once: true });

  try {
    await page.goto(INDIA_LISTING_URL, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs || 45000,
    });
    const listing = await page.evaluate(async ({ timeoutMs }) => {
      const readIds = () => [...document.querySelectorAll('button')]
        .filter((button) => button.innerText.trim() === 'Apply')
        .map((button) => {
          const card = button.parentElement?.parentElement?.parentElement;
          return [...(card?.querySelectorAll('span') || [])]
            .map((span) => span.innerText.trim())
            .find((value) => /^\d+$/.test(value));
        })
        .filter(Boolean);
      const waitForListing = async (previousFirstId = null) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const ids = readIds();
          const text = document.body?.innerText || '';
          if (ids.length && (!previousFirstId || ids[0] !== previousFirstId)) return ids;
          if (!previousFirstId && /\b0 active roles\b/i.test(text)) return ids;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        throw new Error('Sasken India listings did not finish loading');
      };

      const ids = [];
      let listingPageCount = 0;
      let currentIds = await waitForListing();
      while (true) {
        listingPageCount += 1;
        ids.push(...currentIds);
        const nextButton = [...document.querySelectorAll('button')]
          .find((button) => button.querySelector('svg.lucide-chevron-right'));
        if (!nextButton || nextButton.disabled) break;
        if (listingPageCount >= 100) throw new Error('Sasken India listings exceeded the page safety limit');
        const previousFirstId = currentIds[0];
        nextButton.click();
        currentIds = await waitForListing(previousFirstId);
      }

      return { ids: [...new Set(ids)], pageCount: listingPageCount };
    }, { timeoutMs: options.timeoutMs || 45000 });

    if (!listing || !Array.isArray(listing.ids)) {
      throw new Error('Sasken India careers page returned an invalid listing');
    }

    const indiaListingIds = new Set(listing.ids.map((id) => String(id)));
    if (!indiaListingIds.size) {
      return { jobs, fetched, skippedIndia: metrics.skippedIndia, pageCount };
    }

    while (jobs.length < maxJobs) {
      if (options.signal?.aborted) throw new Error('Sasken Technologies jobs request aborted');
      const data = await requestJson(JOBS_API_URL, {
        accountid: ACCOUNT_ID,
        limit: PAGE_SIZE,
        offset,
      }, {
        ...options,
        headers: {
          Referer: INDIA_LISTING_URL,
          ...(options.headers || {}),
        },
      });
      const postings = data?.jobs?.requirements;
      const matchCount = Number(data?.jobs?.matchCount);
      if (
        data?.status !== 'success'
        || !Array.isArray(postings)
        || !Number.isFinite(matchCount)
        || matchCount < 0
      ) {
        throw new Error('Sasken Technologies public jobs API returned an invalid response');
      }

      pageCount += 1;
      fetched += postings.length;
      for (const posting of postings) {
        const id = String(posting?._id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (!indiaListingIds.has(id)) {
          metrics.skippedIndia += 1;
          continue;
        }
        const job = normalizeSaskenPosting(posting, metrics, { indiaListingVerified: true });
        if (job) jobs.push(job);
        if (jobs.length >= maxJobs) break;
      }

      offset += postings.length;
      if (!postings.length || offset >= matchCount) break;
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

async function scrapeSaskenJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const response = await fetchSaskenJobs(options);
  logger.info(
    `Sasken Technologies public jobs feed completed: fetched=${response.fetched}, indiaEligible=${response.jobs.length}`
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
  INDIA_LISTING_URL,
  JOBS_API_URL,
  fetchSaskenJobs,
  getSaskenApplyUrl,
  normalizeSaskenPosting,
  scrapeSaskenJobs,
};
