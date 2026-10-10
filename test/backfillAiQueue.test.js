'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { filterIndiaEligibleRawJobs } = require('../scripts/backfillAiQueue');

test('AI queue backfill only includes India-eligible raw jobs', () => {
  const skippedReasons = [];
  const rows = filterIndiaEligibleRawJobs([
    { id: 'india', location: 'Chennai, India' },
    { id: 'foreign', location: 'London, UK' },
    { id: 'unknown', location: 'Remote', work_mode: 'Remote' },
  ], {
    info(message) {
      skippedReasons.push(message);
    },
  });

  assert.deepEqual(rows.map((row) => row.id), ['india']);
  assert.equal(skippedReasons.length, 2);
  assert.match(skippedReasons[0], /outside_india/);
  assert.match(skippedReasons[1], /remote_india_eligibility_unverified/);
});
