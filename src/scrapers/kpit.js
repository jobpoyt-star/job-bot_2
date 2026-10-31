'use strict';

const logger = require('../utils/logger');
const { evaluateIndiaEligibility } = require('../parsers/common/jobFilters');
const { requestJson } = require('./verifiedProductFeeds');

const COMPANY = 'KPIT Technologies';
const CAREERS_URL = 'https://www.kpit.com/careers-overview/';
const JOBS_URL = 'https://www.kpit.com/job-listing/';
const INDIA_JOBS_URL = `${JOBS_URL}?country=India&location=&exp=0&show_all=1`;
const KPIT_APPLICATION_HOST = 'talentojo.kpit.com';

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

function getKpitApplyUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== KPIT_APPLICATION_HOST) return null;
    if (url.pathname !== '/tojo/app/job-apply/') return null;
    if (!/^#\/Career%20Portal\/\d+$/i.test(url.hash)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function getCardText(card, tagName, className = null) {
  const classAttribute = className
    ? `(?=[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'])`
    : '';
  const expression = new RegExp(`<${tagName}\\b${classAttribute}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = card.match(expression);
  return match ? normalizeText(match[1]) : '';
}

function parseKpitListing(html) {
  if (typeof html !== 'string' || !html.includes('id="job-listing"')) {
    throw new Error('KPIT public jobs page returned an invalid response');
  }

  const sectionMatch = html.match(/<section\b[^>]*id=["']job-listing["'][^>]*>([\s\S]*?)<\/section>/i);
  if (!sectionMatch) throw new Error('KPIT public jobs page did not include its job listings');
  const cardStarts = [...sectionMatch[1].matchAll(/<div\b[^>]*class=["'][^"']*\bf-col\s+job-div\b[^"']*["'][^>]*>/gi)];
  const applyLinks = [];

  for (let index = 0; index < cardStarts.length; index += 1) {
    const start = cardStarts[index].index;
    const end = cardStarts[index + 1]?.index ?? sectionMatch[1].length;
    const card = sectionMatch[1].slice(start, end);
    const anchors = [...card.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
    const applyAnchor = anchors.find(([, attributes, text]) =>
      /\bjob-apply\b/i.test(attributes)
      && /\btalentojo-button\b/i.test(attributes)
      && normalizeText(text) === 'Apply'
    );
    if (!applyAnchor) continue;

    const href = applyAnchor[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
    applyLinks.push({
      title: getCardText(card, 'h3'),
      location: getCardText(card, 'span', 'job-loaction'),
      employmentType: getCardText(card, 'span', 'job-time'),
      experience: getCardText(card, 'span', 'job-exp'),
      skills: getCardText(card, 'p', 'skills-txt'),
      applyUrl: decodeHtml(href || ''),
    });
  }

  if (cardStarts.length !== applyLinks.length) {
    throw new Error('KPIT public jobs page returned a job card without a verified Apply link');
  }

  return applyLinks;
}

function normalizeKpitPosting(posting, metrics) {
  const title = normalizeText(posting?.title);
  const location = normalizeText(posting?.location);
  const applyUrl = getKpitApplyUrl(posting?.applyUrl);
  if (!title || !location || !applyUrl) return null;

  const eligibility = evaluateIndiaEligibility({ location, country: 'India' });
  if (!eligibility.eligible) {
    if (metrics) metrics.skippedIndia += 1;
    return null;
  }

  const jobId = decodeURIComponent(new URL(applyUrl).hash).match(/^#\/Career Portal\/(\d+)$/)?.[1];
  if (!jobId) return null;

  return {
    title,
    company: COMPANY,
    company_name: COMPANY,
    location: eligibility.persistedLocation,
    country: 'India',
    experience: normalizeText(posting?.experience).replace(/^exp\s*/i, '') || null,
    employment_type: normalizeText(posting?.employmentType) || null,
    work_mode: null,
    salary: null,
    description: null,
    summary: null,
    skills: normalizeText(posting?.skills) || null,
    apply_url: applyUrl,
    source: COMPANY,
    posted_date: null,
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: jobId,
  };
}

async function fetchKpitJobs(options = {}) {
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || 100, 100));
  if (options.signal?.aborted) throw new Error('KPIT Technologies jobs request aborted');

  const html = await requestJson(JOBS_URL, {
    country: 'India',
    location: '',
    exp: '0',
    show_all: '1',
  }, {
    ...options,
    headers: {
      Referer: CAREERS_URL,
      ...(options.headers || {}),
    },
  });
  const postings = parseKpitListing(html);
  const jobs = [];
  const seen = new Set();
  const metrics = { skippedIndia: 0 };
  for (const posting of postings) {
    const applyUrl = getKpitApplyUrl(posting.applyUrl);
    const id = applyUrl
      ? decodeURIComponent(new URL(applyUrl).hash).match(/^#\/Career Portal\/(\d+)$/)?.[1]
      : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const job = normalizeKpitPosting(posting, metrics);
    if (job) jobs.push(job);
    if (jobs.length >= maxJobs) break;
  }

  return {
    jobs,
    fetched: postings.length,
    skippedIndia: metrics.skippedIndia,
    pageCount: postings.length ? 1 : 0,
  };
}

async function scrapeKpitJobs(_query = '', _location = '', _fullSync = false, options = {}) {
  const response = await fetchKpitJobs(options);
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
  fetchKpitJobs,
  getKpitApplyUrl,
  normalizeKpitPosting,
  parseKpitListing,
  scrapeKpitJobs,
};
