'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchSonataJobs,
  normalizeSonataPosting,
  CAREERS_URL,
  JOBS_API_URL,
} = require('../src/scrapers/sonata');

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

test('Sonata Software Darwinbox adapter maps India jobs and rejects foreign postings', async () => {
  const calls = {};
  const result = await fetchSonataJobs({
    maxJobs: 10,
    newPage: async () => createPage([{
      status: 200,
      data: {
        status: 'success',
        data: [
          {
            id: 'a6ae2f1afa8adb',
            internal_job_code: 'SSL-26-27-891',
            designation_display_name: 'Microsoft Sharepoint and Exchange',
            country: 'India',
            tool_tip_locations: ['BG4, Bangalore, Karnataka, India'],
            experience: '14 - 20 Years',
            emp_type_name: 'Permanent',
            posted_on: 1793298600,
            jd: 'Official Sonata Software role',
          },
          {
            id: 'a6ae20bf53e83c',
            designation_display_name: 'Singapore Engineer',
            country: 'Singapore',
            tool_tip_locations: ['Singapore, Singapore'],
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
  assert.equal(result.jobs[0].company, 'Sonata Software');
  assert.equal(result.jobs[0].title, 'Microsoft Sharepoint and Exchange');
  assert.equal(result.jobs[0].location, 'BG4, Bangalore, Karnataka, India');
  assert.equal(result.jobs[0].experience, '14 - 20 Years');
  assert.equal(result.jobs[0].employment_type, 'Permanent');
  assert.equal(result.jobs[0].posted_date, new Date(1793298600 * 1000).toISOString());
  assert.equal(result.jobs[0].external_job_id, 'SSL-26-27-891');
  assert.equal(
    result.jobs[0].apply_url,
    'https://sonataone.darwinbox.in/ms/candidatev2/main/careers/jobDetails/a6ae2f1afa8adb'
  );
});

test('Sonata Software adapter paginates, caps results and closes page on invalid payload', async () => {
  const calls = {};
  const postings = Array.from({ length: 10 }, (_, index) => ({
    id: `job${index + 1}`,
    internal_job_code: `SSL-${index + 1}`,
    designation_display_name: `India job ${index + 1}`,
    country: 'India',
    tool_tip_locations: ['Bengaluru, Karnataka, India'],
  }));
  const result = await fetchSonataJobs({
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
    fetchSonataJobs({
      newPage: async () => createPage([{
        status: 200,
        data: { status: 'failed', data: [] },
      }], invalidCalls),
    }),
    /Sonata Software public jobs API returned an invalid response/
  );
  assert.equal(invalidCalls.closed, true);
});

test('Sonata Software normalizer rejects invalid IDs and unverified India locations', () => {
  assert.equal(normalizeSonataPosting({
    id: '../job',
    designation_display_name: 'Invalid application route',
    country: 'India',
    tool_tip_locations: ['Bengaluru, India'],
  }), null);
  assert.equal(normalizeSonataPosting({
    id: 'remotejob',
    designation_display_name: 'Unverified remote job',
    tool_tip_locations: ['Remote'],
  }), null);
});
