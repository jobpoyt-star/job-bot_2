'use strict';

const { enrichJobWithGroq } = require('./jobExtractor');

function selectAIProvider() {
  return 'groq';
}

function createJobEnricher(dependencies = {}) {
  let lastSuccessfulProvider = null;

  const enrichJob = async function enrichJob(job, runtimeDependencies = {}) {
    const mergedDependencies = { ...dependencies, ...runtimeDependencies };
    const logger = mergedDependencies.logger || console;

    logger.info('AI_PROVIDER_ATTEMPT provider=groq');
    try {
      const result = await enrichJobWithGroq(job, mergedDependencies);
      lastSuccessfulProvider = 'groq';
      logger.info('AI_PROVIDER_SUCCESS provider=groq');
      return result;
    } catch (error) {
      logger.error('AI_ENRICHMENT_FAILED providers=groq');
      throw error;
    }
  };

  enrichJob.getLastSuccessfulProvider = () => lastSuccessfulProvider;
  return enrichJob;
}

module.exports = {
  createJobEnricher,
  enrichJobWithGroq,
  selectAIProvider,
};
