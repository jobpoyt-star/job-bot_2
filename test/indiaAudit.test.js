'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyPublishedJob } = require('../scripts/auditIndiaEligibility');

test('read-only audit distinguishes foreign, unverified remote, and ambiguous published jobs', () => {
  assert.equal(classifyPublishedJob({ location: 'Austin, United States', work_mode: 'Onsite' }), 'clearly_non_indian');
  assert.equal(classifyPublishedJob({ location: 'Remote', work_mode: 'Remote' }), 'remote_india_eligibility_unverified');
  assert.equal(classifyPublishedJob({ location: null, work_mode: 'Onsite' }), 'missing_or_ambiguous_location');
  assert.equal(classifyPublishedJob({ location: 'Chennai, India', work_mode: 'Hybrid' }), null);
});
