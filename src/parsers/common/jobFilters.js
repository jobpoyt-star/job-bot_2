'use strict';

function normalizeText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return normalizeText(
      value.name
      || value.label
      || value.value
      || value.code
      || value.countryCode
      || value.isoCode
      || value.alpha2Code
      || value.city
      || value.state
      || value.country
      || ''
    );
  }
  return String(value).trim();
}

const INDIA_LOCATION_NAMES = [
  'ahmedabad', 'bangalore', 'bengaluru', 'bhopal', 'bhubaneswar', 'chandigarh',
  'chennai', 'coimbatore', 'delhi ncr', 'gurgaon', 'gurugram', 'hyderabad',
  'indore', 'jaipur', 'kanpur', 'kochi', 'kolkata', 'lucknow', 'mumbai',
  'mysore', 'mysuru', 'nagpur', 'nashik', 'noida', 'patna', 'pune',
  'surat', 'thiruvananthapuram', 'trivandrum', 'vadodara', 'visakhapatnam',
  'vizag', 'vijayawada', 'agra', 'amritsar', 'dehradun', 'faridabad',
  'ghaziabad', 'gurugram', 'jodhpur', 'madurai', 'mangalore', 'mangaluru',
  'meerut', 'rajkot', 'ranchi', 'shimla', 'srinagar', 'udaipur', 'varanasi',
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh',
  'goa', 'gujarat', 'haryana', 'himachal pradesh', 'jharkhand', 'karnataka',
  'kerala', 'madhya pradesh', 'maharashtra', 'manipur', 'meghalaya', 'mizoram',
  'nagaland', 'odisha', 'orissa', 'punjab', 'rajasthan', 'sikkim', 'tamil nadu',
  'telangana', 'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal',
  'andaman and nicobar islands', 'chandigarh', 'dadra and nagar haveli',
  'daman and diu', 'delhi', 'jammu and kashmir', 'ladakh', 'lakshadweep',
  'puducherry', 'pondicherry',
];

const FOREIGN_LOCATION_NAMES = [
  'united states', 'united states of america', 'usa', 'u.s.a.', 'us remote', 'remote us',
  'united kingdom', 'great britain', 'uk remote', 'remote uk', 'canada', 'australia',
  'new zealand', 'germany', 'france', 'spain', 'italy', 'netherlands',
  'ireland', 'singapore', 'japan', 'china', 'brazil', 'mexico', 'switzerland',
  'sweden', 'norway', 'denmark', 'poland', 'portugal', 'israel', 'uae',
  'united arab emirates', 'south africa', 'philippines', 'malaysia',
  'indonesia', 'thailand', 'romania', 'czech republic', 'europe',
  'north america', 'latin america', 'new york', 'san francisco', 'seattle',
  'austin', 'boston', 'chicago', 'los angeles', 'london', 'manchester',
  'toronto', 'vancouver', 'sydney', 'melbourne', 'berlin', 'paris',
];

const INDIA_REMOTE_PATTERNS = [
  /\bremote(?:\s+(?:work|role|position))?\s+(?:from|within|in|across)\s+(?:anywhere\s+in\s+)?india\b/i,
  /\bwork\s+remotely?\s+from\s+(?:anywhere\s+in\s+)?india\b/i,
  /\bwork\s+from\s+anywhere\s+in\s+india\b/i,
  /\bindia[-\s]+(?:based[-\s]+)?remote\b/i,
  /\bremote\s*[-—,]\s*india\b/i,
  /\bindia\s*[-—,]\s*remote\b/i,
  /\b(?:candidates|employees|applicants)\s+(?:must|should|can|may)\s+be\s+based\s+in\s+india\b/i,
  /\bremote\s+(?:only\s+)?for\s+(?:candidates|employees|applicants)\s+based\s+in\s+india\b/i,
];

function matchesLocation(text, names) {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  return names.find((name) => {
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return normalized.includes(` ${normalizedName} `);
  }) || null;
}

function isIndiaCountry(value) {
  const country = normalizeText(value).toLowerCase().replace(/[.,]/g, '').trim();
  return ['india', 'in', 'ind'].includes(country) || /\bindia\b/.test(country);
}

function isForeignCountry(value) {
  const country = normalizeText(value);
  if (!country || isIndiaCountry(country)) return false;
  const foreignMatch = matchesLocation(country, FOREIGN_LOCATION_NAMES);
  if (foreignMatch) return true;
  return /^[a-z]{2,3}$/i.test(country) && !['apac', 'emea'].includes(country.toLowerCase());
}

