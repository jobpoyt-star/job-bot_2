const test = require('node:test');
const assert = require('node:assert/strict');

const { getRegisteredScraperKeys, runScrapers } = require('../src/scrapers');

const removedCompanyTargets = [
  'amazon', 'capgemini', 'cognizant', 'deloitte', 'cisco', 'nttdata',
  'ltimindtree', 'mphasis', 'persistent', 'google', 'hsbc', 'microsoft',
  'ibm', 'infosys', 'wipro', 'sap',
];

test('removed company scrapers are not active registrations', () => {
  const activeTargets = getRegisteredScraperKeys();
  assert.deepEqual(activeTargets, [
    'zoho', 'freshworks', 'razorpay', 'paytm', 'meesho', 'swiggy', 'groww', 'cred', 'phonepe', 'flipkart', 'zerodha',
    'zensar', 'hexaware', 'nucleus',
    'mastek',
    'birlasoft',
    'delhivery',
    'sonata',
    'sasken',
    'ltts',
    'kpit',
    'atherenergy',
    'olaelectric',
    'makemytrip',
    'aurionpro',
    'genpact',
    'browserstack',
    'postman',
    'darwinbox',
    'whatfix',
    'cyient', 'happiestminds', 'coforge',
  ]);
  for (const target of removedCompanyTargets) {
    assert.equal(activeTargets.includes(target), false, `${target} must not be active`);
  }
});

