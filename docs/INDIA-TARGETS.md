# India company targets and source status

The job pipeline registers company sources only when their public listings API
or official careers page can be verified. Official careers pages without a
verified source are documented below but are not scraped or represented as
working integrations. Targets with inaccessible or inconclusive pages are not
assigned guessed URLs or API endpoints.
New raw jobs are checked for India eligibility before persistence, and the
publisher repeats the check for previously stored jobs. Explicit India-remote
eligibility is converted into an India-qualified location before storage;
publication does not trust an AI-generated description alone as location proof.

The repository also contained importer tests for Coinbase, Greenhouse, HCLTech,
Remote OK, Remotive, and We Work Remotely, but the referenced modules were absent
and the scheduler has no configured import sources. Those orphaned tests were
replaced with India-eligibility fixture tests; no such importer is active.
The pipeline ensures the company rows for the active integrations below on each
cycle; `npm run seed:companies` runs the same idempotent registration explicitly.
Companies listed in the unintegrated sections are deliberately not seeded.

## Integrated source

| Company | Integration | Verified source |
| --- | --- | --- |
| Zoho | Official Zoho Recruit careers listing and job-detail pages. Job details are followed only when their Country field explicitly confirms India. | [Official openings](https://careers.zohocorp.com/jobs/Careers) |
| Nucleus Software | Official Zoho Recruit careers listing and job-detail pages. Job details are followed only when their Country field explicitly confirms India. | [Official openings](https://nucleussoftware.zohorecruit.in/jobs/Careers) |
| Freshworks | SmartRecruiters public postings API. Results are paginated, detail records are fetched sequentially, and only India-eligible jobs with an application URL are returned. | [Official career listings](https://careers.smartrecruiters.com/Freshworks); [public postings API](https://api.smartrecruiters.com/v1/companies/Freshworks/postings?limit=1&offset=0); [SmartRecruiters API guide](https://developers.smartrecruiters.com/docs/get-job-postings.md) |
| Razorpay | Greenhouse public job-board API. | [Official careers](https://razorpay.com/careers/); [job feed](https://boards-api.greenhouse.io/v1/boards/razorpaysoftwareprivatelimited/jobs); [API docs](https://docs.greenhouse.io/job-board.html) |
| Paytm | Lever public postings API with `skip`/`limit` pagination. Multi-location postings are restricted to verified Indian locations. | [Official careers](https://paytm.com/careers/); [job feed](https://api.lever.co/v0/postings/paytm?skip=0&limit=1&mode=json); [API docs](https://github.com/lever/postings-api#api-methods) |
| Meesho | Lever public postings API with `skip`/`limit` pagination. | [Official jobs](https://www.meesho.io/jobs); [job feed](https://api.lever.co/v0/postings/meesho?skip=0&limit=1&mode=json); [API docs](https://github.com/lever/postings-api#api-methods) |
| Swiggy | Public jobs JSON feed; supplied application URLs are retained as-is. | [Official careers](https://careers.swiggy.in/); [job feed](https://careers.swiggy.in/api/jobs.json) |
| PhonePe | Official careers page's public JSON feed. Only `PUBLIC` listings with a recognized India location and a PhonePe SmartRecruiters application URL are accepted. | [Official job openings](https://www.phonepe.com/careers/job-openings/); [official public feed](https://www.phonepe.com/apollo/job-postings/latest.json); [verified India role](https://jobs.smartrecruiters.com/PHONEPELIMITED/1000000000001173-ccm-tirupati) |
| Flipkart | Official Flipkart careers portal powered by TurboHire. The public jobs API returns current career-page postings; records are restricted to Flipkart's organization, verified India locations, and official TurboHire job-detail/apply pages. | [Official careers](https://www.flipkartcareers.com/); [Flipkart TurboHire career page](https://flipkart.turbohire.co/careerpage/4d757ba0-3d57-448a-b82c-238ed87ac90f); [public jobs API](https://thapi.azurewebsites.net/api/careerpagev2/filteredjobs) |
| Zerodha | Official careers page's public `/api/jobs` endpoint. Only India-eligible listings are accepted; applications are handled on the official careers page. The verified feed currently returns no openings. | [Official careers and openings](https://careers.zerodha.com/); [public jobs API](https://careers.zerodha.com/api/jobs) |
| Delhivery | Official careers page links to its public Darwinbox candidate portal. The portal's public listings API is called from its careers page; only India-eligible jobs with official Darwinbox detail/application URLs are accepted. | [Official careers](https://www.delhivery.com/careers); [public Darwinbox job listings](https://delhivery.darwinbox.in/ms/candidatev2/main/careers/allJobs) |
| Sonata Software | Official careers page links to SonataOne's public Darwinbox jobs API. Listings are restricted to India-eligible roles and linked to their matching official Darwinbox job-details pages. | [Official careers](https://www.sonata-software.com/careers); [official open jobs](https://sonataone.darwinbox.in/ms/candidatev2/main/careers/allJobs); [public jobs API](https://sonataone.darwinbox.in/ms/candidateapi/job/alljobs?companyId=main) |
| Sasken Technologies | Official careers page embeds its India-specific HireWand listing. The public listing feed is paginated; non-India and unverified-location records are rejected, and only matching Sasken job-detail links are retained. | [Official careers](https://careers.sasken.com/tb/saskenjobs/); [India listings](https://careers.sasken.com/tb/saskenjobs/india); [embedded public job feed](https://www.hirewand.com/public/listingdata?accountid=2022&limit=1&offset=0) |
| L&T Technology Services | LTTS's branded SuccessFactors careers board is searched by India location. Listings are paginated, checked for India eligibility, and linked to their matching official job-detail pages with an Apply now option. | [Official careers](https://www.ltts.com/careers); [LTTS jobs portal](https://jobs.ltts.com/); [India jobs search](https://jobs.ltts.com/search/?createNewAlert=false&q=&locationsearch=India) |
| KPIT Technologies | Official KPIT careers page's India country filter provides all current India listings. Only the India-filtered jobs with a KPIT TalentOjo application link are accepted. | [Official careers](https://www.kpit.com/careers-overview/); [open positions](https://www.kpit.com/job-listing/); [India listings](https://www.kpit.com/job-listing/?country=India&location=&exp=0&show_all=1); [official TalentOjo application portal](https://talentojo.kpit.com/tojo/app/job-apply/#/Career%20Portal/84155) |
| Ather Energy | Official careers site's public `/api/get-all-jobs` endpoint. Only public career-page postings from Ather Energy Limited with verified India locations are accepted; application URLs point to the matching official application form. | [Official careers](https://careers.atherenergy.com/); [public jobs page](https://careers.atherenergy.com/jobs); [public jobs API](https://careers.atherenergy.com/api/get-all-jobs) |
| Ola Electric | Official TurboHire career page and public filtered-jobs API. Only India-eligible postings from this organization-specific board are accepted; the feed returned no openings during verification. | [Official career page](https://olacareers.turbohire.co/careerpage/e0c1eb37-eb7a-4ca4-bcc5-d59ce4ce9212); [public jobs API](https://thapi.azurewebsites.net/api/careerpagev2/filteredjobs) |
| MakeMyTrip | Official careers site's public `/api/jobs` feed. Only career-page postings from MakeMyTrip (India) Limited with verified India locations are accepted; application URLs use the verified official Darwinbox job-details route. | [Official careers](https://careers.makemytrip.com/); [public jobs API](https://careers.makemytrip.com/api/jobs); [verified official application route](https://gommt.darwinbox.in/ms/candidatev2/main/careers/jobDetails/a67c188c9a61d2?from=all) |
| Aurionpro Solutions | Official careers page embeds a public ZingHR job board. Listings are followed through ZingHR's public job-details API; only India-eligible roles with an HTTPS application link supplied by the official job details are returned. The feed currently reports no open roles. | [Official careers](https://www.aurionpro.com/careers/); [embedded ZingHR board](https://zingnext.zinghr.com/portal/embed/career-website?CareerClientKey=AHJX1-HGSAB-BSHB1) |
| Genpact | Official careers page links to its public Workday jobs API. India work locations are selected from the portal's location facets; job details must confirm India and an active application before the Workday job-detail link is returned. | [Official careers](https://www.genpact.com/careers); [official Workday careers portal](https://genpact.wd108.myworkdayjobs.com/External_Careers); [public jobs API](https://genpact.wd108.myworkdayjobs.com/wday/cxs/genpact/External_Careers/jobs) |
| BrowserStack | Official careers page links to its public Workday jobs API. Listings are paginated; job details must confirm India and an active application on the matching BrowserStack Workday job route. | [Official careers](https://www.browserstack.com/careers); [official Workday careers portal](https://browserstack.wd3.myworkdayjobs.com/External); [public jobs API](https://browserstack.wd3.myworkdayjobs.com/wday/cxs/browserstack/External/jobs) |
| Postman | Official careers page uses the public Workday jobs API. Listings are paginated; each job detail must confirm India and an active application on its matching Postman Workday job route. | [Official open positions](https://www.postman.com/company/careers/open-positions/); [official Workday careers portal](https://postman.wd108.myworkdayjobs.com/careers); [public jobs API](https://postman.wd108.myworkdayjobs.com/wday/cxs/postman/careers/jobs) |
| Darwinbox | Official careers page links to the public Darwinbox candidate portal. Jobs are fetched through its paginated public listings API and filtered for India-eligible locations; applications link to the matching official job-details page. | [Official careers](https://www.darwinbox.com/careers); [official open jobs](https://dbx.darwinbox.in/ms/candidatev2/main/careers/allJobs); [public jobs API](https://dbx.darwinbox.in/ms/candidateapi/job/alljobs?companyId=main) |
| Whatfix | Official careers page links to its public Trakstar board. The scraper reads the complete RSS feed, accepts India-eligible locations, and links to the matching official application form. | [Official careers](https://whatfix.com/careers/); [public job board](https://whatfix101.hire.trakstar.com/); [RSS feed](https://whatfix101.hire.trakstar.com/jobfeeds/whatfix101) |
| Groww | Greenhouse public job-board API. | [Official careers](https://groww.in/careers); [job feed](https://boards-api.greenhouse.io/v1/boards/groww/jobs); [API docs](https://docs.greenhouse.io/job-board.html) |
| CRED | Lever public postings API. | [Official openings](https://careers.cred.club/openings); [job feed](https://api.lever.co/v0/postings/cred?mode=json); [API docs](https://github.com/lever/postings-api#api-methods) |
| Zensar Technologies | Oracle Candidate Experience public REST feed. Only records with `PrimaryLocationCountry=IN` are accepted; the official job-detail URL is built from the verified candidate-experience route and requisition ID. | [Official careers](https://www.zensar.com/careers); [public REST feed](https://fa-etvl-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/11.13.18.05/recruitingCEJobRequisitions); [verified India job](https://fa-etvl-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/143458) |
| Hexaware Technologies | Oracle Candidate Experience public REST feed. Only records with `PrimaryLocationCountry=IN` are accepted; the official job-detail URL is built from the verified candidate-experience route and requisition ID. | [Official careers](https://jobs.hexaware.com/); [public REST feed](https://fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/11.13.18.05/recruitingCEJobRequisitions); [verified India job](https://fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/620106) |
| Mastek | Official search and job-detail pages. Each detail page must expose a recognized India location and a same-job application URL on the official careers host. Posting dates are not exposed in the verified detail content. | [Official job search](https://careers.mastek.com/search); [verified India job](https://careers.mastek.com/job/Senior-Software-Engineer/58876044/) |
| Birlasoft | Official SuccessFactors listings are paginated with the India location filter. Each job detail must confirm the `IN` country code and provide a same-job application URL on the official careers host. | [Official India-filtered listings](https://jobs.birlasoft.com/search/?q=&locationsearch=India); [verified India job](https://jobs.birlasoft.com/job/Noida-SAP-BASIS-SENIOR-CONSULTANT-INDI/58613244/) |
| Cyient | Official Zwayam search endpoint. Only India-eligible records are retained; job links use the verified official job-view route. | [Official careers](https://careers.cyient.com/cyient/); [verified India job](https://careers.cyient.com/cyient/jobview/design-engineer-hyderabad-india-2026100913394514) |
| Happiest Minds | Official careers portal and public Zwayam search feed. The portal provides its own domain and company identifier; listings are filtered through the India location gate and use the portal's verified `/jobview/{jobUrl}` route. | [Official career listings](https://jobs.happiestminds.com/happiestminds/); [public Zwayam search API](https://public.zwayam.com/jobs/search) |
| Coforge | Official careers portal and public Zwayam search feed. The portal provides its own domain and company identifier; listings are filtered through the India location gate and use the portal's verified `/jobview/{jobUrl}` route. | [Official IT career listings](https://careers.coforge.com/coforge/); [public Zwayam search API](https://public.zwayam.com/jobs/search) |

All company adapters run sequentially with bounded request timeouts and retries.
They require a real HTTP(S) application URL and apply the central India location
gate before returning records. Mastek's application URL is additionally required
to match the detail page's requisition ID. Cyient, Happiest Minds, and Coforge public
Zwayam results are paginated and link to each verified official job-view route.
Lever pagination uses its documented `skip` and
`limit` parameters. The verified Greenhouse boards return their result set in one
response, which is capped and deduplicated locally. Oracle Candidate Experience
results are paginated and filtered by the explicit India country code. A failed
adapter is caught by the registry so other company sources continue. Freshworks
fetches posting details sequentially and retries HTTP 429 only when
`Retry-After` is present and at most 30 seconds.

## Official career pages; listings source not verified

These official destinations were checked, but no stable listings source and
real application links suitable for a scraper could be verified. They are not
active scrapers.

| Company | Official careers destination |
| --- | --- |
| Coforge | [Careers portal](https://careers.coforge.com/coforge/) timed out during the latest source check; no public job listing feed or individual apply link was verified. |
| Tata Elxsi | [Official job openings](https://www.tataelxsi.com/careers/job-openings) returned the recruitment notice but no individual listing or application link in the latest source check. |
| Delhivery | https://www.delhivery.com/careers/ currently redirects to the site's 404 page. |
| Ola Cabs | [Official careers page](https://www.olacabs.com/careers) links to the TurboHire board branded Ola Electric, which returned no current postings. No distinct Ola Cabs listings feed was verified, so it is not registered or seeded. |

## Feed found but not safely mappable yet

| Company | Verified public source | Current blocker |
| --- | --- | --- |
| Zerodha | [Official jobs API](https://careers.zerodha.com/api/jobs) | The endpoint returned `{"count":0,"data":[],"success":true}` during verification. No job-item schema or application URL could be verified, so no adapter is registered. |

## Source unavailable or inconclusive

| Company | Verification note |
| --- | --- |
| Zomato | The official destination redirects to Eternal Careers; its public page exposed no job board, API, feed, or individual application links. |
| Udaan | Careers destination could not be retrieved for verification. |
| Dream11 | The official careers footer did not resolve to a job destination; `/careers` returned to the homepage. |
| Ather Energy | The official careers host returned HTTP 403. |
| Policybazaar | The careers page returned HTTP 403 and no accessible careers destination was found on PB Fintech’s site. |
| Practo | The official ParamAI jobs page returned “Page Not Found”; job-fetch requests returned HTTP 404/429. |
| Chargebee | [Official careers page](https://www.chargebee.com/company/careers/) links to Chargebee's LinkedIn jobs page, which redirects to LinkedIn sign-up when opened without an account. No public listings feed or independently verifiable application links were available, so Chargebee is not registered or seeded. |

## Existing published-job audit

Run `node scripts/auditIndiaEligibility.js` from the repository root to perform a
read-only scan of published rows and correlate findings with their
`processed_jobs` and `raw_jobs` rows. It prints only job identifiers, titles,
locations, work mode, application link, and eligibility reason; it does not
print descriptions, credentials, or environment values and performs no writes.

Findings are grouped as clearly non-Indian, remote without verified India
eligibility, or missing/ambiguous location. Treat them as review candidates, not
automatic cleanup instructions. Any future cleanup requires human approval,
an exported before-state for each approved ID, a reversible soft-state change
using a status value confirmed against the live schema, and a verified rollback
path. This audit does not change or unpublish production data.
