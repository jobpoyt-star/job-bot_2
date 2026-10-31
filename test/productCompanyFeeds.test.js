'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchCompanyJobs,
  normalizeGreenhousePosting,
  normalizeLeverPosting,
  normalizeCyientPosting,
  normalizeSwiggyPosting,
  normalizeFlipkartPosting,
  normalizeTurboHirePosting,
  normalizeMakeMyTripPosting,
  normalizeZerodhaPosting,
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
  assert.equal(requests[0].config.headers['User-Agent'], 'Mozilla/5.0 (compatible; JOBPOYTJobBot/1.0)');
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].company, 'Razorpay');
  assert.equal(result.jobs[0].location, 'Bengaluru, India');
  assert.equal(result.jobs[0].external_job_id, '10');
});

test('Groww uses the verified Greenhouse public board API endpoint', async () => {
  let requestedUrl;
  const result = await fetchCompanyJobs('groww', {
    request: async (url) => {
      requestedUrl = url;
      return {
        data: {
          jobs: [{
            id: 4979964101,
            title: 'Engineer',
            location: { name: 'Bengaluru, India' },
            absolute_url: 'https://job-boards.eu.greenhouse.io/groww/jobs/4979964101',
            first_published: '2026-10-08T02:22:36-04:00',
          }],
        },
      };
    },
  });

  assert.equal(requestedUrl, 'https://boards-api.greenhouse.io/v1/boards/groww/jobs');
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].company, 'Groww');
  assert.equal(result.jobs[0].location, 'Bengaluru, India');
});

test('Zensar and Hexaware Oracle feeds return only India postings with official apply links', async () => {
  const expectedOrigins = {
    zensar: 'https://fa-etvl-saasfaprod1.fa.ocs.oraclecloud.com',
    hexaware: 'https://fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com',
  };

  for (const [company, origin] of Object.entries(expectedOrigins)) {
    let requestParams;
    const result = await fetchCompanyJobs(company, {
      request: async (url, config) => {
        assert.equal(url, `${origin}/hcmRestApi/resources/11.13.18.05/recruitingCEJobRequisitions`);
        requestParams = config.params;
        return {
          data: {
            items: [{
              TotalJobsCount: 2,
              requisitionList: [
                {
                  Id: 'job-india',
                  Title: 'India Engineer',
                  PostedDate: '2026-10-08',
                  PrimaryLocationCountry: 'IN',
                  PrimaryLocation: 'India',
                  ShortDescriptionStr: 'Engineering role',
                },
                {
                  Id: 'job-us',
                  Title: 'US Engineer',
                  PostedDate: '2026-10-08',
                  PrimaryLocationCountry: 'US',
                  PrimaryLocation: 'United States',
                },
              ],
            }],
          },
        };
      },
    });
    assert.match(requestParams.finder, /siteNumber=CX_1/);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].title, 'India Engineer');
    assert.equal(result.jobs[0].location, 'India');
    assert.equal(result.jobs[0].apply_url, `${origin}/hcmUI/CandidateExperience/en/sites/CX_1/job/job-india`);
    assert.equal(result.jobs[0].posted_date, '2026-10-08T00:00:00.000Z');
    assert.equal(result.skippedIndia, 1);
  }
});

