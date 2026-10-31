'use strict';

const supabase = require('./supabaseClient');
const logger = require('../utils/logger');

const SUPPORTED_COMPANY_NAMES = [
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

const DEFAULT_CAREER_URLS = {
  zoho: 'https://careers.zohocorp.com/jobs/Careers',
  freshworks: 'https://careers.smartrecruiters.com/Freshworks',
  'zensar technologies': 'https://www.zensar.com/careers',
  mastek: 'https://careers.mastek.com/search',
  cyient: 'https://careers.cyient.com/cyient/',
  'happiest minds': 'https://jobs.happiestminds.com/happiestminds/',
  coforge: 'https://careers.coforge.com/coforge/',
  razorpay: 'https://razorpay.com/careers/',
  'hexaware technologies': 'https://jobs.hexaware.com/',
  paytm: 'https://paytm.com/careers/',
  meesho: 'https://www.meesho.io/jobs',
  swiggy: 'https://careers.swiggy.in/',
  groww: 'https://groww.in/careers',
  cred: 'https://careers.cred.club/',
  'nucleus software': 'https://nucleussoftware.zohorecruit.in/jobs/Careers',
  birlasoft: 'https://jobs.birlasoft.com/',
  phonepe: 'https://www.phonepe.com/careers/job-openings/',
  flipkart: 'https://www.flipkartcareers.com/',
  zerodha: 'https://careers.zerodha.com/',
  delhivery: 'https://www.delhivery.com/careers',
  'sonata software': 'https://www.sonata-software.com/careers',
  'sasken technologies': 'https://careers.sasken.com/tb/saskenjobs/',
  'l&t technology services': 'https://www.ltts.com/careers',
  'kpit technologies': 'https://www.kpit.com/careers-overview/',
  'ather energy': 'https://careers.atherenergy.com/',
  'ola electric': 'https://olacareers.turbohire.co/careerpage/e0c1eb37-eb7a-4ca4-bcc5-d59ce4ce9212',
  makemytrip: 'https://careers.makemytrip.com/',
  'aurionpro solutions': 'https://www.aurionpro.com/careers/',
  genpact: 'https://www.genpact.com/careers',
  browserstack: 'https://www.browserstack.com/careers',
  postman: 'https://www.postman.com/company/careers/open-positions/',
  darwinbox: 'https://www.darwinbox.com/careers',
  whatfix: 'https://whatfix.com/careers/',
};

function getDefaultCareerUrl(name) {
  const normalizedName = String(name || '').trim().toLowerCase();
  if (!normalizedName) return null;
  return DEFAULT_CAREER_URLS[normalizedName] || null;
}

async function getCompanyByName(name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    return null;
  }

  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .ilike('name', normalizedName)
    .maybeSingle();

  if (error) {
    logger.warn(`Company lookup failed for "${normalizedName}": ${error.message}`);
    throw error;
  }

  return data;
}

async function getEnabledCompanies() {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('enabled', true);

  if (error) {
    return [];
  }

  return data || [];
}

async function ensureCompany(companyData) {
  const name = String(companyData?.name || '').trim();
  if (!name) {
    return null;
  }

  const payload = {
    name,
    enabled: companyData.enabled !== false,
    career_url: companyData.career_url || companyData.careerUrl || companyData.url || getDefaultCareerUrl(companyData.name),
  };

  const existing = await getCompanyByName(payload.name);
  if (existing) {
    logger.info(`ensureCompany reused existing company for "${payload.name}"`);
    return existing;
  }

  const { data, error } = await supabase
    .from('companies')
    .insert([payload])
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      const concurrentlyCreated = await getCompanyByName(payload.name);
      if (concurrentlyCreated) {
        logger.info(`ensureCompany reused concurrently created company for "${payload.name}"`);
        return concurrentlyCreated;
      }
    }
    logger.error(`Supabase ensureCompany failed for "${payload.name}": ${error.message}`);
    if (error.details) {
      logger.error(`Supabase ensureCompany details: ${error.details}`);
    }
    if (error.hint) {
      logger.error(`Supabase ensureCompany hint: ${error.hint}`);
    }
    return null;
  }

  logger.info(`ensureCompany created company for "${payload.name}"`);
  return data;
}

module.exports = {
  SUPPORTED_COMPANY_NAMES,
  getDefaultCareerUrl,
  getCompanyByName,
  getEnabledCompanies,
  ensureCompany,
};
