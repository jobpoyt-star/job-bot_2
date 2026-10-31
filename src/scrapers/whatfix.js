'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { normalizePostingDate } = require('../utils/postingDate');
const { newPage } = require('./browser');

const COMPANY = 'Whatfix';
const CAREERS_URL = 'https://whatfix101.hire.trakstar.com/';
const JOBS_FEED_URL = 'https://whatfix101.hire.trakstar.com/jobfeeds/whatfix101';

function normalizeWhatfixPosting(posting, metrics) {
  const title = String(posting?.title || '').replace(/\s+/g, ' ').trim();
  let detailUrl;
  try {
    detailUrl = new URL(String(posting?.url || ''));
  } catch {
    return null;
  }

  const idMatch = detailUrl.pathname.match(/^\/jobs\/([a-z0-9]+)\/?$/i);
  if (detailUrl.hostname !== 'whatfix101.hire.trakstar.com' || !idMatch || !title) return null;

  const locationParts = [posting.city, posting.state, posting.country]
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const location = locationParts.join(', ') || null;
  const eligibility = evaluateIndiaEligibility({
    location,
    country: posting.country || null,
  });
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  const employmentType = String(posting.employmentType || '').trim();
  const applyUrl = new URL(`/jobs/${encodeURIComponent(idMatch[1])}/?apply=true`, CAREERS_URL).href;
  return {
    title,
    company: COMPANY,
    company_name: COMPANY,
    location: eligibility.persistedLocation,
    country: 'India',
    experience: null,
    employment_type: employmentType
      ? employmentType.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
      : null,
    work_mode: null,
    salary: null,
    description: posting.description || null,
    summary: null,
    skills: null,
    apply_url: applyUrl,
    source: COMPANY,
    posted_date: normalizePostingDate(posting.postedDate),
    expiry_date: normalizePostingDate(posting.expiryDate),
    status: 'active',
    is_active: true,
    external_job_id: idMatch[1],
  };
}

async function fetchWhatfixJobs(options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  const pageFactory = options.newPage || newPage;
  const page = await pageFactory();
  const jobs = [];
  const metrics = { skippedIndia: 0 };
  let listingJobsFetched = 0;

  const abortPage = () => {
    page.close().catch(() => {});
  };
  if (options.signal?.aborted) {
    await page.close();
    throw new Error('Whatfix jobs request aborted');
  }
  options.signal?.addEventListener('abort', abortPage, { once: true });

  try {
    await page.goto(CAREERS_URL, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs || 45000,
    });

    if (options.signal?.aborted) throw new Error('Whatfix jobs request aborted');
    const response = await page.evaluate(async ({ feedUrl, timeoutMs }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await fetch(feedUrl, {
          headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
          signal: controller.signal,
        });
        if (!result.ok) return { status: result.status, channelTitle: '', postings: [] };

        const xml = new DOMParser().parseFromString(await result.text(), 'application/xml');
        if (xml.querySelector('parsererror')) {
          return { status: result.status, channelTitle: '', postings: [] };
        }
        const readField = (item, name) =>
          [...item.children].find((element) => element.localName === name)?.textContent.trim() || '';
        const channelTitle = xml.querySelector('channel > title')?.textContent.trim() || '';
        const postings = [...xml.querySelectorAll('item')].map((item) => {
          const descriptionHtml = readField(item, 'description');
          const descriptionDocument = new DOMParser().parseFromString(descriptionHtml, 'text/html');
          const description = descriptionDocument.querySelector('#job_description')?.textContent
            || descriptionDocument.body.textContent
            || '';
          return {
            title: readField(item, 'title'),
            url: readField(item, 'link'),
            city: readField(item, 'locationCity'),
            state: readField(item, 'locationState'),
            country: readField(item, 'locationCountry'),
            employmentType: readField(item, 'positionType'),
            postedDate: readField(item, 'pubDate'),
            expiryDate: readField(item, 'closeDte'),
            description: description.replace(/\s+/g, ' ').trim(),
          };
        });
        return { status: result.status, channelTitle, postings };
      } finally {
        clearTimeout(timeout);
      }
    }, {
      feedUrl: JOBS_FEED_URL,
      timeoutMs: options.timeoutMs || 20000,
    });

    if (
      response?.status !== 200
      || !/^Jobs at Whatfix$/i.test(response.channelTitle || '')
      || !Array.isArray(response.postings)
    ) {
      throw new Error(`Whatfix public jobs feed returned an invalid response (HTTP ${response?.status || 'unknown'})`);
    }

    listingJobsFetched = response.postings.length;
    const seen = new Set();
    for (const posting of response.postings) {
      const job = normalizeWhatfixPosting(posting, metrics);
      if (!job || seen.has(job.external_job_id)) continue;
      seen.add(job.external_job_id);
      if (jobs.length < maxJobs) jobs.push(job);
    }

    return {
      jobs,
      listingJobsFetched,
      skippedIndia: metrics.skippedIndia,
      pageCount: response.postings.length ? 1 : 0,
    };
  } finally {
    options.signal?.removeEventListener('abort', abortPage);
    await page.close();
  }
}

async function scrapeWhatfixJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const response = await fetchWhatfixJobs(options);
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
  JOBS_FEED_URL,
  fetchWhatfixJobs,
  normalizeWhatfixPosting,
  scrapeWhatfixJobs,
};
