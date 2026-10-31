'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAREER_CLIENT_KEY,
  CAREERS_URL,
  JOBS_URL,
  JOB_DETAILS_URL,
  fetchAurionproJobs,
  normalizeAurionproPosting,
} = require('../src/scrapers/aurionpro');

function listing(postings, totalCount = postings.length) {
  return {
    code: 1,
    data: { totalCount, careerJobPostings: postings },
    message: 'Success',
  };
}

function detail(overrides = {}) {
  return {
    code: 1,
    data: {
      requisitionId: 'REQ-1001',
      jobTitle: 'Senior Software Engineer',
      location: 'Navi Mumbai, India',
      country: 'India',
      isCandidateApplyOnBoardingForm: true,
      candidateApplyLink: 'https://candidate.example/apply/REQ-1001',
      eT_Desc: 'Full time',
      startDate: '2026-10-25T00:00:00Z',
      endDate: '2026-11-25T00:00:00Z',
      jobDescription: '<p>Build reliable services.</p>',
      skillsAndCompetencies: 'Java &amp; SQL',
      ...overrides,
    },
  };
}

test('Aurionpro posting mapper requires India eligibility and an official HTTPS apply link', () => {
  const job = normalizeAurionproPosting(
    { requisitionId: 'REQ-1001' },
    detail().data
  );

  assert.equal(job.company, 'Aurionpro Solutions');
  assert.equal(job.company_name, 'Aurionpro Solutions');
  assert.equal(job.country, 'India');
  assert.equal(job.location, 'Navi Mumbai, India');
  assert.equal(job.external_job_id, 'REQ-1001');
  assert.equal(job.employment_type, 'Full time');
  assert.equal(job.description, 'Build reliable services.');
  assert.equal(job.skills, 'Java & SQL');
  assert.equal(job.apply_url, 'https://candidate.example/apply/REQ-1001');
  assert.equal(job.posted_date, '2026-10-25T00:00:00.000Z');

  assert.equal(normalizeAurionproPosting(
    { requisitionId: 'REQ-1002' },
    detail({ location: 'Singapore', country: 'Singapore', requisitionId: 'REQ-1002' }).data
  ), null);
  assert.equal(normalizeAurionproPosting(
    { requisitionId: 'REQ-1003' },
    detail({ candidateApplyLink: 'http://candidate.example/apply/REQ-1003' }).data
  ), null);
  assert.equal(normalizeAurionproPosting(
    { requisitionId: 'REQ-1004' },
    detail({ isCandidateApplyOnBoardingForm: false }).data
  ), null);
});

test('Aurionpro fetcher pages listings and follows their official detail records', async () => {
  const calls = [];
  const response = await fetchAurionproJobs({
    request: async (url, config) => {
      calls.push({ url, config });
      if (url === JOBS_URL) {
        const pageIndex = config.params.pageIndex;
        return {
          data: pageIndex === 1
            ? listing([{ requisitionId: 'REQ-1001' }], 2)
            : listing([{ requisitionId: 'REQ-1002' }], 2),
        };
      }
      assert.equal(url, JOB_DETAILS_URL);
      const requisitionId = config.params.requisitionId;
      return {
        data: detail({
          requisitionId,
          candidateApplyLink: `https://candidate.example/apply/${requisitionId}`,
        }),
      };
    },
  });

  assert.equal(calls.length, 4);
  assert.equal(calls[0].config.params.careerClientKey, CAREER_CLIENT_KEY);
  assert.equal(calls[0].config.params.pageIndex, 1);
  assert.equal(calls[0].config.params.pageSize, 50);
  assert.equal(calls[0].config.headers.Referer, CAREERS_URL);
  assert.equal(calls[2].config.params.pageIndex, 2);
  assert.equal(response.listingJobsFetched, 2);
  assert.equal(response.detailJobsFetched, 2);
  assert.equal(response.pageCount, 2);
  assert.deepEqual(response.jobs.map((job) => job.external_job_id), ['REQ-1001', 'REQ-1002']);
});

test('Aurionpro fetcher accepts an empty official feed and rejects malformed responses', async () => {
  const empty = await fetchAurionproJobs({
    request: async () => ({ data: listing([], 0) }),
  });
  assert.deepEqual(empty.jobs, []);
  assert.equal(empty.pageCount, 1);

  await assert.rejects(
    fetchAurionproJobs({ request: async () => ({ data: { code: 1, data: {} } }) }),
    /Aurionpro public jobs API returned an invalid response/
  );
  await assert.rejects(
    fetchAurionproJobs({
      request: async (url) => (url === JOBS_URL
        ? { data: listing([{ requisitionId: 'REQ-1001' }]) }
        : { data: { code: 1, data: null } }),
    }),
    /Aurionpro public job-details API returned an invalid response/
  );
  await assert.rejects(
    fetchAurionproJobs({ signal: { aborted: true }, request: assert.fail }),
    /Aurionpro jobs request aborted/
  );
});
