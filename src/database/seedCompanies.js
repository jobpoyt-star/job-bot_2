'use strict';

const { ensureCompany, SUPPORTED_COMPANY_NAMES } = require('./companyRepository');

async function seedCompanies({
  companyNames = SUPPORTED_COMPANY_NAMES,
  ensure = ensureCompany,
  logger = console,
} = {}) {
  const result = { succeeded: [], failed: [] };

  for (const name of companyNames) {
    try {
      const company = await ensure({ name });
      if (!company) {
        throw new Error('Company could not be ensured');
      }
      result.succeeded.push(name);
    } catch (error) {
      result.failed.push({ name, message: error.message });
      logger.error(`Company seed failed for "${name}": ${error.message}`);
    }
  }

  return result;
}

if (require.main === module) {
  seedCompanies()
    .then(({ succeeded, failed }) => {
      console.log(`Company seed completed: ${succeeded.length} ensured, ${failed.length} failed`);
      if (failed.length) process.exitCode = 1;
    })
    .catch((error) => {
      console.error('Company seed failed:', error.message);
      process.exitCode = 1;
    });
}

module.exports = { seedCompanies };
