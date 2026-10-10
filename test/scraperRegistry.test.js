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
  assert.deepEqual(activeTargets, ['freshworks', 'razorpay', 'paytm', 'meesho', 'swiggy', 'groww', 'cred']);
  for (const target of removedCompanyTargets) {
    assert.equal(activeTargets.includes(target), false, `${target} must not be active`);
  }
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

test('registered scrapers cannot return foreign or ambiguous jobs into the pipeline', async () => {
  const jobs = await runScrapers(['source'], {
    registry: {
      source() {
        return {
          result: [
            { title: 'US job', location: 'Austin, United States' },
            { title: 'Unknown job', location: 'Remote' },
            { title: 'India job', location: { city: 'Pune', country: { code: 'IN' } } },
          ],
        };
      },
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].location, 'Pune, India');
});

test('unregistered company keys are skipped instead of treated as arbitrary career URLs', async () => {
  const jobs = await runScrapers(['old-company'], { registry: {} });
  assert.deepEqual(jobs, []);
});