function flattenCountryValues(values) {
  return values.flatMap((value) => {
    const candidates = Array.isArray(value) ? value : [value];
    return candidates.flatMap((candidate) => {
      if (typeof candidate === 'string') {
        return candidate.split(/\s*[,;|]\s*/).map(normalizeText).filter(Boolean);
      }
      const normalized = normalizeText(candidate);
      return normalized ? [normalized] : [];
    });
  });
}

function getStructuredCountries(job) {
  const directCountries = [
    job?.country,
    job?.country_name,
    job?.countryName,
    job?.country_code,
    job?.countryCode,
    job?.remote_country,
    job?.remoteCountry,
    job?.location?.country,
    job?.location?.country_name,
    job?.location?.countryName,
    job?.location?.country_code,
    job?.location?.countryCode,
  ];
  return flattenCountryValues(directCountries);
}

function getRemoteEligibleCountries(job) {
  const values = [
    job?.eligible_countries,
    job?.eligibleCountries,
    job?.remote_eligible_countries,
    job?.remoteEligibleCountries,
    job?.candidate_required_location,
    job?.candidateRequiredLocation,
    job?.location?.eligibleCountries,
  ];
  return flattenCountryValues(values);
}

function getLocationText(job) {
  const location = job?.location;
  const locationFields = location && typeof location === 'object' && !Array.isArray(location)
    ? [location.fullLocation, location.full_location, location.name, location.city, location.state, location.region, location.address]
    : [location];
  const values = [
    ...locationFields,
    job?.city,
    job?.state,
    job?.region,
    job?.location_name,
    job?.locationName,
  ];
  return values.map(normalizeText).filter(Boolean).join(', ');
}

function isRemoteJob(job) {
  const mode = normalizeText(job?.work_mode || job?.workMode || job?.workplace_type || job?.workplaceType).toLowerCase();
  const location = getLocationText(job).toLowerCase();
  return job?.remote === true
    || job?.is_remote === true
    || job?.isRemote === true
    || /\b(remote|work from home|home office|telecommute)\b/.test(`${mode} ${location}`);
}

function evaluateIndiaEligibility(job) {
  if (!job || typeof job !== 'object') {
    return { eligible: false, status: 'quarantine', reason: 'invalid_job' };
  }

  const location = getLocationText(job);
  const countries = getStructuredCountries(job);
  const remoteCountries = getRemoteEligibleCountries(job);
  const remote = isRemoteJob(job);
  const indiaRemoteEligibility = remote && remoteCountries.some(isIndiaCountry);
  const foreignCountry = countries.find(isForeignCountry)
    || (remote && !indiaRemoteEligibility ? remoteCountries.find(isForeignCountry) : null);
  const foreignLocation = matchesLocation(location, FOREIGN_LOCATION_NAMES);
  if (foreignCountry || foreignLocation) {
    return {
      eligible: false,
      status: 'rejected',
      reason: `outside_india:${(foreignCountry || foreignLocation).toLowerCase()}`,
    };
  }

  const indiaCountry = countries.some(isIndiaCountry)
    || indiaRemoteEligibility;
  const indiaLocation = matchesLocation(location, INDIA_LOCATION_NAMES);
  const indiaNamedLocation = /\bindia\b/i.test(location);
  if (indiaCountry || indiaLocation || indiaNamedLocation) {
    const persistedLocation = location
      ? (indiaCountry && !/\bindia\b/i.test(location) ? `${location}, India` : location)
      : 'India';
    return { eligible: true, status: 'eligible', reason: 'verified_india_location', persistedLocation };
  }

  if (remote) {
    const supportingText = normalizeText(job?.description);
    const explicitIndiaRemote = INDIA_REMOTE_PATTERNS.some((pattern) => pattern.test(supportingText))
      || INDIA_REMOTE_PATTERNS.some((pattern) => pattern.test(location));
    if (explicitIndiaRemote) {
      return {
        eligible: true,
        status: 'eligible',
        reason: 'explicit_india_remote_eligibility',
        persistedLocation: /\bindia\b/i.test(location) ? location : `${location || 'Remote'}, India`,
      };
    }
    return { eligible: false, status: 'quarantine', reason: 'remote_india_eligibility_unverified' };
  }

  return { eligible: false, status: 'quarantine', reason: 'india_location_unverified' };
}

function isIndiaJob(job) {
  const result = evaluateIndiaEligibility(job);
  return result.eligible;
}

function shouldSaveJob(job) {
  return evaluateIndiaEligibility(job).eligible;
}

module.exports = {
  evaluateIndiaEligibility,
  isIndiaJob,
  isRemoteJob,
  shouldSaveJob,
};
