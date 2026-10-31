'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const supabase = require('../src/database/supabaseClient');
const { SUPPORTED_COMPANY_NAMES, getDefaultCareerUrl } = require('../src/database/companyRepository');
const { seedCompanies } = require('../src/database/seedCompanies');
const { getRegisteredScraperKeys } = require('../src/scrapers');

const ACTIVE_COMPANY_NAMES = [
  'Zoho',
  'Freshworks',
  'Zensar Technologies',
  'Mastek',
  'Cyient',
  'Happiest Minds',
  'Coforge',
  'Razorpay',
  'Hexaware Technologies',
  'Paytm',
  'Meesho',
  'Swiggy',
  'Groww',
  'CRED',
  'Nucleus Software',
  'Birlasoft',
  'PhonePe',
  'Flipkart',
  'Zerodha',
  'Delhivery',
  'Sonata Software',
  'Sasken Technologies',
  'L&T Technology Services',
  'KPIT Technologies',
  'Ather Energy',
  'Ola Electric',
  'MakeMyTrip',
  'Aurionpro Solutions',
  'Genpact',
  'BrowserStack',
  'Postman',
  'Darwinbox',
  'Whatfix',
];

const COMPANY_NAME_BY_SCRAPER = {
  zoho: 'Zoho',
  freshworks: 'Freshworks',
  razorpay: 'Razorpay',
  paytm: 'Paytm',
  meesho: 'Meesho',
  swiggy: 'Swiggy',
  groww: 'Groww',
  cred: 'CRED',
  zensar: 'Zensar Technologies',
  hexaware: 'Hexaware Technologies',
  nucleus: 'Nucleus Software',
  mastek: 'Mastek',
  cyient: 'Cyient',
  happiestminds: 'Happiest Minds',
  coforge: 'Coforge',
  birlasoft: 'Birlasoft',
  phonepe: 'PhonePe',
  flipkart: 'Flipkart',
  zerodha: 'Zerodha',
  delhivery: 'Delhivery',
  sonata: 'Sonata Software',
  sasken: 'Sasken Technologies',
  ltts: 'L&T Technology Services',
  kpit: 'KPIT Technologies',
  atherenergy: 'Ather Energy',
  olaelectric: 'Ola Electric',
  makemytrip: 'MakeMyTrip',
  aurionpro: 'Aurionpro Solutions',
  genpact: 'Genpact',
  browserstack: 'BrowserStack',
  postman: 'Postman',
  darwinbox: 'Darwinbox',
  whatfix: 'Whatfix',
};

test('only implemented registered scrapers are included in company registration', () => {
  assert.deepEqual(SUPPORTED_COMPANY_NAMES, ACTIVE_COMPANY_NAMES);
  assert.deepEqual(
    new Set(getRegisteredScraperKeys().map((key) => COMPANY_NAME_BY_SCRAPER[key])),
    new Set(SUPPORTED_COMPANY_NAMES)
  );
  for (const name of ACTIVE_COMPANY_NAMES) {
    assert.match(getDefaultCareerUrl(name), /^https:\/\/.+/);
  }
});

test('company seeding continues after a company-specific failure and reports it', async () => {
  const ensured = [];
  const errors = [];
  const result = await seedCompanies({
    companyNames: ['First Company', 'Broken Company', 'Last Company'],
    ensure: async ({ name }) => {
      if (name === 'Broken Company') throw new Error('database unavailable');
      ensured.push(name);
      return { name };
    },
    logger: { error: (message) => errors.push(message) },
  });

  assert.deepEqual(ensured, ['First Company', 'Last Company']);
  assert.deepEqual(result.succeeded, ['First Company', 'Last Company']);
  assert.deepEqual(result.failed, [{ name: 'Broken Company', message: 'database unavailable' }]);
  assert.match(errors[0], /Broken Company/);
});

test('rerunning the company seed does not insert duplicate company rows', async () => {
  const originalFrom = supabase.from;
  const companies = new Map();
  let insertCount = 0;

  supabase.from = (table) => {
    assert.equal(table, 'companies');
    let name = '';
    let insertPayload = null;
    const query = {
      select() {
        return query;
      },
      ilike(_column, value) {
        name = String(value).toLowerCase();
        return query;
      },
      insert([payload]) {
        insertPayload = payload;
        name = payload.name.toLowerCase();
        return query;
      },
      async maybeSingle() {
        if (insertPayload) {
          insertCount += 1;
          const company = { ...insertPayload, id: `company-${insertCount}` };
          companies.set(name, company);
          return { data: company, error: null };
        }
        return { data: companies.get(name) || null, error: null };
      },
    };
    return query;
  };

  try {
    const firstRun = await seedCompanies({ logger: { error: assert.fail } });
    const secondRun = await seedCompanies({ logger: { error: assert.fail } });

    assert.equal(firstRun.succeeded.length, ACTIVE_COMPANY_NAMES.length);
    assert.equal(secondRun.succeeded.length, ACTIVE_COMPANY_NAMES.length);
    assert.equal(insertCount, ACTIVE_COMPANY_NAMES.length);
    assert.equal(companies.size, ACTIVE_COMPANY_NAMES.length);
  } finally {
    supabase.from = originalFrom;
  }
});
