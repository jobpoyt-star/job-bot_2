'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getGenpactApplyUrl,
  getIndiaLocationIds,
  normalizeGenpactPosting,
  WORKDAY_BASE_URL,
} = require('../src/scrapers/genpact');

const externalPath = '/job/1401-G-India-STPI-Gurgaon/Engineer-Cloud-Technologies_JR10033384';

test('Genpact location facets select India locations and exclude foreign offices', () => {
  const ids = getIndiaLocationIds({
    facets: [{
      facetParameter: 'locationMainGroup',
      values: [{
        facetParameter: 'locations',
        values: [
          { descriptor: '1401-G-India: STPI, Gurgaon', id: 'india-id' },
          { descriptor: '1401-GIPL: STPI, Bangalore', id: 'gipl-india-id' },
          { descriptor: '1415-GERC: Gurgaon', id: 'gerc-india-id' },
          { descriptor: '3409-G-LLC: New York, USA', id: 'us-id' },
        ],
      }],
    }],
  });

  assert.deepEqual(ids, ['india-id', 'gipl-india-id', 'gerc-india-id']);
  assert.throws(() => getIndiaLocationIds({ facets: [] }), /did not include its location facets/);
});

test('Genpact jobs require an India detail, apply-ready Workday route, and matching listing path', () => {
  const posting = {
    title: 'Engineer - Cloud Technologies',
    externalPath,
    locationsText: 'Gurgaon',
    bulletFields: ['JR10033384'],
  };
  const details = {
    title: 'Engineer - Cloud Technologies',
    jobReqId: 'JR10033384',
    location: 'STPI, Gurgaon',
    country: { descriptor: 'India' },
    canApply: true,
    externalUrl: `${WORKDAY_BASE_URL}${externalPath}`,
    startDate: '2026-10-31',
    timeType: 'Full time',
    remoteType: 'Hybrid',
    jobDescription: '<p>Build cloud services.</p>',
  };

  const job = normalizeGenpactPosting(posting, details);
  assert.equal(job.company, 'Genpact');
  assert.equal(job.location, 'STPI, Gurgaon, India');
  assert.equal(job.external_job_id, 'JR10033384');
  assert.equal(job.employment_type, 'Full time');
  assert.equal(job.work_mode, 'Hybrid');
  assert.equal(job.apply_url, `${WORKDAY_BASE_URL}${externalPath}`);

  assert.equal(normalizeGenpactPosting(posting, {
    ...details,
    country: { descriptor: 'United States of America' },
    location: 'New York',
  }), null);
  assert.equal(normalizeGenpactPosting(posting, { ...details, canApply: false }), null);
  assert.equal(normalizeGenpactPosting(posting, {
    ...details,
    externalUrl: 'https://example.com/job',
  }), null);
  assert.equal(getGenpactApplyUrl('https://genpact.wd108.myworkdayjobs.com/other/job/foo', externalPath), null);
});
