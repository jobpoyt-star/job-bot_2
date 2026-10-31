'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAREERS_URL,
  JOBS_URL,
  WORKDAY_API_URL,
  WORKDAY_BASE_URL,
  fetchBrowserStackJobs,
  getBrowserStackApplyUrl,
  normalizeBrowserStackPosting,
} = require('../src/scrapers/browserstack');

function posting(index, overrides = {}) {
  const externalPath = `/job/India-Remote/Software-Engineer_JR${1000 + index}`;
  return {
    title: 'Software Engineer',
    externalPath,
    locationsText: 'India Remote',
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
      timeType: 'Full time',
      jobDescription: '<p>Build reliable software.</p>',
      ...overrides,
    },
  };
}

test('BrowserStack mapper accepts only India-eligible active applications on the matching Workday route', () => {
  const jobPosting = posting(1);
  const job = normalizeBrowserStackPosting(jobPosting, detail(jobPosting).jobPostingInfo);

  assert.equal(job.company, 'BrowserStack');
  assert.equal(job.company_name, 'BrowserStack');
  assert.equal(job.country, 'India');
  assert.equal(job.location, 'India Remote');
  assert.equal(job.external_job_id, 'JR1001');
  assert.equal(job.employment_type, 'Full time');
  assert.equal(job.apply_url, `${WORKDAY_BASE_URL}${jobPosting.externalPath}`);
  assert.equal(job.posted_date, '2026-10-29T00:00:00.000Z');

  assert.equal(normalizeBrowserStackPosting(jobPosting, detail(jobPosting, {
    location: 'San Francisco',
    country: { descriptor: 'United States of America' },
  }).jobPostingInfo), null);
  assert.equal(normalizeBrowserStackPosting(jobPosting, detail(jobPosting, { canApply: false }).jobPostingInfo), null);
  assert.equal(normalizeBrowserStackPosting(jobPosting, detail(jobPosting, {
    externalUrl: 'https://example.com/job',
  }).jobPostingInfo), null);
  assert.equal(getBrowserStackApplyUrl(
    `${WORKDAY_BASE_URL}/job/India-Remote/Different-Job_JR1002`,
    jobPosting.externalPath
  ), null);
});

test('BrowserStack fetcher paginates all listings and fetches official job details', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => posting(index + 1));
  const secondPage = [posting(21), posting(22)];
  const calls = [];

  const response = await fetchBrowserStackJobs({
    request: async (url, config) => {
      calls.push({ url, config });
      if (url === JOBS_URL) {
        const { offset, limit, searchText, appliedFacets } = config.data;
        assert.equal(limit, 20);
        assert.equal(searchText, '');
        assert.deepEqual(appliedFacets, {});
        return { data: { total: 22, jobPostings: offset === 0 ? firstPage : secondPage } };
      }

      const currentPosting = [...firstPage, ...secondPage]
        .find((item) => `${WORKDAY_API_URL}${item.externalPath}` === url);
      assert.ok(currentPosting);
      const isIndia = currentPosting.bulletFields[0] === 'JR1001';
      return {
        data: detail(currentPosting, isIndia
          ? {}
          : { location: 'San Francisco', country: { descriptor: 'United States of America' } }),
      };
    },
  });

  assert.equal(calls[0].config.headers.Referer, CAREERS_URL);
  assert.equal(calls[21].config.data.offset, 20);
  assert.equal(response.pageCount, 2);
  assert.equal(response.listingJobsFetched, 22);
  assert.equal(response.detailJobsFetched, 22);
  assert.equal(response.skippedIndia, 21);
  assert.deepEqual(response.jobs.map((job) => job.external_job_id), ['JR1001']);
});

test('BrowserStack fetcher rejects invalid feed and detail responses', async () => {
  await assert.rejects(
    fetchBrowserStackJobs({ request: async () => ({ data: {} }) }),
    /BrowserStack public jobs API returned an invalid response/
  );
  await assert.rejects(
    fetchBrowserStackJobs({
      request: async (url) => (url === JOBS_URL
        ? { data: { total: 1, jobPostings: [posting(1)] } }
        : { data: {} }),
    }),
    /BrowserStack public job-details API returned an invalid response/
  );
  await assert.rejects(
    fetchBrowserStackJobs({ signal: { aborted: true }, request: assert.fail }),
    /BrowserStack jobs request aborted/
  );
});
