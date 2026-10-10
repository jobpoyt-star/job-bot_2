'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchCompanyJobs,
  normalizeGreenhousePosting,
  normalizeLeverPosting,
  normalizeSwiggyPosting,
} = require('../src/scrapers/verifiedProductFeeds');

test('Greenhouse adapter normalizes Razorpay India listings and ignores foreign roles', async () => {
  const requests = [];
  const result = await fetchCompanyJobs('razorpay', {
    request: async (url, config) => {
      requests.push({ url, config });
      return {
        data: {
          meta: { total: 2 },
          jobs: [
            {
              id: 10,
              title: 'Product Engineer',
              location: { name: 'Bengaluru, India' },
              absolute_url: 'https://job-boards.greenhouse.io/razorpay/jobs/10',
              first_published: '2026-10-01T12:00:00Z',
            },
            {
              id: 11,
              title: 'New York Engineer',
              location: { name: 'New York, United States' },
              absolute_url: 'https://job-boards.greenhouse.io/razorpay/jobs/11',
            },
          ],
        },
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].company, 'Razorpay');
  assert.equal(result.jobs[0].location, 'Bengaluru, India');
  assert.equal(result.jobs[0].external_job_id, '10');
});

test('Lever adapter pages listings and maps only India-eligible alternate locations', async () => {
  const requests = [];
  const result = await fetchCompanyJobs('paytm', {
    maxJobs: 3,
    request: async (url, config) => {
      requests.push(config.params);
      if (config.params.skip === 0) {
        return {
          data: [
            {
              id: 'multi',
              text: 'Account Director',
              categories: { location: 'Dubai', allLocations: ['Dubai', 'Noida, Uttar Pradesh', 'Mumbai, Maharashtra'] },
              country: 'AE',
              hostedUrl: 'https://jobs.lever.co/paytm/multi',
            },
            {
              id: 'foreign',
              text: 'London Engineer',
              categories: { location: 'London' },
              country: 'United Kingdom',
              hostedUrl: 'https://jobs.lever.co/paytm/foreign',
            },
            {
              id: 'remote',
              text: 'Unknown Remote Engineer',
              categories: { location: 'Remote' },
              workplaceType: 'remote',
              hostedUrl: 'https://jobs.lever.co/paytm/remote',
            },
          ],
        };
      }
      return {
        data: [{
          id: 'next-page',
          text: 'Hyderabad Engineer',
          categories: { location: 'Hyderabad, India', commitment: 'Full-time' },
          country: 'India',
          hostedUrl: 'https://jobs.lever.co/paytm/next-page',
          applyUrl: 'https://jobs.lever.co/paytm/next-page/apply',
          createdAt: 1791660000000,
        }],
      };
    },
  });

  assert.deepEqual(requests.map((params) => params.skip), [0, 3]);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs[0].location, 'Noida, Uttar Pradesh / Mumbai, Maharashtra');
  assert.equal(result.jobs[1].location, 'Hyderabad, India');
  assert.equal(result.jobs[1].apply_url, 'https://jobs.lever.co/paytm/next-page/apply');
});

test('Swiggy adapter maps verified compact fields and rejects foreign or ambiguous jobs', async () => {
  const result = await fetchCompanyJobs('swiggy', {
    request: async () => ({
      data: {
        total: 3,
        jobs: [
          { t: 'India Role', l: 'Goa, India', e: 'Permanent', u: 'https://jobs.smartrecruiters.com/SWIGGY/1' },
          { t: 'Foreign Role', l: 'London, United Kingdom', u: 'https://jobs.smartrecruiters.com/SWIGGY/2' },
          { t: 'Unknown Role', l: 'Remote', u: 'https://jobs.smartrecruiters.com/SWIGGY/3' },
        ],
      },
    }),
  });

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].title, 'India Role');
  assert.equal(result.jobs[0].location, 'Goa, India');
  assert.equal(result.jobs[0].apply_url, 'https://jobs.smartrecruiters.com/SWIGGY/1');
});

test('feed normalizers require an official application link and do not infer India from descriptions', () => {
  assert.equal(normalizeGreenhousePosting({
    id: 1,
    title: 'No Apply Link',
    location: { name: 'Pune, India' },
  }, 'Groww'), null);

  assert.equal(normalizeLeverPosting({
    id: 'foreign',
    text: 'India mentioned in description',
    categories: { location: 'London' },
    descriptionPlain: 'This description mentions India without indicating job location.',
    hostedUrl: 'https://jobs.lever.co/cred/foreign',
  }, 'CRED'), null);

  assert.equal(normalizeSwiggyPosting({
    t: 'Remote India Role',
    l: 'Remote',
    u: 'https://jobs.smartrecruiters.com/SWIGGY/remote',
  }), null);
});

test('verified feed requests retry transient failures a bounded number of times', async () => {
  let calls = 0;
  const result = await fetchCompanyJobs('groww', {
    wait: async () => {},
    request: async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error('temporary failure');
        error.response = { status: 503, headers: {} };
        throw error;
      }
      return { data: { meta: { total: 0 }, jobs: [] } };
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(result.jobs, []);
});
