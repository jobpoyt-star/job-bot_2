# India company targets and source status

The job pipeline currently registers only a company source with a verified public
job-listings API. Official careers pages without a verified feed are documented
below but are not scraped or represented as working integrations. Targets with
inaccessible or inconclusive pages are not assigned guessed URLs or API endpoints.
New raw jobs are checked for India eligibility before persistence, and the
publisher repeats the check for previously stored jobs. Explicit India-remote
eligibility is converted into an India-qualified location before storage;
publication does not trust an AI-generated description alone as location proof.

The repository also contained importer tests for Coinbase, Greenhouse, HCLTech,
Remote OK, Remotive, and We Work Remotely, but the referenced modules were absent
and the scheduler has no configured import sources. Those orphaned tests were
replaced with India-eligibility fixture tests; no such importer is active.

## Integrated source

| Company | Integration | Verified source |
| --- | --- | --- |
| Freshworks | SmartRecruiters public postings API. Results are paginated, detail records are fetched sequentially, and only India-eligible jobs with an application URL are returned. | [Official career listings](https://careers.smartrecruiters.com/Freshworks); [public postings API](https://api.smartrecruiters.com/v1/companies/Freshworks/postings?limit=1&offset=0); [SmartRecruiters API guide](https://developers.smartrecruiters.com/docs/get-job-postings.md) |
| Razorpay | Greenhouse public job-board API. | [Official careers](https://razorpay.com/careers/); [job feed](https://boards-api.greenhouse.io/v1/boards/razorpaysoftwareprivatelimited/jobs); [API docs](https://docs.greenhouse.io/job-board.html) |
| Paytm | Lever public postings API with `skip`/`limit` pagination. Multi-location postings are restricted to verified Indian locations. | [Official careers](https://paytm.com/careers/); [job feed](https://api.lever.co/v0/postings/paytm?skip=0&limit=1&mode=json); [API docs](https://github.com/lever/postings-api#api-methods) |
| Meesho | Lever public postings API with `skip`/`limit` pagination. | [Official jobs](https://www.meesho.io/jobs); [job feed](https://api.lever.co/v0/postings/meesho?skip=0&limit=1&mode=json); [API docs](https://github.com/lever/postings-api#api-methods) |
| Swiggy | Public jobs JSON feed; supplied application URLs are retained as-is. | [Official careers](https://careers.swiggy.in/); [job feed](https://careers.swiggy.in/api/jobs.json) |
| Groww | Greenhouse public job-board API. | [Official careers](https://groww.in/careers); [job feed](https://boards-api.eu.greenhouse.io/v1/boards/groww/jobs); [API docs](https://docs.greenhouse.io/job-board.html) |
| CRED | Lever public postings API. | [Official openings](https://careers.cred.club/openings); [job feed](https://api.lever.co/v0/postings/cred?mode=json); [API docs](https://github.com/lever/postings-api#api-methods) |

All company adapters run sequentially with bounded request timeouts and retries.
They require a real HTTP(S) application URL and apply the central India location
gate before returning records. Lever pagination uses its documented `skip` and
`limit` parameters. The verified Greenhouse boards return their result set in one
response, which is capped and deduplicated locally. A failed adapter
is caught by the registry so other company sources continue. Freshworks fetches
posting details sequentially and retries HTTP 429 only when `Retry-After` is
present and at most 30 seconds.

## Official career pages; listings source not verified

These official destinations were reachable or linked from the company careers
page, but the browser-backed shared scraper does not have verified selectors,
stable listing data, and real apply links to consume. They are not active
scrapers.

| Company | Official careers destination |
| --- | --- |
| Zoho | https://www.zoho.com/careers/ links to role pages on https://careers.zohocorp.com/; a role page was accessible, but a listings feed/collection or supported API was not verified. |
| PhonePe | https://www.phonepe.com/careers/job-openings/ returned a general hiring page; job records and application links were not exposed in the fetched page. |
| Flipkart | https://www.flipkartcareers.com/ links to a TurboHire app shell; a collection feed/schema was not verified. |
| Delhivery | https://www.delhivery.com/careers/ currently redirects to the site's 404 page. |
| Ola | https://www.olacabs.com/careers links to a TurboHire page; that page exposed no current listing collection or verifiable application links. |

## Feed found but not safely mappable yet

| Company | Verified public source | Current blocker |
| --- | --- | --- |
| Zerodha | [Official jobs API](https://careers.zerodha.com/api/jobs) | The endpoint returned `{"count":0,"data":[],"success":true}` during verification. No job-item schema or application URL could be verified, so no adapter is registered. |
| MakeMyTrip | [Official careers API](https://careers.makemytrip.com/api/jobs) | The feed currently returns India job records but has no application URL field. The careers page's record-to-application route could not be verified, so no apply URLs are constructed or guessed. |

## Source unavailable or inconclusive

| Company | Verification note |
| --- | --- |
| Zomato | The official destination redirects to Eternal Careers; its public page exposed no job board, API, feed, or individual application links. |
| Udaan | Careers destination could not be retrieved for verification. |
| Dream11 | The official careers footer did not resolve to a job destination; `/careers` returned to the homepage. |
| Ather Energy | The official careers host returned HTTP 403. |
| Policybazaar | The careers page returned HTTP 403 and no accessible careers destination was found on PB Fintech’s site. |
| Practo | The official ParamAI jobs page returned “Page Not Found”; job-fetch requests returned HTTP 404/429. |

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
