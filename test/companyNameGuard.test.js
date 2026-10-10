const test = require('node:test');
const assert = require('node:assert/strict');
const { fillMissingFields } = require('../src/ai/jobExtractor');

test('fillMissingFields does not trust an unsupported source as the company name', () => {
  const result = fillMissingFields({
    title: 'Senior Software Engineer',
    company: null,
    source: 'Legacy Source',
    location: null,
    description: 'Build and ship scalable cloud services.',
    experience: null,
    employment_type: null,
    work_mode: null,
    salary: null,
    summary: null,
    skills: null,
    responsibilities: null,
    benefits: null,
  }, {});

  assert.equal(result.company, null);
});

test('fillMissingFields accepts supported product companies', () => {
  for (const company of ['Zoho', 'Freshworks', 'Razorpay', 'PhonePe', 'Paytm', 'Flipkart']) {
    const result = fillMissingFields({
      title: 'Senior Software Engineer',
      company: null,
      source: company,
      location: null,
      description: 'Build and ship scalable cloud services.',
      experience: null,
      employment_type: null,
      work_mode: null,
      salary: null,
      summary: null,
      skills: null,
      responsibilities: null,
      benefits: null,
    }, {});

    assert.equal(result.company, company);
  }
});
