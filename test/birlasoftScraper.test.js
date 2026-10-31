'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBirlasoftPosting,
  scrapeBirlasoftJobs,
} = require('../src/scrapers/birlasoft');

const listing = {
  title: 'SAP BASIS SENIOR CONSULTANT',
  location: 'INDIA - NOIDA- BIRLASOFT OFFICE, IN',
  postedDate: 'Oct 3, 2026',
  url: 'https://jobs.birlasoft.com/job/Noida-SAP-BASIS-SENIOR-CONSULTANT-INDI/58613244/',
};

test('Birlasoft normalization requires an India country code and the matching official application URL', () => {
  const job = normalizeBirlasoftPosting({
    ...listing,
    postedDate: '2026-10-03T02:00:00Z',
    country: 'IN',
    applyUrl: 'https://jobs.birlasoft.com/talentcommunity/apply/58613244/?locale=en_US',
    description: 'SAP consulting role',
    expiryDate: 'Thu Nov 26 18:30:00 UTC 2026',
  });

  assert.equal(job.company, 'Birlasoft');
  assert.equal(job.location, listing.location);
  assert.equal(job.external_job_id, '58613244');
  assert.equal(job.apply_url, 'https://jobs.birlasoft.com/talentcommunity/apply/58613244/?locale=en_US');
  assert.equal(job.posted_date, '2026-10-03T02:00:00.000Z');
  assert.equal(job.description, 'SAP consulting role');

  assert.equal(normalizeBirlasoftPosting({
    ...listing,
    country: 'US',
    applyUrl: 'https://jobs.birlasoft.com/talentcommunity/apply/58613244/',
  }), null);
  assert.equal(normalizeBirlasoftPosting({
    ...listing,
    country: 'IN',
    applyUrl: 'https://jobs.birlasoft.com/talentcommunity/apply/1/',
  }), null);
  assert.equal(normalizeBirlasoftPosting({
    ...listing,
    country: 'IN',
    applyUrl: 'https://attacker.example/talentcommunity/apply/58613244/',
  }), null);
});

test('Birlasoft scraper paginates official India listings, verifies details, and closes its page', async () => {
  const visited = [];
  let pageClosed = false;
  const response = await scrapeBirlasoftJobs('', '', false, {
    maxJobs: 2,
    createPage: async () => ({
      async goto(url) {
        visited.push(url);
      },
      async waitForSelector(selector) {
        assert.ok(['#searchresults', '.jobDisplayShell'].includes(selector));
      },
      async $$eval(selector) {
        if (selector === 'tr.data-row') return [
          listing,
          {
            ...listing,
            title: 'Foreign role',
            url: 'https://jobs.birlasoft.com/job/Foreign-role/100/',
          },
        ];
        if (selector === '.jobDisplayShell') {
          const isIndiaRole = visited.at(-1).endsWith('/58613244/');
          return {
            country: isIndiaRole ? 'IN' : 'US',
            postedDate: 'Sat Oct 03 02:00:00 UTC 2026',
            expiryDate: null,
            applyUrl: `https://jobs.birlasoft.com/talentcommunity/apply/${isIndiaRole ? '58613244' : '100'}/`,
            description: isIndiaRole ? 'India listing detail' : null,
          };
        }
        assert.fail(`Unexpected selector: ${selector}`);
      },
      async close() {
        pageClosed = true;
      },
    }),
  });

  assert.deepEqual(response.result.map((job) => job.title), [listing.title]);
  assert.equal(response.stats.pageCount, 1);
  assert.equal(response.stats.listingJobsFetched, 2);
  assert.equal(response.stats.detailJobsFetched, 2);
  assert.equal(response.stats.skippedIndia, 1);
  assert.equal(pageClosed, true);
  assert.equal(visited[0], 'https://jobs.birlasoft.com/search/?q=&locationsearch=India');
});
