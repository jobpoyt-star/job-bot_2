'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const {
  fetchFreshworksJobs,
  normalizeFreshworksPosting,
  scrapeFreshworksJobs,
} = require('../src/scrapers/freshworks');

function listing(id, name, location) {
  return { id, name, location, releasedDate: '2026-01-10T00:00:00.000Z' };
}

function details(location, applyUrl = 'https://jobs.smartrecruiters.com/Freshworks/job') {
  return {
    location,
    applyUrl,
    typeOfEmployment: { label: 'Full-time' },
    jobAd: {
      sections: {
        jobDescription: { text: '<p>Build products &amp; services.</p>' },
        qualifications: { text: '<ul><li>Engineering experience</li></ul>' },
      },
    },
  };
}

test('Freshworks normalizes verified SmartRecruiters posting details', () => {
  const job = normalizeFreshworksPosting(
    listing('fresh-1', 'Software Engineer', { city: 'Chennai', country: 'in' }),
    details({ city: 'Chennai', country: 'in', fullLocation: 'Chennai, India' })
  );

  assert.equal(job.title, 'Software Engineer');
  assert.equal(job.company, 'Freshworks');
  assert.equal(job.location, 'Chennai, India');
  assert.equal(job.country, 'in');
  assert.equal(job.apply_url, 'https://jobs.smartrecruiters.com/Freshworks/job');
  assert.equal(job.external_job_id, 'fresh-1');
  assert.match(job.description, /Build products & services\./);
  assert.match(job.description, /Engineering experience/);
});

test('Freshworks fetch paginates sequentially and only returns India-eligible jobs', async () => {
  const requestedPages = [];
  const requestedDetails = [];
  const postings = [
    listing('india-1', 'Engineer', { city: 'Chennai', country: 'in' }),
    listing('foreign-1', 'Designer', { city: 'Austin', country: 'us' }),
    listing('india-2', 'Analyst', { city: 'Pune', country: 'in' }),
  ];

  const stats = await fetchFreshworksJobs({
    maxJobs: 3,
    pageSize: 2,
    fetchPage: async (offset, limit) => {
      requestedPages.push({ offset, limit });
      return {
        totalFound: postings.length,
        content: postings.slice(offset, offset + limit),
      };
    },
    fetchDetails: async (id) => {
      requestedDetails.push(id);
      const posting = postings.find((item) => item.id === id);
      return details(posting.location);
    },
  });

  assert.deepEqual(requestedPages, [{ offset: 0, limit: 2 }, { offset: 2, limit: 1 }]);
  assert.deepEqual(requestedDetails, ['india-1', 'foreign-1', 'india-2']);
  assert.deepEqual(stats.jobs.map((job) => job.external_job_id), ['india-1', 'india-2']);
  assert.equal(stats.skippedIndiaEligibility, 1);
  assert.equal(stats.pageCount, 2);
});

test('one failed or incomplete Freshworks detail does not discard other eligible jobs', async () => {
  const postings = [
    listing('failed-detail', 'Engineer', { city: 'Chennai', country: 'in' }),
    listing('no-apply', 'Analyst', { city: 'Pune', country: 'in' }),
    listing('valid', 'Developer', { city: 'Hyderabad', country: 'in' }),
  ];
  const response = await scrapeFreshworksJobs('', '', false, {
    maxJobs: 3,
    pageSize: 3,
    fetchPage: async () => ({ totalFound: 3, content: postings }),
    fetchDetails: async (id) => {
      if (id === 'failed-detail') {
        const error = new Error('temporary server error');
        error.status = 503;
        throw error;
      }
      if (id === 'no-apply') return details(postings[1].location, null);
      return details(postings[2].location, 'https://jobs.smartrecruiters.com/Freshworks/valid');
    },
  });

  assert.deepEqual(response.result.map((job) => job.external_job_id), ['valid']);
  assert.equal(response.stats.recentJobs, 1);
});

test('Freshworks stops detail requests for the current run after a 429', async () => {
  const postings = [
    listing('valid-before-limit', 'Engineer', { city: 'Chennai', country: 'in' }),
    listing('rate-limited', 'Analyst', { city: 'Pune', country: 'in' }),
    listing('must-not-request', 'Developer', { city: 'Hyderabad', country: 'in' }),
  ];
  const requestedDetails = [];
  const response = await scrapeFreshworksJobs('', '', false, {
    maxJobs: 3,
    pageSize: 3,
    fetchPage: async () => ({ totalFound: 3, content: postings }),
    fetchDetails: async (id) => {
      requestedDetails.push(id);
      if (id === 'rate-limited') {
        const error = new Error('rate limited');
        error.status = 429;
        throw error;
      }
      const posting = postings.find((item) => item.id === id);
      return details(posting.location);
    },
  });

  assert.deepEqual(requestedDetails, ['valid-before-limit', 'rate-limited']);
  assert.deepEqual(response.result.map((job) => job.external_job_id), ['valid-before-limit']);
  assert.equal(response.stats.stopReason, 'rate_limited');
});

test('duplicate SmartRecruiters listing IDs are only enriched once', async () => {
  let detailCalls = 0;
  const repeatedPosting = listing('same-id', 'Engineer', { city: 'Bengaluru', country: 'in' });
  const stats = await fetchFreshworksJobs({
    maxJobs: 2,
    fetchPage: async () => ({ totalFound: 2, content: [repeatedPosting, repeatedPosting] }),
    fetchDetails: async () => {
      detailCalls += 1;
      return details({ city: 'Bengaluru', country: 'in' });
    },
  });

  assert.equal(detailCalls, 1);
  assert.equal(stats.jobs.length, 1);
});

test('a 429 without Retry-After is not retried', async () => {
  const originalGet = axios.get;
  let calls = 0;
  axios.get = async () => {
    calls += 1;
    const error = new Error('rate limited');
    error.response = { status: 429, headers: {} };
    throw error;
  };

  try {
    await assert.rejects(
      require('../src/scrapers/freshworks').fetchFreshworksPage(0, 10),
      /HTTP 429/
    );
    assert.equal(calls, 1);
  } finally {
    axios.get = originalGet;
  }
});

test('a 429 with Retry-After is retried after the supplied delay', async () => {
  const originalGet = axios.get;
  let calls = 0;
  axios.get = async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('rate limited');
      error.response = { status: 429, headers: { 'retry-after': '0' } };
      throw error;
    }
    return { data: { content: [] } };
  };

  try {
    const page = await require('../src/scrapers/freshworks').fetchFreshworksPage(0, 10);
    assert.deepEqual(page.content, []);
    assert.equal(calls, 2);
  } finally {
    axios.get = originalGet;
  }
});

test('a 429 with an excessive Retry-After is not retried early', async () => {
  const originalGet = axios.get;
  let calls = 0;
  axios.get = async () => {
    calls += 1;
    const error = new Error('rate limited');
    error.response = { status: 429, headers: { 'retry-after': '3600' } };
    throw error;
  };

  try {
    await assert.rejects(
      require('../src/scrapers/freshworks').fetchFreshworksPage(0, 10),
      /HTTP 429/
    );
    assert.equal(calls, 1);
  } finally {
    axios.get = originalGet;
  }
});
