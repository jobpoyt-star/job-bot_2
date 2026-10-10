'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateIndiaEligibility } = require('../src/parsers/common/jobFilters');
const { getRegisteredScraperKeys } = require('../src/scrapers');
const { SUPPORTED_COMPANY_NAMES } = require('../src/database/companyRepository');

test('orphaned non-target importer fixtures are rejected or quarantined before ingestion', () => {
  const cases = [
    {
      name: 'Coinbase remote-US record',
      job: { location: 'Remote - US', work_mode: 'remote' },
      reason: 'outside_india',
    },
    {
      name: 'Greenhouse San Francisco record',
      job: { location: { name: 'San Francisco, CA' } },
      reason: 'outside_india',
    },
    {
      name: 'Greenhouse remote-US record',
      job: { location: { name: 'Remote - US' }, work_mode: 'remote' },
      reason: 'outside_india',
    },
    {
      name: 'Remote OK US record',
      job: { location: 'Remote, US', work_mode: 'remote' },
      reason: 'outside_india',
    },
    {
      name: 'Remotive Brazil-only remote record',
      job: { location: 'Brazil', work_mode: 'remote' },
      reason: 'outside_india',
    },
    {
      name: 'We Work Remotely worldwide record',
      job: { location: 'Anywhere in the World', work_mode: 'remote' },
      reason: 'remote_india_eligibility_unverified',
    },
  ];

  for (const { name, job, reason } of cases) {
    const eligibility = evaluateIndiaEligibility(job);
    assert.equal(eligibility.eligible, false, name);
    assert.equal(eligibility.reason.startsWith(reason), true, name);
  }
});

test('HCLTech and TCS are not seeded or active company scraper targets', () => {
  assert.equal(SUPPORTED_COMPANY_NAMES.includes('HCLTech'), false);
  assert.equal(SUPPORTED_COMPANY_NAMES.includes('TCS'), false);
  assert.deepEqual(SUPPORTED_COMPANY_NAMES, [
    'Zoho', 'Freshworks', 'Razorpay', 'PhonePe', 'Paytm', 'Flipkart', 'Meesho',
    'Swiggy', 'Zomato', 'Groww', 'Zerodha', 'CRED', 'Udaan', 'Dream11',
    'Delhivery', 'Ather Energy', 'Ola', 'MakeMyTrip', 'Policybazaar', 'Practo',
  ]);
  assert.deepEqual(getRegisteredScraperKeys(), [
    'freshworks', 'razorpay', 'paytm', 'meesho', 'swiggy', 'groww', 'cred',
  ]);
});

test('only sources with verified public listings feeds are active', () => {
  assert.deepEqual(getRegisteredScraperKeys(), [
    'freshworks', 'razorpay', 'paytm', 'meesho', 'swiggy', 'groww', 'cred',
  ]);
});
