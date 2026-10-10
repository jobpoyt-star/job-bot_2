const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateIndiaEligibility,
  shouldSaveJob,
} = require('../src/parsers/common/jobFilters');

test('accepts an onsite job in Hyderabad without a country field', () => {
  assert.equal(shouldSaveJob({ location: 'Hyderabad', work_mode: 'Onsite' }), true);
});

test('accepts a hybrid job in Bengaluru without a country field', () => {
  assert.equal(shouldSaveJob({ location: 'Bengaluru', work_mode: 'Hybrid' }), true);
});

test('accepts remote jobs explicitly eligible in India', () => {
  assert.equal(shouldSaveJob({ location: 'Remote - India', work_mode: 'Remote' }), true);
  assert.equal(shouldSaveJob({ location: 'Remote', work_mode: 'Remote', description: 'You may work remotely from anywhere in India.' }), true);
});

test('rejects an onsite job in the United States', () => {
  const result = evaluateIndiaEligibility({ location: 'Austin, United States', country: 'US', work_mode: 'Onsite' });
  assert.equal(result.eligible, false);
  assert.equal(result.status, 'rejected');
});

test('rejects a remote-only job restricted to the United Kingdom', () => {
  const result = evaluateIndiaEligibility({ location: 'Remote, UK', country: 'GB', work_mode: 'Remote' });
  assert.equal(result.eligible, false);
  assert.equal(result.status, 'rejected');
});

test('quarantines remote jobs without reliable India eligibility', () => {
  const result = evaluateIndiaEligibility({ location: 'Remote', work_mode: 'Remote' });
  assert.equal(result.eligible, false);
  assert.equal(result.status, 'quarantine');
  assert.equal(result.reason, 'remote_india_eligibility_unverified');
});

test('rejects a foreign-location job whose unrelated description mentions India', () => {
  assert.equal(shouldSaveJob({
    location: 'London, UK',
    country: 'United Kingdom',
    work_mode: 'Onsite',
    description: 'Our customers and offices in India are growing.',
  }), false);
});

test('accepts a verified Indian city without an explicit country', () => {
  assert.equal(shouldSaveJob({ location: 'Pune, Maharashtra', work_mode: 'Hybrid' }), true);
});

test('accepts an India country field and persists location evidence for later publication', () => {
  const result = evaluateIndiaEligibility({ location: 'Remote', country: 'IN', work_mode: 'Remote' });
  assert.equal(result.eligible, true);
  assert.equal(result.persistedLocation, 'Remote, India');
});

test('quarantines missing or malformed location fields without throwing', () => {
  for (const job of [{}, { location: { unexpected: true } }, null]) {
    assert.equal(evaluateIndiaEligibility(job).eligible, false);
  }
});

test('does not treat India in the title alone as location evidence', () => {
  assert.equal(shouldSaveJob({ title: 'India Product Manager', location: 'Remote', work_mode: 'Remote' }), false);
});

test('does not allow a foreign country field to be overridden by an Indian city string', () => {
  assert.equal(shouldSaveJob({ location: 'Bengaluru', country: 'United States', work_mode: 'Hybrid' }), false);
});

test('accepts structured Indian location and ISO country objects', () => {
  const result = evaluateIndiaEligibility({
    location: { city: 'Pune', country: { code: 'IN', name: 'India' } },
    work_mode: 'Hybrid',
  });

  assert.equal(result.eligible, true);
  assert.equal(result.persistedLocation, 'Pune, India');
});

test('accepts remote roles explicitly open to candidates in India', () => {
  const result = evaluateIndiaEligibility({
    location: 'Remote',
    work_mode: 'Remote',
    eligible_countries: [{ countryCode: 'IN' }],
  });

  assert.equal(result.eligible, true);
  assert.equal(result.persistedLocation, 'Remote, India');
});

test('accepts a remote country eligibility list that explicitly includes India', () => {
  const result = evaluateIndiaEligibility({
    location: 'Remote',
    work_mode: 'Remote',
    eligible_countries: ['US', 'IN'],
  });

  assert.equal(result.eligible, true);
  assert.equal(result.persistedLocation, 'Remote, India');
});

test('rejects remote roles explicitly limited to foreign candidate locations', () => {
  const result = evaluateIndiaEligibility({
    location: 'Remote',
    work_mode: 'Remote',
    candidate_required_location: 'Brazil',
  });

  assert.equal(result.eligible, false);
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /^outside_india:/);
});

test('rejects remote jobs with a country-code list that excludes India', () => {
  const result = evaluateIndiaEligibility({
    location: 'Remote',
    work_mode: 'Remote',
    eligible_countries: 'US, CA',
  });

  assert.equal(result.eligible, false);
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /^outside_india:/);
});