test('Cyient Zwayam feed paginates public listings and keeps only India jobs', async () => {
  const requests = [];
  const forms = [];
  const result = await fetchCompanyJobs('cyient', {
        maxJobs: 2,
        wait: async () => {},
        request: async (url, config) => {
          requests.push({ url, config });
          forms.push(config.data);
          const requestBody = config.data.getBuffer().toString();
          const offset = Number(requestBody.match(/"paginationStartNo":(\d+)/)?.[1] || 0);
          assert.equal(url, 'https://public.zwayam.com/jobs/search');
          assert.match(requestBody, /careers\.cyient\.com/);
          assert.match(requestBody, /MTU0ODY=/);
          if (requests.length === 1) {
            const error = new Error('temporary reset');
            error.code = 'ECONNRESET';
            throw error;
          }
          if (offset === 0) {
            return {
              data: {
                data: {
                  data: [
                  { _source: { referenceNumber: 'JR-IN', jobCode: 1, jobTitle: 'India Engineer', locationSeparatedbySlash: 'Hyderabad, Telangana, India', jobUrl: 'india-engineer-hyderabad', createdDate: 1791533383000 } },
                  { _source: { referenceNumber: 'JR-US', jobCode: 2, jobTitle: 'US Engineer', location: 'Austin, United States', jobUrl: 'us-engineer-austin' } },
                  ],
                  totalCount: 3,
                  hasMoreData: true,
                },
              },
            };
          }
          return {
            data: {
              data: {
                data: [
                  { _source: { referenceNumber: 'JR-IN-2', jobCode: 3, jobTitle: 'Pune Engineer', location: 'Pune, Maharashtra, India', jobUrl: 'pune-engineer' } },
                ],
                totalCount: 3,
                hasMoreData: false,
              },
            },
          };
        },
      });

  assert.deepEqual(requests.map(({ config }) => Number(config.data.getBuffer().toString().match(/"paginationStartNo":(\d+)/)?.[1] || 0)), [0, 0, 2]);
  assert.notEqual(forms[0], forms[1]);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs[0].company, 'Cyient');
  assert.equal(result.jobs[0].location, 'Hyderabad, Telangana, India');
  assert.equal(result.jobs[0].apply_url, 'https://careers.cyient.com/cyient/jobview/india-engineer-hyderabad');
  assert.equal(result.jobs[0].posted_date, new Date(1791533383000).toISOString());
  assert.equal(result.jobs[1].location, 'Pune, Maharashtra, India');
  assert.equal(result.skippedIndia, 1);
  assert.equal(result.pageCount, 2);
});

test('Happiest Minds uses the verified Zwayam portal feed and official job-view route', async () => {
  let requestBody;
  const result = await fetchCompanyJobs('happiestminds', {
    maxJobs: 5,
    request: async (url, config) => {
      assert.equal(url, 'https://public.zwayam.com/jobs/search');
      requestBody = config.data.getBuffer().toString();
      assert.equal(config.headers['User-Agent'], 'Mozilla/5.0 (compatible; JOBPOYTJobBot/1.0)');
      return {
        data: {
          data: {
            data: [
              {
                _source: {
                  referenceNumber: 'HM-IN-1',
                  jobCode: 17699,
                  jobTitle: 'TECHNICAL LEAD - SOC 2',
                  location: 'Bengaluru',
                  locationSeparatedbySlash: 'Bengaluru',
                  jobUrl: 'technical-lead-soc-2-bengaluru-2026101322380228',
                },
              },
              {
                _source: {
                  referenceNumber: 'HM-US-1',
                  jobCode: 17698,
                  jobTitle: 'US Engineer',
                  location: 'Austin, United States',
                  jobUrl: 'us-engineer-austin',
                },
              },
            ],
            totalCount: 2,
            hasMoreData: false,
          },
        },
      };
    },
  });

  assert.match(requestBody, /"paginationStartNo":0/);
  assert.match(requestBody, /jobs\.happiestminds\.com/);
  assert.match(requestBody, /MTU5NzQ=/);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].company, 'Happiest Minds');
  assert.equal(result.jobs[0].location, 'Bengaluru, India');
  assert.equal(
    result.jobs[0].apply_url,
    'https://jobs.happiestminds.com/happiestminds/jobview/technical-lead-soc-2-bengaluru-2026101322380228'
  );
  assert.equal(result.jobs[0].external_job_id, 'HM-IN-1');
  assert.equal(result.skippedIndia, 1);
});

