'use strict';

const Groq = require('groq-sdk');
const logger = require('../utils/logger');

const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_GROQ_TIMEOUT_MS = 60000;
const DEFAULT_GROQ_MAX_TOKENS = 1600;

// Custom error class for quota exhaustion
class GroqQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GroqQuotaError';
    this.isQuotaError = true;
  }
}

function getGroqModel(options = {}) {
  return process.env.GROQ_MODEL || options.model || DEFAULT_GROQ_MODEL;
}

function getGroqTimeoutMs(options = {}) {
  const configuredTimeout = Number(process.env.GROQ_TIMEOUT || options.timeoutMs || DEFAULT_GROQ_TIMEOUT_MS);
  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    return DEFAULT_GROQ_TIMEOUT_MS;
  }
  return configuredTimeout;
}

function getGroqMaxTokens(options = {}) {
  const configuredMaxTokens = Number(process.env.GROQ_MAX_TOKENS || options.maxTokens || DEFAULT_GROQ_MAX_TOKENS);
  if (!Number.isFinite(configuredMaxTokens) || configuredMaxTokens <= 0) {
    return DEFAULT_GROQ_MAX_TOKENS;
  }
  return configuredMaxTokens;
}

function isQuotaError(error) {
  if (!error) return false;
  const message = (error.message || String(error)).toLowerCase();
  const status = Number(error.status || error.statusCode || 0);
  
  // Check for quota-related patterns
  if (/insufficient_quota|quota.*exceed|quota.*limit/i.test(message)) {
    return true;
  }

  if (status === 429) {
    return true;
  }

  // HTTP 429 (rate limit) or 402 (payment required) or similar
  if (status === 402 || status === 400) {
    if (/rate|limit|quota|retry|too many/i.test(message)) {
      return true;
    }
  }
  
  return false;
}

function isTemporaryError(error) {
  if (!error) return false;
  const message = (error.message || String(error)).toLowerCase();
  const status = error.status || error.statusCode || 0;
  const code = String(error.code || '').toUpperCase();
  
  // Timeouts and temporary server errors
  if (
    ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)
    || /timeout|econnrefused|enotfound|temporarily unavailable|try again|service unavailable/i.test(message)
  ) {
    return true;
  }
  
  // HTTP 5xx errors (server errors, usually temporary)
  if (status >= 500 && status < 600) {
    return true;
  }
  
  // HTTP 408 (request timeout), 429 (rate limit) - but not if it's quota exhaustion
  if ((status === 408 || status === 429) && !isQuotaError(error)) {
    return true;
  }
  
  return false;
}

async function callGroq(prompt, options = {}) {
  const apiKeys = Array.isArray(options.apiKeys)
    ? options.apiKeys.map((apiKey) => String(apiKey || '').trim()).filter(Boolean)
    : ['GROQ_API_KEY', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3', 'GROQ_API_KEY_4']
      .map((name) => String(process.env[name] || '').trim())
      .filter(Boolean);
  const uniqueApiKeys = [...new Set(apiKeys)];
  if (!uniqueApiKeys.length) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  const model = getGroqModel(options);
  const timeoutMs = getGroqTimeoutMs(options);
  let lastError;
  let allErrorsAreQuota = true;

  for (let keyIndex = 0; keyIndex < uniqueApiKeys.length; keyIndex += 1) {
    const apiKey = uniqueApiKeys[keyIndex];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        logger.debug(`AI started via Groq (key ${keyIndex + 1}/${uniqueApiKeys.length}, attempt ${attempt}/2)`);

        const client = (options.createClient || ((config) => new Groq(config)))({
          apiKey,
          timeout: timeoutMs,
        });

        const message = await client.chat.completions.create({
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          model,
          temperature: 0.1,
          max_tokens: getGroqMaxTokens(options),
          reasoning_format: 'hidden',
        });

        const text = message.choices[0]?.message?.content;

        if (typeof text !== 'string' || text.trim() === '') {
          throw new Error('Groq returned an empty response');
        }

        logger.debug(`AI completed via Groq (key ${keyIndex + 1}/${uniqueApiKeys.length})`);
        return text;
      } catch (error) {
        lastError = error;
        const quotaError = isQuotaError(error);
        if (!quotaError) allErrorsAreQuota = false;

        if (isTemporaryError(error) && attempt === 1) {
          logger.warn(`Temporary Groq error for key ${keyIndex + 1}/${uniqueApiKeys.length}; retrying once`);
          continue;
        }

        logger.warn(`Groq key ${keyIndex + 1}/${uniqueApiKeys.length} failed; trying next configured key when available`);
        break;
      }
    }
  }

  if (allErrorsAreQuota && lastError) {
    throw new GroqQuotaError('Groq quota exhausted for all configured API keys');
  }

  if (lastError && /timeout|aborted/i.test(lastError.message || '')) {
    const timeoutError = new Error(`Groq request timed out after trying ${uniqueApiKeys.length} configured API key(s)`);
    timeoutError.isAiTimeout = true;
    timeoutError.cause = lastError;
    throw timeoutError;
  }

  const failure = new Error(`Groq request failed for all ${uniqueApiKeys.length} configured API key(s)`);
  failure.cause = lastError;
  throw failure;
}

module.exports = {
  callGroq,
  GroqQuotaError,
  isQuotaError,
};
