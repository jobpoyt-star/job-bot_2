'use strict';

const { GoogleGenAI } = require('@google/genai');
const { geminiModel, geminiTimeoutMs } = require('../config/env');

const MAX_ATTEMPTS = 2;
const MIN_REQUEST_INTERVAL_MS = 1000;
const RATE_LIMIT_COOLDOWN_MS = 60000;
const MAX_RETRY_DELAY_MS = 5000;

let nextRequestAt = 0;
let cooldownUntil = 0;
let consecutiveRateLimits = 0;
let requestQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatus(error) {
  return Number(error?.status || error?.statusCode || error?.response?.status || 0);
}

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

function getRetryAfterMs(error, now = Date.now()) {
  const headers = error?.headers || error?.response?.headers;
  const value = getHeader(headers, 'retry-after');
  if (value == null) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(String(value));
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

function classifyGeminiError(error) {
  if (error?.code === 'MISSING_API_KEY') return 'missing_api_key';
  if (error?.code === 'GEMINI_COOLDOWN' || getStatus(error) === 429) return 'rate_limit';
  if (error?.code === 'INVALID_RESPONSE') return 'invalid_response';

  const status = getStatus(error);
  const message = String(error?.message || '').toLowerCase();
  if (error?.code === 'INVALID_ENRICHMENT' || /invalid json|not valid json|unusable .*fields/.test(message)) {
    return 'invalid_response';
  }
  if (error?.isAiTimeout || error?.name === 'AbortError' || /timeout|timed out|deadline exceeded/.test(message)) {
    return 'timeout';
  }
  if (status >= 500 && status < 600) return 'server_error';
  if (status === 408) return 'timeout';
  if (/econnreset|econnrefused|enotfound|network|fetch failed|temporarily unavailable/.test(message)) {
    return 'network_error';
  }
  return 'provider_error';
}

function safeGeminiError(error) {
  const status = getStatus(error);
  const reason = classifyGeminiError(error);
  let message = `Gemini request failed (${reason})`;
  if (status) message = `Gemini request failed with HTTP ${status}`;

  const safeError = new Error(message);
  safeError.status = status || undefined;
  safeError.code = reason === 'missing_api_key' ? 'MISSING_API_KEY' : error?.code;
  safeError.providerReason = reason;
  if (reason === 'timeout') safeError.isAiTimeout = true;
  return safeError;
}

async function paceRequest(options = {}) {
  const now = Date.now();
  if (now < cooldownUntil) {
    const error = new Error('Gemini temporarily rate limited');
    error.code = 'GEMINI_COOLDOWN';
    error.status = 429;
    throw error;
  }

  const requestAt = Math.max(now, nextRequestAt);
  nextRequestAt = requestAt + (options.requestIntervalMs ?? MIN_REQUEST_INTERVAL_MS);
  if (requestAt > now) {
    await (options.sleep || sleep)(requestAt - now);
  }
}

function recordRateLimit(error) {
  consecutiveRateLimits += 1;
  const retryAfterMs = getRetryAfterMs(error);
  if (retryAfterMs !== null) {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + retryAfterMs);
  } else if (consecutiveRateLimits >= 2) {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + RATE_LIMIT_COOLDOWN_MS);
  }
}

async function withRequestLock(action) {
  const previousRequest = requestQueue;
  let releaseRequest;
  requestQueue = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  await previousRequest;

  try {
    return await action();
  } finally {
    releaseRequest();
  }
}

async function callGemini(prompt, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not configured');
    error.code = 'MISSING_API_KEY';
    throw error;
  }

  return withRequestLock(async () => {
    const configuredTimeout = Number(process.env.GEMINI_TIMEOUT || geminiTimeoutMs);
    const jobTimeout = Number(options.timeoutMs);
    const validConfiguredTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 60000;
    const validJobTimeout = Number.isFinite(jobTimeout) && jobTimeout > 0 ? jobTimeout : validConfiguredTimeout;
    const timeoutMs = Math.min(validConfiguredTimeout, validJobTimeout);
    const deadline = Date.now() + timeoutMs;
    const model = options.model || process.env.GEMINI_MODEL || geminiModel;
    const injectedClient = options.client;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await paceRequest(options);
        const remainingTimeoutMs = Math.max(1, deadline - Date.now());
        const client = injectedClient || new GoogleGenAI({
          apiKey,
          httpOptions: {
            timeout: remainingTimeoutMs,
            retryOptions: {
              attempts: 1,
              httpStatusCodes: [],
              jitter: 0,
            },
          },
        });
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: { temperature: 0 },
        });
        const text = response?.text;
        if (typeof text !== 'string' || text.trim() === '') {
          const error = new Error('Gemini returned an empty response');
          error.code = 'INVALID_RESPONSE';
          throw error;
        }

        consecutiveRateLimits = 0;
        return text;
      } catch (error) {
        const status = getStatus(error);
        if (status === 429) {
          if (error?.code !== 'GEMINI_COOLDOWN') recordRateLimit(error);
          throw safeGeminiError(error);
        }

        const reason = classifyGeminiError(error);
        const retryable = reason === 'timeout' || reason === 'network_error' || reason === 'server_error';
        if (retryable && attempt < MAX_ATTEMPTS) {
          const exponentialDelayMs = Math.min(MAX_RETRY_DELAY_MS, 500 * (2 ** (attempt - 1)));
          const jitterMs = Math.floor((options.random || Math.random)() * 250);
          await (options.sleep || sleep)(exponentialDelayMs + jitterMs);
          continue;
        }

        throw safeGeminiError(error);
      }
    }

    throw new Error('Gemini request failed');
  });
}

function resetGeminiRateLimitState() {
  nextRequestAt = 0;
  cooldownUntil = 0;
  consecutiveRateLimits = 0;
  requestQueue = Promise.resolve();
}

module.exports = {
  callGemini,
  classifyGeminiError,
  getRetryAfterMs,
  resetGeminiRateLimitState,
};
