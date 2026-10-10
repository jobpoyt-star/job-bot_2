'use strict';

const { enrichJobWithGemini, enrichJobWithOllama, enrichJobWithGroq } = require('./jobExtractor');
const { classifyGeminiError } = require('./geminiClient');
const { aiPrimaryProvider } = require('../config/env');

const SUPPORTED_PROVIDERS = new Set(['gemini', 'groq', 'ollama']);

function normalizeProvider(value) {
  const provider = String(value || '').toLowerCase().trim();
  return SUPPORTED_PROVIDERS.has(provider) ? provider : null;
}

function selectAIProvider(dependencies = {}) {
  const requestedProvider = normalizeProvider(dependencies.provider);
  if (requestedProvider) {
    return requestedProvider;
  }

  if (dependencies.ollamaClient && !dependencies.groqClient && !dependencies.geminiClient) {
    return 'ollama';
  }

  if (dependencies.groqClient && !dependencies.ollamaClient && !dependencies.geminiClient) {
    return 'groq';
  }

  return normalizeProvider(process.env.AI_PRIMARY_PROVIDER)
    || normalizeProvider(process.env.AI_PROVIDER)
    || normalizeProvider(aiPrimaryProvider)
    || 'gemini';
}

function createJobEnricher(dependencies = {}) {
  let lastSuccessfulProvider = null;
  const enrichJob = async function enrichJob(job, runtimeDependencies = {}) {
    const mergedDependencies = { ...dependencies, ...runtimeDependencies };
    const provider = selectAIProvider(mergedDependencies);
    const logger = mergedDependencies.logger || console;

    if (provider !== 'gemini') {
      const enrichmentFunction = provider === 'groq' ? enrichJobWithGroq : enrichJobWithOllama;
      logger.info(`AI_PROVIDER_ATTEMPT provider=${provider}`);
      try {
        const result = await enrichmentFunction(job, mergedDependencies);
        lastSuccessfulProvider = provider;
        logger.info(`AI_PROVIDER_SUCCESS provider=${provider}`);
        return result;
      } catch (error) {
        logger.error(`AI_ENRICHMENT_FAILED providers=${provider}`);
        throw error;
      }
    }

    logger.info('AI_PROVIDER_ATTEMPT provider=gemini');
    try {
      const result = await enrichJobWithGemini(job, mergedDependencies);
      lastSuccessfulProvider = 'gemini';
      logger.info('AI_PROVIDER_SUCCESS provider=gemini');
      return result;
    } catch (geminiError) {
      const reason = classifyGeminiError(geminiError);
      logger.warn(`AI_PROVIDER_FALLBACK from=gemini to=groq reason=${reason}`);
      try {
        logger.info('AI_PROVIDER_ATTEMPT provider=groq');
        const result = await enrichJobWithGroq(job, {
          ...mergedDependencies,
          responseAttempts: 1,
          requireUsableResponse: true,
        });
        lastSuccessfulProvider = 'groq';
        logger.info('AI_PROVIDER_SUCCESS provider=groq');
        return result;
      } catch (groqError) {
        logger.error('AI_ENRICHMENT_FAILED providers=gemini,groq');
        const failure = new Error('AI enrichment failed for providers: gemini,groq');
        failure.cause = groqError;
        if (groqError?.isQuotaError) failure.isQuotaError = true;
        throw failure;
      }
    }
  };

  enrichJob.getLastSuccessfulProvider = () => lastSuccessfulProvider;
  return enrichJob;
}

module.exports = {
  createJobEnricher,
  enrichJobWithGemini,
  enrichJobWithOllama,
  enrichJobWithGroq,
  selectAIProvider,
};
