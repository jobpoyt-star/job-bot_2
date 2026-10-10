const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  PLAYWRIGHT_HEADLESS,
  PLAYWRIGHT_BROWSER,
  PLAYWRIGHT_LAUNCH_TIMEOUT,
  PLAYWRIGHT_PAGE_TIMEOUT,
  PLAYWRIGHT_LAUNCH_RETRIES,
  PLAYWRIGHT_LAUNCH_RETRY_DELAY,
  JOB_SCRAPE_CRON,
  SCRAPER_BATCH_SIZE,
  LOG_LEVEL,
  ARBEITNOW_RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS,
  JOB_LOOKBACK_DAYS,
  COMPANY_SCRAPER_TIMEOUT_MS,
  SCRAPER_TIMEOUT_MS,
  AI_PRIMARY_PROVIDER,
  AI_PROVIDER,
  GEMINI_MODEL,
  GEMINI_TIMEOUT,
} = process.env;

const supabaseUrl = SUPABASE_URL?.trim();
const supabaseKey = (SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY)?.trim();

module.exports = {
  supabaseUrl,
  supabaseKey,
  playwrightHeadless: PLAYWRIGHT_HEADLESS !== 'false',
  playwrightBrowser: PLAYWRIGHT_BROWSER || 'chromium',
  playwrightLaunchTimeout: Number(PLAYWRIGHT_LAUNCH_TIMEOUT) || 30000,
  playwrightPageTimeout: Number(PLAYWRIGHT_PAGE_TIMEOUT) || 30000,
  playwrightLaunchRetries: Number(PLAYWRIGHT_LAUNCH_RETRIES) || 3,
  playwrightLaunchRetryDelay: Number(PLAYWRIGHT_LAUNCH_RETRY_DELAY) || 1000,
  jobScrapeCron: JOB_SCRAPE_CRON || '30 22 * * *',
  scraperBatchSize: Number(SCRAPER_BATCH_SIZE) || 50,
  logLevel: LOG_LEVEL || 'info',
  aiPrimaryProvider: AI_PRIMARY_PROVIDER || AI_PROVIDER || 'gemini',
  geminiModel: GEMINI_MODEL || 'gemini-2.5-flash-lite',
  geminiTimeoutMs: Number(GEMINI_TIMEOUT) || 60000,
  arbeitnowRetentionDays: Number(ARBEITNOW_RETENTION_DAYS) || 7,
  defaultRetentionDays: Number(DEFAULT_RETENTION_DAYS) || 15,
  jobLookbackDays: Number(JOB_LOOKBACK_DAYS) || 3,
  companyScraperTimeoutMs: Number(COMPANY_SCRAPER_TIMEOUT_MS || SCRAPER_TIMEOUT_MS) || 120000,
};
