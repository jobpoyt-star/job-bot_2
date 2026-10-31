'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAREERS_URL,
  JOBS_API_URL,
  fetchDarwinboxJobs,
  normalizeDarwinboxPosting,
} = require('../src/scrapers/darwinbox');

function posting(index, overrides = {}) {
  return {
    id: `a${String(index).padStart(13, '0')}`,
    title: 'Customer Success Manager',
    internal_job_code: `DBJobID_${index}`,
    country: 'India',
    tool_tip_locations: ['Hyderabad, Telangana, India'],
    experience: '4 - 8 Years',
    emp_type_name: 'Full-time',
    posted_on: 1793125800,
    is_remote: 0,
    ...overrides,
  };
}

test('Darwinbox mapper requires an India-eligible location and job identity', () => {
  const job = normalizeDarwinboxPosting(posting(1));

  assert.equal(job.company, 'Darwinbox');
  assert.equal(job.company_name, 'Darwinbox');
  assert.equal(job.title, 'Customer Success Manager');
  assert.equal(job.location, 'Hyderabad, Telangana, India');
  assert.equal(job.country, 'India');
  assert.equal(job.external_job_id, 'DBJobID_1');
  assert.equal(job.experience, '4 - 8 Years');
  assert.equal(job.employment_type, 'Full-time');
  assert.equal(job.posted_date, '2026-10-27T18:30:00.000Z');
  assert.equal(
    job.apply_url,
    'https://dbx.darwinbox.in/ms/candidatev2/main/careers/jobDetails/a0000000000001'
  );

  assert.equal(normalizeDarwinboxPosting(posting(2, {
    country: 'United States',
    tool_tip_locations: ['New York, USA'],
  })), null);
  assert.equal(normalizeDarwinboxPosting(posting(3, { id: '' })), null);
});

test('Darwinbox fetcher paginates official public listings in its browser context', async () => {
  const firstPage = Array.from({ length: 10 }, (_, index) => posting(index + 1));
  const secondPage = Array.from({ length: 10 }, (_, index) => posting(index + 11));
  const thirdPage = [posting(21), posting(22, {
    country: 'United States',
    tool_tip_locations: ['New York, USA'],
  })];
  const calls = [];
  let closed = false;

  const response = await fetchDarwinboxJobs({
    newPage: async () => ({
      goto: async (url, options) => {
        assert.equal(url, CAREERS_URL);
        assert.equal(options.waitUntil, 'domcontentloaded');
      },
      evaluate: async (_fn, options) => {
        calls.push(options);
        assert.equal(options.apiUrl, JOBS_API_URL);
        assert.equal(options.pageSize, 10);
        return {
          status: 200,
          data: {
            status: 'success',
            data: [firstPage, secondPage, thirdPage][options.pageNumber - 1] || [],
          },
        };
      },
      close: async () => { closed = true; },
    }),
  });

  assert.deepEqual(calls.map(({ pageNumber }) => pageNumber), [1, 2, 3]);
  assert.equal(response.pageCount, 3);
  assert.equal(response.listingJobsFetched, 22);
  assert.equal(response.skippedIndia, 1);
  assert.equal(response.jobs.length, 21);
  assert.equal(closed, true);
});

test('Darwinbox fetcher rejects invalid public API responses and respects aborts', async () => {
  await assert.rejects(
    fetchDarwinboxJobs({
      newPage: async () => ({
        goto: async () => {},
        evaluate: async () => ({ status: 403, data: {} }),
        close: async () => {},
      }),
    }),
    /Darwinbox public jobs API returned an invalid response/
  );

  let closed = false;
  await assert.rejects(
    fetchDarwinboxJobs({
      signal: { aborted: true, addEventListener() {}, removeEventListener() {} },
      newPage: async () => ({
        goto: async () => {},
        evaluate: async () => assert.fail('API must not be called after abort'),
        close: async () => { closed = true; },
      }),
    }),
    /Darwinbox jobs request aborted/
  );
  assert.equal(closed, true);
});
