'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAREERS_URL,
  JOBS_FEED_URL,
  fetchWhatfixJobs,
  normalizeWhatfixPosting,
} = require('../src/scrapers/whatfix');

function posting(overrides = {}) {
  return {
    title: 'Senior Software Engineer',
    url: 'http://whatfix101.hire.trakstar.com/jobs/abc123',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    employmentType: 'full_time',
    postedDate: 'Thu, 29 Oct 2026 00:00:00 +0530',
    expiryDate: '',
    description: 'Build reliable software.',
    ...overrides,
  };
}

test('Whatfix mapper requires a valid official job page and India-eligible location', () => {
  const job = normalizeWhatfixPosting(posting());

  assert.equal(job.company, 'Whatfix');
  assert.equal(job.title, 'Senior Software Engineer');
  assert.equal(job.location, 'Bengaluru, Karnataka, India');
  assert.equal(job.country, 'India');
  assert.equal(job.external_job_id, 'abc123');
  assert.equal(job.employment_type, 'Full Time');
  assert.equal(job.description, 'Build reliable software.');
  assert.equal(job.posted_date, '2026-10-28T18:30:00.000Z');
  assert.equal(
    job.apply_url,
    'https://whatfix101.hire.trakstar.com/jobs/abc123/?apply=true'
  );

  assert.equal(normalizeWhatfixPosting(posting({
    city: 'London',
    state: 'England',
    country: 'United Kingdom',
  })), null);
  assert.equal(normalizeWhatfixPosting(posting({
    url: 'https://example.com/jobs/abc123',
  })), null);
  assert.equal(normalizeWhatfixPosting(posting({ title: '' })), null);
});

test('Whatfix fetcher reads the official feed and deduplicates India postings', async () => {
  let closed = false;
  let feedCalls = 0;
  const response = await fetchWhatfixJobs({
    newPage: async () => ({
      goto: async (url, options) => {
        assert.equal(url, CAREERS_URL);
        assert.equal(options.waitUntil, 'domcontentloaded');
      },
      evaluate: async (_fn, options) => {
        feedCalls += 1;
        assert.equal(options.feedUrl, JOBS_FEED_URL);
        return {
          status: 200,
          channelTitle: 'Jobs at Whatfix',
          postings: [
            posting(),
            posting(),
            posting({ url: 'http://whatfix101.hire.trakstar.com/jobs/def456', city: 'San Jose', country: 'United States' }),
            posting({ url: 'http://whatfix101.hire.trakstar.com/jobs/ghi789', city: 'Bengaluru, Karnataka, India', state: '', country: '' }),
          ],
        };
      },
      close: async () => { closed = true; },
    }),
  });

  assert.equal(feedCalls, 1);
  assert.equal(response.pageCount, 1);
  assert.equal(response.listingJobsFetched, 4);
  assert.equal(response.skippedIndia, 1);
  assert.deepEqual(response.jobs.map((job) => job.external_job_id), ['abc123', 'ghi789']);
  assert.equal(closed, true);
});

test('Whatfix fetcher reports invalid feed responses and handles aborts', async () => {
  await assert.rejects(
    fetchWhatfixJobs({
      newPage: async () => ({
        goto: async () => {},
        evaluate: async () => ({ status: 403, channelTitle: '', postings: [] }),
        close: async () => {},
      }),
    }),
    /Whatfix public jobs feed returned an invalid response/
  );

  let closed = false;
  await assert.rejects(
    fetchWhatfixJobs({
      signal: { aborted: true, addEventListener() {}, removeEventListener() {} },
      newPage: async () => ({
        goto: async () => {},
        evaluate: async () => assert.fail('Feed must not be fetched after abort'),
        close: async () => { closed = true; },
      }),
    }),
    /Whatfix jobs request aborted/
  );
  assert.equal(closed, true);
});
