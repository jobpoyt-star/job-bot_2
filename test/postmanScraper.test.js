'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAREERS_URL,
  JOBS_URL,
  WORKDAY_API_URL,
  WORKDAY_BASE_URL,
  fetchPostmanJobs,
  getPostmanApplyUrl,
  normalizePostmanPosting,
} = require('../src/scrapers/postman');

function posting(index, overrides = {}) {
  const externalPath = `/job/Bangalore-India/Software-Engineer_JR${1000 + index}`;
  return {
    title: 'Software Engineer',
    externalPath,
    locationsText: 'Bangalore, India',
    bulletFields: [`JR${1000 + index}`],
    ...overrides,
  };
}

function detail(jobPosting, overrides = {}) {
  return {
    jobPostingInfo: {
      title: jobPosting.title,
      location: jobPosting.locationsText,
      country: { descriptor: 'India' },
      jobReqId: jobPosting.bulletFields[0],
      canApply: true,
      externalUrl: `${WORKDAY_BASE_URL}${jobPosting.externalPath}`,
      startDate: '2026-10-29',
      endDate: '2026-11-29',
      timeType: 'Full time',
      jobDescription: '<p>Build reliable APIs.</p>',
      ...overrides,
    },
  };
}

test('Postman mapper accepts only India jobs with active matching Workday applications', () => {
  const jobPosting = posting(1);
  const job = normalizePostmanPosting(jobPosting, detail(jobPosting).jobPostingInfo);

  assert.equal(job.company, 'Postman');
  assert.equal(job.company_name, 'Postman');
  assert.equal(job.location, 'Bangalore, India');
  assert.equal(job.country, 'India');
  assert.equal(job.external_job_id, 'JR1001');
  assert.equal(job.employment_type, 'Full time');
  assert.equal(job.description, '<p>Build reliable APIs.</p>');
  assert.equal(job.apply_url, `${WORKDAY_BASE_URL}${jobPosting.externalPath}`);
  assert.equal(job.posted_date, '2026-10-29T00:00:00.000Z');
  assert.equal(job.expiry_date, '2026-11-29T00:00:00.000Z');

  assert.equal(normalizePostmanPosting(jobPosting, detail(jobPosting, {
    location: 'San Francisco, CA, US',
    country: { descriptor: 'United States of America' },
  }).jobPostingInfo), null);
  assert.equal(normalizePostmanPosting(jobPosting, detail(jobPosting, { canApply: false }).jobPostingInfo), null);
  assert.equal(normalizePostmanPosting(jobPosting, detail(jobPosting, {
    externalUrl: 'https://example.com/job',
  }).jobPostingInfo), null);
  assert.equal(getPostmanApplyUrl(
    `${WORKDAY_BASE_URL}/job/Bangalore-India/Different-Job_JR1002`,
    jobPosting.externalPath
  ), null);
});

test('Postman fetcher paginates postings and retrieves matching official job details', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => posting(index + 1));
  const secondPage = [posting(21), posting(22)];
  const calls = [];

  const response = await fetchPostmanJobs({
    request: async (url, config) => {
      calls.push({ url, config });
      if (url === JOBS_URL) {
        assert.deepEqual(config.data.appliedFacets, {});
        assert.equal(config.data.limit, 20);
        assert.equal(config.data.searchText, '');
        return {
          data: {
            total: 22,
            jobPostings: config.data.offset === 0 ? firstPage : secondPage,
          },
        };
      }

      const currentPosting = [...firstPage, ...secondPage]
        .find((item) => `${WORKDAY_API_URL}${item.externalPath}` === url);
      assert.ok(currentPosting);
      const isIndia = currentPosting.bulletFields[0] === 'JR1001';
      return {
        data: detail(currentPosting, isIndia
          ? {}
          : { location: 'San Francisco, CA, US', country: { descriptor: 'United States of America' } }),
      };
    },
  });

  assert.equal(calls[0].config.headers.Referer, CAREERS_URL);
  assert.equal(calls[1].config.method, 'GET');
  assert.equal(calls[21].config.data.offset, 20);
  assert.equal(response.pageCount, 2);
  assert.equal(response.listingJobsFetched, 22);
  assert.equal(response.detailJobsFetched, 22);
  assert.equal(response.skippedIndia, 21);
  assert.deepEqual(response.jobs.map((job) => job.external_job_id), ['JR1001']);
});

test('Postman fetcher rejects invalid public feed and job details', async () => {
  await assert.rejects(
    fetchPostmanJobs({ request: async () => ({ data: {} }) }),
    /Postman public jobs API returned an invalid response/
  );
  await assert.rejects(
    fetchPostmanJobs({
      request: async (url) => (url === JOBS_URL
        ? { data: { total: 1, jobPostings: [posting(1)] } }
        : { data: {} }),
    }),
    /Postman public job-details API returned an invalid response/
  );
  await assert.rejects(
    fetchPostmanJobs({ signal: { aborted: true }, request: assert.fail }),
    /Postman jobs request aborted/
  );
});
