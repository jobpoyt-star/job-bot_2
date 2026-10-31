'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchDelhiveryJobs,
  normalizeDelhiveryPosting,
  CAREERS_URL,
  JOBS_API_URL,
} = require('../src/scrapers/delhivery');

function createPage(responses, calls = {}) {
  return {
    async goto(url, options) {
      calls.goto = { url, options };
    },
    async evaluate(_callback, params) {
      calls.params = calls.params || [];
      calls.params.push(params);
      return responses.shift();
    },
    async close() {
      calls.closed = true;
    },
  };
}

test('Delhivery Darwinbox adapter maps India jobs and rejects foreign postings', async () => {
  const calls = {};
  const result = await fetchDelhiveryJobs({
    maxJobs: 10,
    newPage: async () => createPage([{
      status: 200,
      data: {
        status: 'success',
        data: [
          {
            id: 'a67dd32d8adae1',
            internal_job_code: 'Job38679',
            title: 'Associate',
            department_name: 'Trucking (DEP_2032)',
            emp_type_name: 'Permanent',
            country: 'India',
            tool_tip_locations: ['Goa, India', 'Panjim, India'],
            posted_on: 1767810600,
            jd: 'Official job details',
          },
          {
            id: 'f01234abc',
            title: 'London Engineer',
            country: 'United Kingdom',
            tool_tip_locations: ['London, United Kingdom'],
          },
        ],
      },
    }], calls),
  });

  assert.deepEqual(calls.goto, {
    url: CAREERS_URL,
    options: { waitUntil: 'domcontentloaded', timeout: 45000 },
  });
  assert.equal(calls.params[0].apiUrl, JOBS_API_URL);
  assert.equal(calls.params[0].companyId, 'main');
  assert.equal(calls.params[0].pageNumber, 1);
  assert.equal(calls.params[0].pageSize, 10);
  assert.equal(calls.closed, true);
  assert.equal(result.fetched, 2);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.skippedIndia, 1);
  assert.equal(result.jobs[0].company, 'Delhivery');
  assert.equal(result.jobs[0].location, 'Goa, India / Panjim, India');
  assert.equal(result.jobs[0].employment_type, 'Permanent');
  assert.equal(result.jobs[0].posted_date, '2026-01-07T18:30:00.000Z');
  assert.equal(result.jobs[0].external_job_id, 'Job38679');
  assert.equal(
    result.jobs[0].apply_url,
    'https://delhivery.darwinbox.in/ms/candidatev2/main/careers/jobDetails/a67dd32d8adae1'
  );
});

test('Delhivery adapter paginates and closes its page when API data is invalid', async () => {
  const calls = {};
  const postings = Array.from({ length: 10 }, (_, index) => ({
    id: `job${index + 1}`,
    internal_job_code: `DLV-${index + 1}`,
    title: `India job ${index + 1}`,
    country: 'India',
    tool_tip_locations: ['Bengaluru, India'],
  }));
  const result = await fetchDelhiveryJobs({
    maxJobs: 15,
    newPage: async () => createPage([
      { status: 200, data: { status: 'success', data: postings } },
      { status: 200, data: { status: 'success', data: [postings[0]] } },
    ], calls),
  });

  assert.equal(result.pageCount, 2);
  assert.equal(result.fetched, 11);
  assert.equal(result.jobs.length, 10);
  assert.deepEqual(calls.params.map(({ pageNumber }) => pageNumber), [1, 2]);
  assert.equal(calls.closed, true);

  const invalidCalls = {};
  await assert.rejects(
    fetchDelhiveryJobs({
      newPage: async () => createPage([{ status: 200, data: { status: 'failure', data: [] } }], invalidCalls),
    }),
    /Delhivery public jobs API returned an invalid response/
  );
  assert.equal(invalidCalls.closed, true);
});

test('Delhivery normalizer requires a valid job ID and India-eligible location', () => {
  assert.equal(normalizeDelhiveryPosting({
    id: '../foreign-path',
    title: 'Invalid application route',
    country: 'India',
  }), null);
  assert.equal(normalizeDelhiveryPosting({
    id: 'foreign-role',
    title: 'Unverified location',
    country: '',
    tool_tip_locations: ['Remote'],
  }), null);
});
