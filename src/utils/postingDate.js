'use strict';

const UNIX_SECONDS_THRESHOLD = 1e11;

function parsePostingDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < UNIX_SECONDS_THRESHOLD ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== 'string' || !value.trim()) return null;

  const normalizedValue = value.trim();
  if (/^[+-]?\d+(?:\.\d+)?$/.test(normalizedValue)) {
    const timestamp = Number(normalizedValue);
    if (!Number.isFinite(timestamp)) return null;
    const milliseconds = Math.abs(timestamp) < UNIX_SECONDS_THRESHOLD ? timestamp * 1000 : timestamp;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePostingDate(value) {
  const date = parsePostingDate(value);
  return date ? date.toISOString() : null;
}

function classifyPostingDate(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return 'missing';
  return parsePostingDate(value) ? 'valid' : 'invalid';
}

module.exports = {
  parsePostingDate,
  normalizePostingDate,
  classifyPostingDate,
};
