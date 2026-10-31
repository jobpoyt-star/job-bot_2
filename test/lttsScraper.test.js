'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePostingDate } = require('../src/utils/postingDate');
const {
  fetchLttsJobs,
  getLttsApplyUrl,
  normalizeLttsPosting,
  parseLttsListing,
  INDIA_JOBS_URL,
  JOBS_URL,
} = require('../src/scrapers/ltts');

function row({
  href = '/job/Bangalore-Engineer/572438410/',
  title = 'Engineer',
  requisitionId = 'LTTS-123',
  date = 'Oct 31, 2026',
  location = 'Bangalore, IN',
} = {}) {
  return `<tr class="data-row">
    <td class="colTitle"><a href="${href}" class="jobTitle-link">${title}</a></td>
    <td class="colFacility">${requisitionId}</td>
    <td class="colDate">${date}</td>
    <td class="colLocation">${location}</td>
  </tr>`;
}

function listing(rows, total = rows.length) {
  return `<span class="paginationLabel" aria-label="Results 1 – ${rows.length}">
    Results <b>1 – ${rows.length}</b> of <b>${total}</b>
  </span><table id="searchresults"><tbody>${rows.join('')}</tbody></table>`;
}

test('LTTS parser maps India listings to official same-job detail pages', () => {
  const parsed = parseLttsListing(listing([row({
    title: 'Sr UI Developer',
    href: '/job/Bangalore-Sr-UI-Developer/572438410/',
    requisitionId: '121523',
  })]));

  assert.equal(parsed.total, 1);
  assert.deepEqual(parsed.rows[0], {
    title: 'Sr UI Developer',
    detailHref: '/job/Bangalore-Sr-UI-Developer/572438410/',
    requisitionId: '121523',
    postedDate: 'Oct 31, 2026',
    location: 'Bangalore, IN',
  });

  const metrics = { skippedIndia: 0 };
  const job = normalizeLttsPosting(parsed.rows[0], metrics);
  assert.equal(job.company, 'L&T Technology Services');
  assert.equal(job.location, 'Bangalore, IN, India');
  assert.equal(job.country, 'India');
  assert.equal(job.posted_date, normalizePostingDate('Oct 31, 2026'));
  assert.equal(job.external_job_id, '121523');
  assert.equal(job.apply_url, 'https://jobs.ltts.com/job/Bangalore-Sr-UI-Developer/572438410/');
  assert.equal(metrics.skippedIndia, 0);
});

test('LTTS parser rejects foreign locations, malformed application links, and bad payloads', () => {
  const metrics = { skippedIndia: 0 };
  assert.equal(normalizeLttsPosting({
    ...parseLttsListing(listing([row({ location: 'Houston, US' })])).rows[0],
  }, metrics), null);
  assert.equal(metrics.skippedIndia, 1);

  assert.equal(getLttsApplyUrl('https://example.com/job/Engineer/123/'), null);
  assert.equal(getLttsApplyUrl('/talentcommunity/apply/123/'), null);
  assert.throws(() => parseLttsListing('<html>no listing count</html>'), /did not include a results count/);
  assert.throws(() => parseLttsListing(null), /invalid response/);
});

test('LTTS fetcher paginates India search results and respects max-jobs', async () => {
  const calls = [];
  const result = await fetchLttsJobs({
    request: async (url, config) => {
      calls.push({ url, params: config.params });
      const startrow = config.params.startrow;
      return {
        data: startrow === 0
          ? listing(Array.from({ length: 10 }, (_, index) => row({
            href: `/job/Bangalore-Engineer-${index}/57${index}/`,
            title: `Engineer ${index}`,
            requisitionId: `LTTS-${index}`,
          })), 12)
          : listing([
            row({
              href: '/job/Pune-Engineer-10/5710/',
              title: 'Engineer 10',
              requisitionId: 'LTTS-10',
            }),
            row({
              href: '/job/Mumbai-Engineer-11/5711/',
              title: 'Engineer 11',
              requisitionId: 'LTTS-11',
            }),
          ], 12),
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ url, params }) => ({ url, params })), [
    {
      url: JOBS_URL,
      params: { createNewAlert: 'false', q: '', locationsearch: 'India', startrow: 0 },
    },
    {
      url: JOBS_URL,
      params: { createNewAlert: 'false', q: '', locationsearch: 'India', startrow: 10 },
    },
  ]);
  assert.equal(INDIA_JOBS_URL, 'https://jobs.ltts.com/search/?createNewAlert=false&q=&locationsearch=India');
  assert.equal(result.fetched, 12);
  assert.equal(result.jobs.length, 12);
  assert.equal(result.pageCount, 2);
  assert.equal(result.jobs[10].title, 'Engineer 10');

  const capped = await fetchLttsJobs({
    maxJobs: 1,
    request: async () => ({ data: listing([row()], 12) }),
  });
  assert.equal(capped.jobs.length, 1);
  assert.equal(capped.pageCount, 1);
});

test('LTTS fetcher rejects invalid and incomplete page responses', async () => {
  await assert.rejects(
    fetchLttsJobs({ request: async () => ({ data: '<html>unavailable</html>' }) }),
    /LTTS public jobs page did not include a results count/
  );
  await assert.rejects(
    fetchLttsJobs({
      request: async () => ({ data: listing([], 12) }),
    }),
    /returned no postings before the results ended/
  );
  await assert.rejects(
    fetchLttsJobs({
      signal: { aborted: true },
      request: assert.fail,
    }),
    /LTTS jobs request aborted/
  );
});
