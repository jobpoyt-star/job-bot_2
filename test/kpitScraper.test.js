'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchKpitJobs,
  getKpitApplyUrl,
  normalizeKpitPosting,
  parseKpitListing,
  INDIA_JOBS_URL,
  JOBS_URL,
} = require('../src/scrapers/kpit');

function card({
  id = 84155,
  title = 'Principal Embedded Software Engineer',
  location = 'Pune',
  experience = 'Exp 8-13 years',
  employmentType = 'Full Time',
  skills = 'C++ &amp; Linux',
  applicationHost = 'talentojo.kpit.com',
  applyClass = 'job-apply talentojo-button',
} = {}) {
  return `<div class="f-col job-div">
    <div class="search_job_box">
      <h3>${title}</h3>
      <span class="job-loaction">${location}</span>
      <span class="job-time">${employmentType}</span>
      <span class="job-exp">${experience}</span>
      <p class="skills-txt">${skills}</p>
      <a class="${applyClass}" href="https://${applicationHost}/tojo/app/job-apply/#/Career%20Portal/${id}">Apply</a>
    </div>
  </div>`;
}

function listing(cards) {
  return `<section id="job-listing">${cards.join('')}</section>`;
}

test('KPIT parser maps official India listings and TalentOjo apply links', () => {
  const postings = parseKpitListing(listing([card()]));
  assert.equal(postings.length, 1);
  assert.deepEqual(postings[0], {
    title: 'Principal Embedded Software Engineer',
    location: 'Pune',
    employmentType: 'Full Time',
    experience: 'Exp 8-13 years',
    skills: 'C++ & Linux',
    applyUrl: 'https://talentojo.kpit.com/tojo/app/job-apply/#/Career%20Portal/84155',
  });

  const job = normalizeKpitPosting(postings[0]);
  assert.equal(job.company, 'KPIT Technologies');
  assert.equal(job.company_name, 'KPIT Technologies');
  assert.equal(job.location, 'Pune, India');
  assert.equal(job.country, 'India');
  assert.equal(job.experience, '8-13 years');
  assert.equal(job.employment_type, 'Full Time');
  assert.equal(job.skills, 'C++ & Linux');
  assert.equal(job.external_job_id, '84155');
  assert.equal(job.posted_date, null);
  assert.equal(
    job.apply_url,
    'https://talentojo.kpit.com/tojo/app/job-apply/#/Career%20Portal/84155'
  );
});

test('KPIT parser rejects unverified application hosts and malformed listings', () => {
  assert.equal(getKpitApplyUrl('https://example.com/tojo/app/job-apply/#/Career%20Portal/84155'), null);
  assert.equal(getKpitApplyUrl('https://talentojo.kpit.com/tojo/app/job-apply/#/Career%20Portal/abc'), null);
  assert.equal(normalizeKpitPosting({
    title: 'No apply link',
    location: 'Pune',
  }), null);
  assert.throws(() => parseKpitListing('<html>unavailable</html>'), /invalid response/);
  assert.throws(
    () => parseKpitListing(listing([`<div class="f-col job-div"><h3>Missing apply link</h3></div>`])),
    /without a verified Apply link/
  );
});

test('KPIT fetcher requests all India listings and honors the max-jobs limit', async () => {
  const calls = [];
  const result = await fetchKpitJobs({
    request: async (url, config) => {
      calls.push({ url, config });
      return {
        data: listing([
          card({ id: 84155, location: 'Pune' }),
          card({ id: 83922, title: 'ADAS Engineer', location: 'Bangalore' }),
        ]),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, JOBS_URL);
  assert.deepEqual(calls[0].config.params, {
    country: 'India',
    location: '',
    exp: '0',
    show_all: '1',
  });
  assert.equal(calls[0].config.headers.Referer, 'https://www.kpit.com/careers-overview/');
  assert.equal(INDIA_JOBS_URL, 'https://www.kpit.com/job-listing/?country=India&location=&exp=0&show_all=1');
  assert.equal(result.fetched, 2);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.pageCount, 1);

  const capped = await fetchKpitJobs({
    maxJobs: 1,
    request: async () => ({ data: listing([card(), card({ id: 83922 })]) }),
  });
  assert.equal(capped.jobs.length, 1);
});

test('KPIT fetcher surfaces incomplete pages and honors aborts', async () => {
  await assert.rejects(
    fetchKpitJobs({ request: async () => ({ data: '<html>unavailable</html>' }) }),
    /KPIT public jobs page returned an invalid response/
  );
  await assert.rejects(
    fetchKpitJobs({
      signal: { aborted: true },
      request: assert.fail,
    }),
    /KPIT Technologies jobs request aborted/
  );
});