test('Coforge Zwayam feed paginates live-shaped jobs and rejects foreign roles', async () => {
  const requests = [];
  const result = await fetchCompanyJobs('coforge', {
    maxJobs: 2,
    request: async (url, config) => {
      requests.push({ url, config });
      const requestBody = config.data.getBuffer().toString();
      assert.match(requestBody, /careers\.coforge\.com/);
      assert.match(requestBody, /MTUxNzM=/);
      const offset = Number(requestBody.match(/"paginationStartNo":(\d+)/)?.[1] || 0);
      if (offset === 0) {
        return {
          data: {
            data: {
              data: [
                {
                  _source: {
                    referenceNumber: '295308',
                    jobTitle: 'Remote role restricted to USA',
                    location: 'Utah, USA;Idaho, USA;Arizona, USA',
                    jobUrl: 'associate-team-member-work-from-home',
                  },
                },
                {
                  _source: {
                    referenceNumber: '8443-AD1-BLR-ONBD-7-1',
                    jobTitle: 'SENIOR ENGINEER',
                    location: 'Bangalore',
                    locationSeparatedbySlash: 'Bangalore',
                    jobUrl: 'senior-engineer-bangalore-2026100911014118',
                  },
                },
              ],
              totalCount: 171,
              hasMoreData: true,
            },
          },
        };
      }

      return {
        data: {
          data: {
            data: [{
              _source: {
                referenceNumber: '8965-AD-BLR-TM-14-2',
                jobTitle: 'TECHNICAL LEAD',
                location: 'Bangalore',
                locationSeparatedbySlash: 'Bangalore',
                jobUrl: 'technical-lead-bangalore-2026091615275930',
              },
            }],
            totalCount: 171,
            hasMoreData: false,
          },
        },
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(result.jobs.map((job) => job.title), ['SENIOR ENGINEER', 'TECHNICAL LEAD']);
  assert.deepEqual(result.jobs.map((job) => job.location), ['Bangalore, India', 'Bangalore, India']);
  assert.equal(result.jobs[0].company, 'Coforge');
  assert.equal(
    result.jobs[0].apply_url,
    'https://careers.coforge.com/coforge/jobview/senior-engineer-bangalore-2026100911014118'
  );
  assert.equal(result.skippedIndia, 1);
});

test('Zwayam default HTTP transport uses native Node fetch with multipart form data', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, config) => {
    calls.push({ url, config });
    assert.equal(config.method, 'POST');
    assert.equal(config.body instanceof FormData, true);
    assert.equal(config.headers['User-Agent'], undefined);
    assert.equal(config.body.get('domain'), 'careers.coforge.com');
    assert.equal(config.body.get('companyId'), 'MTUxNzM=');
    return {
      ok: true,
      async json() {
        return {
          data: {
            data: [{
              _source: {
                referenceNumber: 'coforge-1',
                jobTitle: 'India engineer',
                location: 'Bangalore',
                jobUrl: 'india-engineer-bangalore',
              },
            }],
            hasMoreData: false,
          },
        };
      },
    };
  };

  try {
    const result = await fetchCompanyJobs('coforge', { maxJobs: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://public.zwayam.com/jobs/search');
    assert.deepEqual(result.jobs.map((job) => job.location), ['Bangalore, India']);
  } finally {
    global.fetch = originalFetch;
  }
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
  assert.equal(result.jobs[0].location, 'Noida, Uttar Pradesh / Mumbai, Maharashtra, India');
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

test('PhonePe feed returns only public listings with official India locations and apply links', async () => {
  let requestedUrl;
  const result = await fetchCompanyJobs('phonepe', {
    request: async (url) => {
      requestedUrl = url;
      return {
        data: {
          results: [
            {
              status: 'PUBLIC',
              applyUrl: 'https://jobs.smartrecruiters.com/PHONEPELIMITED/1000000000001173-ccm-tirupati',
              type: 'Full-time',
              title: 'CCM - Tirupati',
              department: 'Lending Business',
              location: 'Tirupati',
              updatedAt: '/Date(1788134400000)/',
            },
            {
              status: 'PUBLIC',
              applyUrl: 'https://jobs.smartrecruiters.com/PHONEPELIMITED/1000000000001180-software-engineer',
              type: 'Full-time',
              title: 'Bengaluru Engineer',
              department: 'Engineering',
              location: 'Bengaluru',
            },
            {
              status: 'NOT_PUBLISHED',
              applyUrl: 'https://jobs.smartrecruiters.com/PHONEPELIMITED/1000000000001181-private-role',
              title: 'Unpublished role',
              location: 'Bengaluru',
            },
            {
              status: 'PUBLIC',
              applyUrl: 'https://jobs.smartrecruiters.com/OTHERCOMPANY/1000000000001182-role',
              title: 'Wrong company',
              location: 'Bengaluru',
            },
            {
              status: 'PUBLIC',
              applyUrl: 'https://jobs.smartrecruiters.com/PHONEPELIMITED/1000000000001183-remote-role',
              title: 'Unverified remote role',
              location: 'Remote',
            },
          ],
        },
      };
    },
  });

  assert.equal(requestedUrl, 'https://www.phonepe.com/apollo/job-postings/latest.json');
  assert.deepEqual(result.jobs.map((job) => job.title), ['CCM - Tirupati', 'Bengaluru Engineer']);
  assert.equal(result.jobs[0].company, 'PhonePe');
  assert.equal(result.jobs[0].location, 'Tirupati, India');
  assert.equal(result.jobs[0].employment_type, 'Full-time');
  assert.equal(result.jobs[0].apply_url, 'https://jobs.smartrecruiters.com/PHONEPELIMITED/1000000000001173-ccm-tirupati');
  assert.equal(result.jobs[0].posted_date, null);
  assert.equal(result.skippedIndia, 1);
});

test('Flipkart TurboHire adapter uses the public token and returns verified India career-page jobs', async () => {
  const calls = [];
  const feed = require('../src/scrapers/verifiedProductFeeds').FEEDS.flipkart;
  const result = await fetchCompanyJobs('flipkart', {
    maxJobs: 10,
    request: async (url, config) => {
      calls.push({ url, config });
      if (url === feed.tokenUrl) {
        assert.equal(config.method, 'GET');
        assert.equal(config.headers.Origin, 'https://flipkart.turbohire.co');
        return { data: { access_token: 'public-test-token' } };
      }

      assert.equal(config.method, 'POST');
      assert.equal(config.headers.Authorization, 'Bearer public-test-token');
      assert.equal(config.headers['Content-Type'], 'application/json');
      assert.match(url, /orgId=4d757ba0-3d57-448a-b82c-238ed87ac90f&pageType=0/);
      assert.deepEqual(config.data.SortByV2, { Key: 'PostedDate', Order: 2 });
      return {
        data: {
          Total: 3,
          Result: [
            {
              JobId: '1061deb9-6694-4031-aec2-aff8409dc251',
              JobIdObfuscated: 'l4MEZnSGkCV8Hhjqy_sOKdsBDem%2FBkvTDZ6XL94MQbLao8VNio2Wzo_NsIJAffJt',
              JobCode: 'FIPL-64177',
              JobTitle: 'SDE-2, FPG Engineering',
              Department: 'Technology',
              Location: '[{"Address":"Bangalore, Karnataka, India"}]',
              Type: 'UNSPECIFIED',
              PublishedDate: '2026-10-30T07:44:14.1467659Z',
              ExpiryDates: { CAREERPAGE: '2026-11-30T00:00:00' },
              Skills: ['Applied AI', 'Java'],
              Experience: { MinExp: 4, MaxExp: 8 },
              OrgDetails: { OrgName: 'Flipkart Internet Private Limited' },
              JobDescV2: '<p>Engineering role</p>',
            },
            {
              JobId: 'foreign-job',
              JobIdObfuscated: 'foreign-job',
              JobCode: 'FIPL-FOREIGN',
              JobTitle: 'London Engineer',
              Location: '[{"Address":"London, United Kingdom"}]',
              OrgDetails: { OrgName: 'Flipkart Internet Private Limited' },
            },
            {
              JobId: 'wrong-org-job',
              JobIdObfuscated: 'wrong-org-job',
              JobCode: 'OTHER-1',
              JobTitle: 'Other company role',
              Location: '[{"Address":"Bengaluru, India"}]',
              OrgDetails: { OrgName: 'Other Company' },
            },
          ],
        },
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.fetched, 3);
  assert.equal(result.skippedIndia, 1);
  assert.equal(result.jobs[0].company, 'Flipkart');
  assert.equal(result.jobs[0].location, 'Bangalore, Karnataka, India');
  assert.equal(result.jobs[0].experience, '4-8 years');
  assert.equal(result.jobs[0].skills, 'Applied AI, Java');
  assert.equal(result.jobs[0].external_job_id, 'FIPL-64177');
  assert.equal(result.jobs[0].posted_date, '2026-10-30T07:44:14.146Z');
  assert.equal(
    result.jobs[0].apply_url,
    'https://flipkart.turbohire.co/job/publicjobs/l4MEZnSGkCV8Hhjqy_sOKdsBDem%2FBkvTDZ6XL94MQbLao8VNio2Wzo_NsIJAffJt'
  );
  assert.equal(normalizeFlipkartPosting({
    JobId: 'id',
    JobIdObfuscated: 'id',
    JobCode: 'FIPL-1',
    JobTitle: 'Unverified location',
    Location: '[{"Address":"Remote"}]',
    OrgDetails: { OrgName: 'Flipkart Internet Private Limited' },
  }, feed), null);
});

test('Ola Electric TurboHire feed maps verified India postings and rejects foreign roles', async () => {
  const calls = [];
  const feed = require('../src/scrapers/verifiedProductFeeds').FEEDS.olaelectric;
  const result = await fetchCompanyJobs('olaelectric', {
    maxJobs: 10,
    request: async (url, config) => {
      calls.push({ url, config });
      if (url === feed.tokenUrl) {
        assert.equal(config.method, 'GET');
        assert.equal(config.headers.Origin, 'https://olacareers.turbohire.co');
        return { data: { access_token: 'ola-public-test-token' } };
      }

      assert.equal(config.method, 'POST');
      assert.match(config.headers.Authorization, /^Bearer \S+$/);
      assert.match(url, /orgId=e0c1eb37-eb7a-4ca4-bcc5-d59ce4ce9212&pageType=0/);
      return {
        data: {
          Total: 2,
          Result: [
            {
              JobId: 'ola-electric-india-job',
              JobIdObfuscated: 'olaElectricIndiaJob',
              JobCode: 'OE-101',
              JobTitle: 'Battery Systems Engineer',
              Location: '[{"Address":"Bengaluru, Karnataka, India"}]',
              PublishedDate: '2026-10-30T07:44:14.1467659Z',
              OrgDetails: { OrgName: 'Ola Electric Mobility Limited' },
            },
            {
              JobId: 'ola-electric-foreign-job',
              JobIdObfuscated: 'olaElectricForeignJob',
              JobCode: 'OE-102',
              JobTitle: 'London Engineer',
              Location: '[{"Address":"London, United Kingdom"}]',
              OrgDetails: { OrgName: 'Ola Electric Mobility Limited' },
            },
          ],
        },
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(result.fetched, 2);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.skippedIndia, 1);
  assert.equal(result.jobs[0].company, 'Ola Electric');
  assert.equal(result.jobs[0].location, 'Bengaluru, Karnataka, India');
  assert.equal(result.jobs[0].external_job_id, 'OE-101');
  assert.equal(result.jobs[0].posted_date, '2026-10-30T07:44:14.146Z');
  assert.equal(
    result.jobs[0].apply_url,
    'https://olacareers.turbohire.co/job/publicjobs/olaElectricIndiaJob'
  );
  assert.equal(normalizeTurboHirePosting({
    JobId: 'remote-job',
    JobIdObfuscated: 'remoteJob',
    JobCode: 'OE-103',
    JobTitle: 'Unverified remote role',
    Location: '[{"Address":"Remote"}]',
  }, feed), null);
});

test('MakeMyTrip feed maps public India jobs to verified Darwinbox application links', async () => {
  const feed = require('../src/scrapers/verifiedProductFeeds').FEEDS.makemytrip;
  const requests = [];
  const result = await fetchCompanyJobs('makemytrip', {
    maxJobs: 10,
    request: async (url, config) => {
      requests.push({ url, config });
      assert.equal(url, 'https://careers.makemytrip.com/api/jobs');
      assert.equal(config.method, 'GET');
      assert.equal(config.headers.Referer, 'https://careers.makemytrip.com/');
      assert.equal(config.headers['User-Agent'], 'Mozilla/5.0');
      return {
        data: {
          allJobs: [
            {
              job_id: 'a67c188c9a61d2',
              job_code: 'JOB_1445',
              group_company: 'MakeMyTrip (India) Limited',
              location: ['Gurgaon, Haryana, India (Gurgaon_MMT)'],
              location_country: 'India',
              job_title: 'Litigation',
              post_on_careers_page: 1,
              employee_type: 'Employee',
              experience_from: '2',
              experience_to: '3',
            },
            {
              job_id: 'foreignjob',
              job_code: 'JOB_FOREIGN',
              group_company: 'MakeMyTrip (India) Limited',
              location: ['London, United Kingdom'],
              location_country: 'United Kingdom',
              job_title: 'London Engineer',
              post_on_careers_page: 1,
            },
            {
              job_id: 'internaljob',
              job_code: 'JOB_INTERNAL',
              group_company: 'MakeMyTrip (India) Limited',
              location: ['Gurgaon, Haryana, India'],
              location_country: 'India',
              job_title: 'Internal Role',
              post_on_careers_page: 0,
            },
            {
              job_id: 'othercompanyjob',
              job_code: 'OTHER_1',
              group_company: 'Goibibo',
              location: ['Gurgaon, Haryana, India'],
              location_country: 'India',
              job_title: 'Other company role',
              post_on_careers_page: 1,
            },
          ],
        },
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(result.fetched, 4);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.skippedIndia, 1);
  assert.equal(result.jobs[0].company, 'MakeMyTrip');
  assert.equal(result.jobs[0].title, 'Litigation');
  assert.equal(result.jobs[0].location, 'Gurgaon, Haryana, India (Gurgaon_MMT)');
  assert.equal(result.jobs[0].experience, '2-3 years');
  assert.equal(result.jobs[0].employment_type, 'Employee');
  assert.equal(result.jobs[0].posted_date, null);
  assert.equal(result.jobs[0].external_job_id, 'JOB_1445');
  assert.equal(
    result.jobs[0].apply_url,
    'https://gommt.darwinbox.in/ms/candidatev2/main/careers/jobDetails/a67c188c9a61d2?from=all'
  );
  assert.equal(normalizeMakeMyTripPosting({
    job_id: 'remoterole',
    job_code: 'JOB_REMOTE',
    group_company: 'MakeMyTrip (India) Limited',
    location: ['Remote'],
    job_title: 'Unverified remote role',
    post_on_careers_page: 1,
  }, feed), null);
  assert.equal(normalizeMakeMyTripPosting({
    job_id: 'blankexperience',
    job_code: 'JOB_BLANK_EXP',
    group_company: 'MakeMyTrip (India) Limited',
    location: ['Gurgaon, Haryana, India'],
    location_country: 'India',
    job_title: 'Role without experience range',
    post_on_careers_page: 1,
    experience_from: '',
    experience_to: '',
  }, feed).experience, null);
  await assert.rejects(
    fetchCompanyJobs('makemytrip', { request: async () => ({ data: {} }) }),
    /MakeMyTrip public jobs API returned an invalid response/
  );
});

test('Zerodha public jobs adapter maps India postings and rejects non-India listings', async () => {
  const feed = require('../src/scrapers/verifiedProductFeeds').FEEDS.zerodha;
  let requestedUrl;
  const result = await fetchCompanyJobs('zerodha', {
    request: async (url) => {
      requestedUrl = url;
      return {
        data: {
          success: true,
          count: 3,
          data: [
            {
              name: 'backend-engineer',
              job_title: 'Backend Engineer',
              location: 'Bengaluru, India',
              location_type: 'Onsite',
              description: 'Build trading systems.',
            },
            {
              name: 'remote-role',
              job_title: 'Remote role',
              location: 'Remote',
            },
            {
              name: 'london-role',
              job_title: 'London role',
              location: 'London, United Kingdom',
            },
          ],
        },
      };
    },
  });

  assert.equal(requestedUrl, 'https://careers.zerodha.com/api/jobs');
  assert.equal(result.fetched, 3);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.skippedIndia, 2);
  assert.equal(result.jobs[0].title, 'Backend Engineer');
  assert.equal(result.jobs[0].company, 'Zerodha');
  assert.equal(result.jobs[0].location, 'Bengaluru, India');
  assert.equal(result.jobs[0].work_mode, 'Onsite');
  assert.equal(result.jobs[0].description, 'Build trading systems.');
  assert.equal(result.jobs[0].external_job_id, 'backend-engineer');
  assert.equal(result.jobs[0].apply_url, 'https://careers.zerodha.com/');
  assert.equal(normalizeZerodhaPosting({
    name: 'unknown-location',
    job_title: 'Unverified location',
    location: 'Anywhere',
  }, feed), null);
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

test('verified feed retries temporary network failures without an HTTP response', async () => {
  let calls = 0;
  await assert.rejects(
    fetchCompanyJobs('groww', {
      wait: async () => {},
      request: async () => {
        calls += 1;
        const error = new Error('temporary network failure');
        error.code = 'ECONNRESET';
        error.request = {};
        throw error;
      },
    }),
    /temporary network error, code ECONNRESET/
  );
  assert.equal(calls, 3);
});