test('BrowserStack is dispatched through its official India-verified Workday jobs API', async () => {
  const jobs = await runScrapers(['browserstack'], {
    request: async (url, config) => {
      if (url === 'https://browserstack.wd3.myworkdayjobs.com/wday/cxs/browserstack/External/jobs') {
        assert.deepEqual(config.data, {
          appliedFacets: {},
          limit: 20,
          offset: 0,
          searchText: '',
        });
        return {
          data: {
            total: 1,
            jobPostings: [{
              title: 'Software Engineer',
              externalPath: '/job/India-Remote/Software-Engineer_JR1001',
              locationsText: 'India Remote',
              bulletFields: ['JR1001'],
            }],
          },
        };
      }

      assert.equal(
        url,
        'https://browserstack.wd3.myworkdayjobs.com/wday/cxs/browserstack/External/job/India-Remote/Software-Engineer_JR1001'
      );
      return {
        data: {
          jobPostingInfo: {
            title: 'Software Engineer',
            location: 'India Remote',
            country: { descriptor: 'India' },
            jobReqId: 'JR1001',
            canApply: true,
            externalUrl: 'https://browserstack.wd3.myworkdayjobs.com/External/job/India-Remote/Software-Engineer_JR1001',
          },
        },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'BrowserStack');
  assert.equal(jobs[0].location, 'India Remote');
  assert.equal(
    jobs[0].apply_url,
    'https://browserstack.wd3.myworkdayjobs.com/External/job/India-Remote/Software-Engineer_JR1001'
  );
});

test('Postman is dispatched through its official India-verified Workday jobs API', async () => {
  const jobs = await runScrapers(['postman'], {
    request: async (url, config) => {
      if (url === 'https://postman.wd108.myworkdayjobs.com/wday/cxs/postman/careers/jobs') {
        assert.deepEqual(config.data, {
          appliedFacets: {},
          limit: 20,
          offset: 0,
          searchText: '',
        });
        return {
          data: {
            total: 1,
            jobPostings: [{
              title: 'Senior Engineer - AI',
              externalPath: '/job/Bangalore-India/Senior-Engineer---AI_JR1000054',
              locationsText: 'Bangalore, India',
              bulletFields: ['JR1000054'],
            }],
          },
        };
      }

      assert.equal(
        url,
        'https://postman.wd108.myworkdayjobs.com/wday/cxs/postman/careers/job/Bangalore-India/Senior-Engineer---AI_JR1000054'
      );
      return {
        data: {
          jobPostingInfo: {
            title: 'Senior Engineer - AI',
            location: 'Bangalore, India',
            country: { descriptor: 'India' },
            jobReqId: 'JR1000054',
            canApply: true,
            externalUrl: 'https://postman.wd108.myworkdayjobs.com/careers/job/Bangalore-India/Senior-Engineer---AI_JR1000054',
          },
        },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Postman');
  assert.equal(jobs[0].location, 'Bangalore, India');
  assert.equal(
    jobs[0].apply_url,
    'https://postman.wd108.myworkdayjobs.com/careers/job/Bangalore-India/Senior-Engineer---AI_JR1000054'
  );
});

test('Darwinbox is dispatched through its official India-filtered candidate jobs API', async () => {
  const jobs = await runScrapers(['darwinbox'], {
    newPage: async () => ({
      goto: async (url) => {
        assert.equal(url, 'https://dbx.darwinbox.in/ms/candidatev2/main/careers/allJobs');
      },
      evaluate: async (_fn, options) => {
        assert.equal(
          options.apiUrl,
          'https://dbx.darwinbox.in/ms/candidateapi/job/alljobs?companyId=main'
        );
        assert.equal(options.pageNumber, 1);
        assert.equal(options.pageSize, 10);
        return {
          status: 200,
          data: {
            status: 'success',
            data: [{
              id: 'a69390eda0cf1c',
              title: 'Project Manager (PMP Certified)',
              internal_job_code: 'DBJobID_420',
              country: 'India',
              tool_tip_locations: ['Hyderabad, Telangana, India'],
              posted_on: 1793298600,
            }],
          },
        };
      },
      close: async () => {},
    }),
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Darwinbox');
  assert.equal(jobs[0].title, 'Project Manager (PMP Certified)');
  assert.equal(jobs[0].location, 'Hyderabad, Telangana, India');
  assert.equal(
    jobs[0].apply_url,
    'https://dbx.darwinbox.in/ms/candidatev2/main/careers/jobDetails/a69390eda0cf1c'
  );
});

test('Whatfix is dispatched through its official India-filtered Trakstar RSS feed', async () => {
  const jobs = await runScrapers(['whatfix'], {
    newPage: async () => ({
      goto: async (url) => {
        assert.equal(url, 'https://whatfix101.hire.trakstar.com/');
      },
      evaluate: async (_fn, options) => {
        assert.equal(options.feedUrl, 'https://whatfix101.hire.trakstar.com/jobfeeds/whatfix101');
        return {
          status: 200,
          channelTitle: 'Jobs at Whatfix',
          postings: [{
            title: 'Senior Software Engineer',
            url: 'http://whatfix101.hire.trakstar.com/jobs/abc123',
            city: 'Bengaluru',
            state: 'Karnataka',
            country: 'India',
            employmentType: 'full_time',
            postedDate: 'Thu, 29 Oct 2026 00:00:00 +0530',
            description: 'Build reliable software.',
          }],
        };
      },
      close: async () => {},
    }),
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Whatfix');
  assert.equal(jobs[0].title, 'Senior Software Engineer');
  assert.equal(jobs[0].location, 'Bengaluru, Karnataka, India');
  assert.equal(jobs[0].employment_type, 'Full Time');
  assert.equal(jobs[0].posted_date, '2026-10-28T18:30:00.000Z');
  assert.equal(jobs[0].external_job_id, 'abc123');
  assert.equal(
    jobs[0].apply_url,
    'https://whatfix101.hire.trakstar.com/jobs/abc123/?apply=true'
  );
});

test('Delhivery is dispatched through its official Darwinbox careers portal', async () => {
  const jobs = await runScrapers(['delhivery'], {
    newPage: async () => ({
      goto: async (url) => {
        assert.equal(url, 'https://delhivery.darwinbox.in/ms/candidatev2/main/careers/allJobs');
      },
      evaluate: async (_fn, options) => {
        assert.equal(options.apiUrl, 'https://delhivery.darwinbox.in/ms/candidateapi/job/alljobs?companyId=main');
        return {
          status: 200,
          data: {
            status: 'success',
            data: [{
              id: 'a67dd32d8adae1',
              internal_job_code: 'Job38679',
              title: 'Associate',
              country: 'India',
              tool_tip_locations: ['Panjim, Goa, India'],
              posted_on: 1767810600,
            }],
          },
        };
      },
      close: async () => {},
    }),
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Delhivery');
  assert.equal(jobs[0].title, 'Associate');
  assert.equal(jobs[0].location, 'Panjim, Goa, India');
  assert.equal(
    jobs[0].apply_url,
    'https://delhivery.darwinbox.in/ms/candidatev2/main/careers/jobDetails/a67dd32d8adae1'
  );
});

test('Sonata Software is dispatched through its official Darwinbox careers portal', async () => {
  const jobs = await runScrapers(['sonata'], {
    newPage: async () => ({
      goto: async (url) => {
        assert.equal(url, 'https://sonataone.darwinbox.in/ms/candidatev2/main/careers/allJobs');
      },
      evaluate: async (_fn, options) => {
        assert.equal(options.apiUrl, 'https://sonataone.darwinbox.in/ms/candidateapi/job/alljobs?companyId=main');
        return {
          status: 200,
          data: {
            status: 'success',
            data: [{
              id: 'a6ae2f1afa8adb',
              internal_job_code: 'SSL-26-27-891',
              designation_display_name: 'Microsoft Sharepoint and Exchange',
              country: 'India',
              tool_tip_locations: ['BG4, Bangalore, Karnataka, India'],
            }],
          },
        };
      },
      close: async () => {},
    }),
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Sonata Software');
  assert.equal(jobs[0].location, 'BG4, Bangalore, Karnataka, India');
});

test('Sasken Technologies is dispatched through its official India careers listing', async () => {
  const jobs = await runScrapers(['sasken'], {
    newPage: async () => ({
      goto: async (url) => {
        assert.equal(url, 'https://www.hirewand.com/apply/job/listing?id=2022&country=ind&embed=true');
      },
      evaluate: async () => ({ ids: ['20222813'], pageCount: 1 }),
      close: async () => {},
    }),
    request: async (url, config) => {
      assert.equal(url, 'https://www.hirewand.com/public/listingdata');
      assert.deepEqual(config.params, { accountid: 2022, limit: 50, offset: 0 });
      assert.equal(
        config.headers.Referer,
        'https://www.hirewand.com/apply/job/listing?id=2022&country=ind&embed=true'
      );
      return {
        data: {
          status: 'success',
          jobs: {
            matchCount: 1,
            offset: 0,
            requirements: [{
              _id: 20222813,
              title: 'Principal Engineer',
              created_at: '2026-10-29T05:32:01Z',
              needjson: {
                location: [{
                  city: { display: 'Bengaluru' },
                  state: { display: 'Karnataka' },
                  country: { display: 'India' },
                  uniqueuiref: 'Bengaluru, Karnataka, India',
                }],
                experience: { min: 132, max: 180 },
              },
              jd_summary: 'Build embedded software.',
              jd_primary_skills: ['C++', 'Linux'],
              jobURL: 'https://www.hirewand.com/apply/job/detail?jid=20222813&src=jobpost&cpid=2022',
            }],
          },
        },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Sasken Technologies');
  assert.equal(jobs[0].location, 'Bengaluru, Karnataka, India');
  assert.equal(jobs[0].experience, '11 - 15 years');
  assert.deepEqual(jobs[0].skills, ['C++', 'Linux']);
  assert.equal(
    jobs[0].apply_url,
    'https://www.hirewand.com/apply/job/detail?jid=20222813&src=jobpost&cpid=2022'
  );
});

test('L&T Technology Services is dispatched through its official India jobs search', async () => {
  const jobs = await runScrapers(['ltts'], {
    request: async (url, config) => {
      assert.equal(url, 'https://jobs.ltts.com/search/');
      assert.deepEqual(config.params, {
        createNewAlert: 'false',
        q: '',
        locationsearch: 'India',
        startrow: 0,
      });
      return {
        data: `<span class="paginationLabel" aria-label="Results 1 – 1">Results <b>1 – 1</b> of <b>1</b></span>
          <tr class="data-row">
            <td class="colTitle"><a href="/job/Bangalore-Engineer/572438410/" class="jobTitle-link">Engineer</a></td>
            <td class="colFacility">121523</td>
            <td class="colDate">Oct 31, 2026</td>
            <td class="colLocation">Bangalore, IN</td>
          </tr>`,
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'L&T Technology Services');
  assert.equal(jobs[0].location, 'Bangalore, IN, India');
  assert.equal(jobs[0].apply_url, 'https://jobs.ltts.com/job/Bangalore-Engineer/572438410/');
});

test('KPIT Technologies is dispatched through its official India careers listing', async () => {
  const jobs = await runScrapers(['kpit'], {
    request: async (url, config) => {
      assert.equal(url, 'https://www.kpit.com/job-listing/');
      assert.deepEqual(config.params, {
        country: 'India',
        location: '',
        exp: '0',
        show_all: '1',
      });
      assert.equal(config.headers.Referer, 'https://www.kpit.com/careers-overview/');
      return {
        data: `<section id="job-listing">
          <div class="f-col job-div">
            <div class="search_job_box">
              <h3>Principal Embedded Software Engineer</h3>
              <span class="job-loaction">Pune</span>
              <span class="job-time"> Full Time</span>
              <span class="job-exp"> Exp 8-13 years</span>
              <p class="skills-txt">C++ &amp; Linux</p>
              <a class="job-apply talentojo-button" href="https://talentojo.kpit.com/tojo/app/job-apply/#/Career%20Portal/84155">Apply</a>
            </div>
          </div>
        </section>`,
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'KPIT Technologies');
  assert.equal(jobs[0].location, 'Pune, India');
  assert.equal(jobs[0].experience, '8-13 years');
  assert.equal(jobs[0].employment_type, 'Full Time');
  assert.equal(jobs[0].skills, 'C++ & Linux');
  assert.equal(jobs[0].external_job_id, '84155');
  assert.equal(
    jobs[0].apply_url,
    'https://talentojo.kpit.com/tojo/app/job-apply/#/Career%20Portal/84155'
  );
});

test('Ather Energy is dispatched through its official public careers API', async () => {
  const jobs = await runScrapers(['atherenergy'], {
    newPage: async () => ({
      goto: async (url) => {
        assert.equal(url, 'https://careers.atherenergy.com/jobs');
      },
      evaluate: async (_fn, options) => {
        assert.equal(options.apiUrl, 'https://careers.atherenergy.com/api/get-all-jobs');
        return {
          status: 200,
          body: JSON.stringify({
            data: JSON.stringify({
              Engineering: [{
                jobs: [{
                  openingid: 'a698205f7e4954',
                  job_id: 'a698205f7e4954',
                  job_code: 'AE4792',
                  title: 'Senior Application Developer',
                  posting_title: 'Senior Application Developer',
                  location: 'Bengaluru, Karnataka, India',
                  location_country: 'India',
                  group_company: 'Ather Energy Limited',
                  post_on_carrers_page: 1,
                  job_created_timestamp: '19:58:07 03-02-2026',
                }],
              }],
            }),
          }),
        };
      },
      close: async () => {},
    }),
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Ather Energy');
  assert.equal(jobs[0].location, 'Bengaluru, Karnataka, India');
});

test('MakeMyTrip is dispatched through its official careers jobs API', async () => {
  const jobs = await runScrapers(['makemytrip'], {
    request: async (url, config) => {
      assert.equal(url, 'https://careers.makemytrip.com/api/jobs');
      assert.equal(config.method, 'GET');
      return {
        data: {
          allJobs: [{
            job_id: 'a67c188c9a61d2',
            job_code: 'JOB_1445',
            group_company: 'MakeMyTrip (India) Limited',
            location: ['Gurgaon, Haryana, India (Gurgaon_MMT)'],
            location_country: 'India',
            job_title: 'Litigation',
            post_on_careers_page: 1,
          }],
        },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'MakeMyTrip');
  assert.equal(jobs[0].location, 'Gurgaon, Haryana, India (Gurgaon_MMT)');
  assert.equal(
    jobs[0].apply_url,
    'https://gommt.darwinbox.in/ms/candidatev2/main/careers/jobDetails/a67c188c9a61d2?from=all'
  );
});

test('Aurionpro Solutions is dispatched through its official ZingHR careers board', async () => {
  const jobs = await runScrapers(['aurionpro'], {
    request: async (url, config) => {
      if (url === 'https://mservices.zinghr.com/recruitment/api/v1/CareerConfig/GetCareerJobPostings') {
        assert.deepEqual(config.params, {
          careerClientKey: 'AHJX1-HGSAB-BSHB1',
          pageIndex: 1,
          pageSize: 50,
          searchText: '',
        });
        return {
          data: {
            code: 1,
            data: {
              totalCount: 1,
              careerJobPostings: [{ requisitionId: 'REQ-1001' }],
            },
          },
        };
      }

      assert.equal(
        url,
        'https://mservices.zinghr.com/recruitment/api/v1/CareerConfig/GetJobDescriptionByRequisitionId'
      );
      assert.equal(config.params.requisitionId, 'REQ-1001');
      return {
        data: {
          code: 1,
          data: {
            requisitionId: 'REQ-1001',
            jobTitle: 'Senior Software Engineer',
            location: 'Navi Mumbai, India',
            country: 'India',
            isCandidateApplyOnBoardingForm: true,
            candidateApplyLink: 'https://candidate.example/apply/REQ-1001',
          },
        },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Aurionpro Solutions');
  assert.equal(jobs[0].location, 'Navi Mumbai, India');
  assert.equal(jobs[0].apply_url, 'https://candidate.example/apply/REQ-1001');
});

test('Genpact is dispatched through its official India-filtered Workday careers portal', async () => {
  const jobs = await runScrapers(['genpact'], {
    request: async (url, config) => {
      if (url === 'https://genpact.wd108.myworkdayjobs.com/wday/cxs/genpact/External_Careers/jobs') {
        const requestBody = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
        if (requestBody.appliedFacets.locations) {
          assert.deepEqual(requestBody.appliedFacets.locations, ['india-location-id']);
          assert.equal(requestBody.limit, 20);
          return {
            data: {
              total: 1,
              jobPostings: [{
                title: 'Engineer - Cloud Technologies',
                externalPath: '/job/1401-G-India-STPI-Gurgaon/Engineer-Cloud-Technologies_JR10033384',
                locationsText: '1401-G-India: STPI, Gurgaon',
                bulletFields: ['JR10033384'],
              }],
            },
          };
        }

        assert.deepEqual(requestBody, {
          appliedFacets: {},
          limit: 1,
          offset: 0,
          searchText: '',
        });
        return {
          data: {
            total: 1,
            jobPostings: [],
            facets: [{
              facetParameter: 'locationMainGroup',
              values: [{
                facetParameter: 'locations',
                values: [
                  { descriptor: '1401-G-India: STPI, Gurgaon', id: 'india-location-id' },
                  { descriptor: '1102-G-Dalian, China', id: 'foreign-location-id' },
                ],
              }],
            }],
          },
        };
      }

      assert.equal(
        url,
        'https://genpact.wd108.myworkdayjobs.com/wday/cxs/genpact/External_Careers/job/1401-G-India-STPI-Gurgaon/Engineer-Cloud-Technologies_JR10033384'
      );
      return {
        data: {
          jobPostingInfo: {
            title: 'Engineer - Cloud Technologies',
            jobReqId: 'JR10033384',
            location: '1401-G-India: STPI, Gurgaon',
            country: { descriptor: 'India' },
            canApply: true,
            externalUrl: 'https://genpact.wd108.myworkdayjobs.com/External_Careers/job/1401-G-India-STPI-Gurgaon/Engineer-Cloud-Technologies_JR10033384',
            startDate: '2026-10-31',
            timeType: 'Full time',
            remoteType: 'Hybrid',
            jobDescription: '<p>Build cloud technologies.</p>',
          },
        },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Genpact');
  assert.equal(jobs[0].location, '1401-G-India: STPI, Gurgaon');
  assert.equal(jobs[0].external_job_id, 'JR10033384');
  assert.equal(jobs[0].employment_type, 'Full time');
  assert.equal(jobs[0].work_mode, 'Hybrid');
  assert.equal(jobs[0].apply_url, 'https://genpact.wd108.myworkdayjobs.com/External_Careers/job/1401-G-India-STPI-Gurgaon/Engineer-Cloud-Technologies_JR10033384');
});

test('one scraper failure does not prevent later registered targets from running', async () => {
  const jobs = await runScrapers(['broken', 'healthy'], {
    registry: {
      broken() {
        throw new Error('source unavailable');
      },
      healthy() {
        return { result: [{ title: 'Verified India role', location: 'Bengaluru, India' }] };
      },
    },
  });

  assert.deepEqual(jobs, [{ title: 'Verified India role', location: 'Bengaluru, India' }]);
});

test('PhonePe is dispatched through the registry using its published jobs feed', async () => {
  const jobs = await runScrapers(['phonepe'], {
    request: async (url) => {
      assert.equal(url, 'https://www.phonepe.com/apollo/job-postings/latest.json');
      return {
        data: {
          results: [{
            status: 'PUBLIC',
            applyUrl: 'https://jobs.smartrecruiters.com/PHONEPELIMITED/1000000000001173-ccm-tirupati',
            type: 'Full-time',
            title: 'CCM - Tirupati',
            location: 'Tirupati',
          }],
        },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'PhonePe');
  assert.equal(jobs[0].location, 'Tirupati, India');
});

test('Zerodha is dispatched through its official public jobs feed', async () => {
  const jobs = await runScrapers(['zerodha'], {
    request: async (url) => {
      assert.equal(url, 'https://careers.zerodha.com/api/jobs');
      return {
        data: {
          success: true,
          count: 1,
          data: [{
            name: 'backend-engineer',
            job_title: 'Backend Engineer',
            location: 'Bengaluru, India',
          }],
        },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Zerodha');
  assert.equal(jobs[0].location, 'Bengaluru, India');
});

test('Happiest Minds is invoked through the registry with its India-filtered official jobs', async () => {
  const requests = [];
  const jobs = await runScrapers(['happiestminds'], {
    maxJobs: 10,
    request: async (url, config) => {
      requests.push({ url, config });
      return {
        data: {
          data: {
            data: [
              {
                _source: {
                  referenceNumber: 'HM-IN-1',
                  jobTitle: 'India engineer',
                  location: 'Bengaluru',
                  jobUrl: 'india-engineer-bengaluru',
                },
              },
              {
                _source: {
                  referenceNumber: 'HM-US-1',
                  jobTitle: 'US engineer',
                  location: 'Austin, United States',
                  jobUrl: 'us-engineer-austin',
                },
              },
            ],
            hasMoreData: false,
          },
        },
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://public.zwayam.com/jobs/search');
  assert.match(requests[0].config.data.getBuffer().toString(), /jobs\.happiestminds\.com/);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Happiest Minds');
  assert.equal(jobs[0].location, 'Bengaluru, India');
  assert.equal(
    jobs[0].apply_url,
    'https://jobs.happiestminds.com/happiestminds/jobview/india-engineer-bengaluru'
  );
});

test('Coforge is invoked through the registry with its verified Zwayam configuration', async () => {
  let requestConfig;
  const jobs = await runScrapers(['coforge'], {
    request: async (url, config) => {
      assert.equal(url, 'https://public.zwayam.com/jobs/search');
      requestConfig = config;
      return {
        data: {
          data: {
            data: [
              {
                _source: {
                  referenceNumber: '8443-AD1-BLR-ONBD-7-1',
                  jobTitle: 'SENIOR ENGINEER',
                  location: 'Bangalore',
                  jobUrl: 'senior-engineer-bangalore-2026100911014118',
                },
              },
              {
                _source: {
                  referenceNumber: '295308',
                  jobTitle: 'Remote role restricted to USA',
                  location: 'Utah, USA;Idaho, USA;Arizona, USA',
                  jobUrl: 'associate-team-member-work-from-home',
                },
              },
            ],
            hasMoreData: false,
          },
        },
      };
    },
  });

  const requestBody = requestConfig.data.getBuffer().toString();
  assert.match(requestBody, /careers\.coforge\.com/);
  assert.match(requestBody, /MTUxNzM=/);
  assert.deepEqual(jobs.map((job) => job.title), ['SENIOR ENGINEER']);
  assert.equal(jobs[0].company, 'Coforge');
  assert.equal(jobs[0].location, 'Bangalore, India');
  assert.equal(
    jobs[0].apply_url,
    'https://careers.coforge.com/coforge/jobview/senior-engineer-bangalore-2026100911014118'
  );
});

test('registered scrapers cannot return foreign or ambiguous jobs into the pipeline', async () => {
  const metrics = [];
  const jobs = await runScrapers(['source'], {
    registry: {
      source() {
        return {
          result: [
            { title: 'US job', location: 'Austin, United States' },
            { title: 'Unknown job', location: 'Remote' },
            { title: 'India job', location: { city: 'Pune', country: { code: 'IN' } } },
          ],
          stats: { listingJobsFetched: 5, skippedIndia: 1 },
        };
      },
    },
    onMetrics: (value) => metrics.push(value),
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].location, 'Pune, India');
  assert.deepEqual(metrics, [{ name: 'source', fetched: 5, indiaRejected: 3, failures: 0 }]);
});

test('unregistered company keys are skipped instead of treated as arbitrary career URLs', async () => {
  const jobs = await runScrapers(['old-company'], { registry: {} });
  assert.deepEqual(jobs, []);
});

test('Zoho scraper normalizes India-listed official job details and rejects unverified locations', async () => {
  const { normalizeRecruitPosting, scrapeZohoJobs } = require('../src/scrapers/zoho');
  const job = normalizeRecruitPosting({
    title: 'Technical Support Engineers',
    country: 'India',
    url: 'https://careers.zohocorp.com/jobs/Careers/193779000024445975/Technical-Support-Engineers?source=CareerSite',
    employmentType: 'Full time',
  });

  const unknownLocation = normalizeRecruitPosting({
    title: 'Remote role',
    country: null,
    url: 'https://careers.zohocorp.com/jobs/Careers/193779000024445975/Remote-role',
  });

  assert.equal(job.company, 'Zoho');
  assert.equal(job.location, 'India');
  assert.equal(job.external_job_id, '193779000024445975');
  assert.equal(unknownLocation, null);
  const nucleusJob = normalizeRecruitPosting({
    title: 'Sales Enablement Executive',
    country: 'India',
    url: 'https://nucleussoftware.zohorecruit.in/jobs/Careers/45488000014913901/Sales-Enablement-Executive?source=CareerSite',
  }, {
    company: 'Nucleus Software',
    careersHost: 'nucleussoftware.zohorecruit.in',
  });
  assert.equal(nucleusJob.company, 'Nucleus Software');

  const visited = [];
  let pageClosed = false;
  const response = await scrapeZohoJobs('', '', false, {
    createPage: async () => ({
      async goto(url) {
        visited.push(url);
      },
      async waitForSelector(selector) {
        assert.equal(selector, 'a[href*="/jobs/Careers/"]');
      },
      async $$eval(selector) {
        if (selector === 'a[href*="/jobs/Careers/"]') {
          return [
            {
              title: 'India role',
              url: 'https://careers.zohocorp.com/jobs/Careers/193779000024445975/India-role',
              description: null,
            },
            {
              title: 'Unknown role',
              url: 'https://careers.zohocorp.com/jobs/Careers/193779000024446028/Unknown-role',
              description: null,
            },
          ];
        }
        return { country: visited.at(-1).includes('India-role') ? 'India' : null };
      },
      async close() {
        pageClosed = true;
      },
    }),
  });

  assert.deepEqual(response.result.map((posting) => posting.title), ['India role']);
  assert.equal(response.stats.listingJobsFetched, 2);
  assert.equal(response.stats.skippedIndia, 1);
  assert.equal(pageClosed, true);
});

test('Mastek scraper accepts India-listed jobs only with same-job official application URLs', async () => {
  const { normalizeMastekPosting, scrapeMastekJobs } = require('../src/scrapers/mastek');
  const valid = normalizeMastekPosting({
    title: 'Senior Software Engineer',
    location: 'Noida (Work from Office 4 days from week)',
    url: 'https://careers.mastek.com/job/Senior-Software-Engineer/58876044/',
    applyUrl: 'https://careers.mastek.com/talentcommunity/apply/58876044/?locale=en_US',
  });
  assert.equal(valid.company, 'Mastek');
  assert.equal(valid.location, 'Noida (Work from Office 4 days from week), India');
  assert.equal(valid.external_job_id, '58876044');
  assert.equal(normalizeMastekPosting({
    title: 'ERP Consultant',
    location: 'Reading',
    url: 'https://careers.mastek.com/job/Reading-ERP-Consultant/59488744/',
    applyUrl: 'https://careers.mastek.com/talentcommunity/apply/59488744/',
  }), null);
  assert.equal(normalizeMastekPosting({
    title: 'Senior Software Engineer',
    location: 'Noida, India',
    url: 'https://careers.mastek.com/job/Senior-Software-Engineer/58876044/',
    applyUrl: 'https://careers.mastek.com/talentcommunity/apply/1/',
  }), null);

  const visited = [];
  let pageClosed = false;
  const response = await scrapeMastekJobs('', '', false, {
    createPage: async () => ({
      async goto(url) {
        visited.push(url);
      },
      async waitForSelector(selector) {
        assert.equal(selector, 'a[href*="/job/"]');
      },
      async $$eval(selector) {
        if (selector === 'a[href*="/job/"]') {
          return [{
            title: 'Senior Software Engineer',
            url: 'https://careers.mastek.com/job/Senior-Software-Engineer/58876044/',
            description: null,
          }];
        }
        assert.equal(selector, 'p');
        return {
          location: 'Noida (Work from Office 4 days from week)',
          applyUrl: 'https://careers.mastek.com/talentcommunity/apply/58876044/?locale=en_US',
        };
      },
      getByRole(role, options) {
        assert.equal(role, 'button');
        assert.equal(options.name, 'More Search Results');
        return { async count() { return 0; } };
      },
      async close() {
        pageClosed = true;
      },
    }),
  });

  assert.deepEqual(response.result.map((job) => job.title), ['Senior Software Engineer']);
  assert.equal(response.stats.listingJobsFetched, 1);
  assert.equal(response.stats.detailJobsFetched, 1);
  assert.equal(pageClosed, true);
  assert.deepEqual(visited, [
    'https://careers.mastek.com/search',
    'https://careers.mastek.com/job/Senior-Software-Engineer/58876044/',
  ]);
});
