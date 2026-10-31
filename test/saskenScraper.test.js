'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchSaskenJobs,
  getSaskenApplyUrl,
  normalizeSaskenPosting,
  INDIA_LISTING_URL,
  JOBS_API_URL,
} = require('../src/scrapers/sasken');

function createPage(listing, calls = {}) {
  return {
    async goto(url, options) {
      calls.goto = { url, options };
    },
    async evaluate(_callback, params) {
      calls.listingOptions = params;
      return listing;
    },
    async close() {
      calls.closed = true;
    },
  };
}

function posting(id, overrides = {}) {
  return {
    _id: id,
    title: `India job ${id}`,
    created_at: '2026-10-29T05:32:01Z',
    needjson: {
      location: [{
        city: { display: 'Bengaluru' },
        state: { display: 'Karnataka' },
        country: { display: 'India' },
        uniqueuiref: 'Bengaluru, Karnataka, India',
      }],
      experience: { min: 60, max: 120 },
    },
    jd_summary: 'A Sasken role.',
    jd_primary_skills: ['C++'],
    jd_secondary_skills: ['Linux'],
    jobURL: `https://www.hirewand.com/apply/job/detail?jid=${id}&src=jobpost&cpid=2022`,
    ...overrides,
  };
}

test('Sasken adapter normalizes India jobs and rejects foreign and untrusted routes', () => {
  const metrics = { skippedIndia: 0 };
  const job = normalizeSaskenPosting(posting('20222813'), metrics);
  assert.equal(job.company, 'Sasken Technologies');
  assert.equal(job.location, 'Bengaluru, Karnataka, India');
  assert.equal(job.experience, '5 - 10 years');
  assert.deepEqual(job.skills, ['C++', 'Linux']);
  assert.equal(job.external_job_id, '20222813');
  assert.equal(job.apply_url, posting('20222813').jobURL);

  const foreign = posting('2022553', {
    title: 'Finland job',
    needjson: {
      location: [{
        city: { display: 'Tampere' },
        state: { display: 'Pirkanmaa' },
        country: { display: 'Finland' },
        uniqueuiref: 'Tampere, Pirkanmaa, Finland',
      }],
    },
  });
  assert.equal(normalizeSaskenPosting(foreign, metrics), null);
  assert.equal(metrics.skippedIndia, 1);
  assert.equal(normalizeSaskenPosting(posting('2022554', {
    needjson: { location: [] },
  }), metrics), null);
  assert.equal(metrics.skippedIndia, 2);
  const verifiedRegionalRole = normalizeSaskenPosting(posting('2022555', {
    needjson: { location: [] },
  }), metrics, { indiaListingVerified: true });
  assert.equal(verifiedRegionalRole.location, 'India');
  assert.equal(normalizeSaskenPosting(posting('20222813', {
    jobURL: 'https://example.com/apply/job/detail?jid=20222813&cpid=2022',
  })), null);
  assert.equal(getSaskenApplyUrl(posting('../outside'), '../outside'), null);
});

test('Sasken API adapter paginates, caps jobs, and rejects malformed payloads', async () => {
  const calls = [];
  const pageCalls = {};
  const result = await fetchSaskenJobs({
    maxJobs: 100,
    newPage: async () => createPage({ ids: ['1', '3'], pageCount: 2 }, pageCalls),
    request: async (url, config) => {
      calls.push({ url, config });
      const offset = config.params.offset;
      return {
        data: {
          status: 'success',
          jobs: {
            matchCount: 3,
            offset,
            requirements: offset === 0
              ? [posting(1), posting(2, {
                needjson: {
                  location: [{
                    city: { display: 'Tampere' },
                    state: { display: 'Pirkanmaa' },
                    country: { display: 'Finland' },
                    uniqueuiref: 'Tampere, Pirkanmaa, Finland',
                  }],
                },
              })]
              : [posting(3)],
          },
        },
      };
    },
  });

  assert.deepEqual(pageCalls.goto, {
    url: INDIA_LISTING_URL,
    options: { waitUntil: 'domcontentloaded', timeout: 45000 },
  });
  assert.equal(pageCalls.closed, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ config }) => config.params.offset), [0, 2]);
  assert.equal(calls[0].url, JOBS_API_URL);
  assert.equal(calls[0].config.headers.Referer, INDIA_LISTING_URL);
  assert.equal(result.fetched, 3);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.skippedIndia, 1);
  assert.equal(result.pageCount, 2);

  await assert.rejects(
    fetchSaskenJobs({
      newPage: async () => createPage({ ids: ['1'], pageCount: 1 }),
      request: async () => ({ data: { status: 'failed', jobs: {} } }),
    }),
    /Sasken Technologies public jobs API returned an invalid response/
  );
});

test('Sasken adapter honors the max-jobs cap and abort signal', async () => {
  let requestCount = 0;
  const result = await fetchSaskenJobs({
    maxJobs: 1,
    newPage: async () => createPage({ ids: ['1'], pageCount: 1 }),
    request: async () => {
      requestCount += 1;
      return {
        data: {
          status: 'success',
          jobs: { matchCount: 3, offset: 0, requirements: [posting(1)] },
        },
      };
    },
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(requestCount, 1);

  await assert.rejects(
    fetchSaskenJobs({
      signal: { aborted: true },
      newPage: assert.fail,
      request: assert.fail,
    }),
    /Sasken Technologies jobs request aborted/
  );
});
