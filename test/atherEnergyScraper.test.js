'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAREERS_URL,
  JOBS_API_URL,
  fetchAtherEnergyJobs,
  normalizeAtherDate,
  normalizeAtherPosting,
} = require('../src/scrapers/atherEnergy');

function createPage(body, calls = {}, status = 200) {
  return {
    async goto(url, options) {
      calls.goto = { url, options };
    },
    async evaluate(_callback, params) {
      calls.params = params;
      return { status, body };
    },
    async close() {
      calls.closed = true;
    },
  };
}

test('Ather Energy adapter maps public India listings and rejects foreign or private jobs', async () => {
  const calls = {};
  const result = await fetchAtherEnergyJobs({
    newPage: async () => createPage(JSON.stringify({
      data: JSON.stringify({
        Engineering: [
          {
            department: 'Software Engineering',
            jobs: [{
              openingid: 'a698205f7e4954',
              job_id: 'a698205f7e4954',
              job_code: 'AE4792',
              title: 'Senior Application Developer',
              posting_title: 'Senior Application Developer',
              group_company: 'Ather Energy Limited',
              location: 'Bengaluru, Karnataka, India (HO_IBC)',
              location_country: 'India',
              employee_type: 'Permanent',
              job_created_timestamp: '19:58:07 03-02-2026',
              post_on_carrers_page: 1,
            }, {
              openingid: 'f123456789ab',
              title: 'London Engineer',
              group_company: 'Ather Energy Limited',
              location: 'London, United Kingdom',
              location_country: 'United Kingdom',
              post_on_carrers_page: 1,
            }, {
              openingid: 'a123456789ab',
              title: 'Internal only',
              group_company: 'Ather Energy Limited',
              location: 'Bengaluru, India',
              location_country: 'India',
              post_on_carrers_page: 0,
            }, {
              openingid: 'a123456789ac',
              title: 'Different group',
              group_company: 'Other Company',
              location: 'Bengaluru, India',
              location_country: 'India',
              post_on_carrers_page: 1,
            }],
          },
        ],
      }),
    }), calls),
  });

  assert.deepEqual(calls.goto, {
    url: CAREERS_URL,
    options: { waitUntil: 'domcontentloaded', timeout: 45000 },
  });
  assert.equal(calls.params.apiUrl, JOBS_API_URL);
  assert.equal(calls.closed, true);
  assert.equal(result.fetched, 4);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.skippedIndia, 1);
  assert.equal(result.jobs[0].company, 'Ather Energy');
  assert.equal(result.jobs[0].location, 'Bengaluru, Karnataka, India (HO_IBC)');
  assert.equal(result.jobs[0].employment_type, 'Permanent');
  assert.equal(result.jobs[0].posted_date, '2026-02-03T14:28:07.000Z');
  assert.equal(result.jobs[0].external_job_id, 'AE4792');
  assert.equal(
    result.jobs[0].apply_url,
    'https://careers.atherenergy.com/application-form/a698205f7e4954'
  );
});

test('Ather Energy adapter caps results and closes page on malformed API payloads', async () => {
  const postings = Array.from({ length: 5 }, (_, index) => ({
    openingid: `a123456789a${index}`,
    title: `India role ${index}`,
    group_company: 'Ather Energy Limited',
    location: 'Bengaluru, India',
    location_country: 'India',
    post_on_carrers_page: 1,
  }));
  const calls = {};
  const result = await fetchAtherEnergyJobs({
    maxJobs: 2,
    newPage: async () => createPage(JSON.stringify({
      data: JSON.stringify({ Engineering: [{ jobs: postings }] }),
    }), calls),
  });
  assert.equal(result.jobs.length, 2);
  assert.equal(result.fetched, 2);
  assert.equal(calls.closed, true);

  const invalidCalls = {};
  await assert.rejects(
    fetchAtherEnergyJobs({
      newPage: async () => createPage(JSON.stringify({
        data: JSON.stringify({ Engineering: {} }),
      }), invalidCalls),
    }),
    /Ather Energy jobs payload contained an invalid department group/
  );
  assert.equal(invalidCalls.closed, true);
  await assert.rejects(
    fetchAtherEnergyJobs({
      newPage: async () => createPage('not json'),
    }),
    /Ather Energy public jobs API returned invalid JSON/
  );
});

test('Ather Energy normalizer validates locations, public status, IDs, and posting dates', () => {
  assert.equal(normalizeAtherDate('19:58:07 03-02-2026'), '2026-02-03T14:28:07.000Z');
  assert.equal(normalizeAtherDate('not a date'), null);
  assert.equal(normalizeAtherPosting({
    openingid: '../invalid',
    title: 'Invalid ID',
    group_company: 'Ather Energy Limited',
    location: 'Bengaluru, India',
    location_country: 'India',
    post_on_carrers_page: 1,
  }), null);
  assert.equal(normalizeAtherPosting({
    openingid: 'a123456789ab',
    title: 'Unverified location',
    group_company: 'Ather Energy Limited',
    location: 'Remote',
    post_on_carrers_page: 1,
  }), null);
});
