'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyPostingDate,
  normalizePostingDate,
  parsePostingDate,
} = require('../src/utils/postingDate');
const { isJobWithinConfiguredLookback } = require('../src/database/jobRepository');

test('normalizes millisecond and second Unix timestamps to ISO-8601', () => {
  const timestampMs = 1791495234748;
  const timestampSeconds = Math.floor(timestampMs / 1000);

  assert.equal(normalizePostingDate(timestampMs), new Date(timestampMs).toISOString());
  assert.equal(normalizePostingDate(timestampSeconds), new Date(timestampSeconds * 1000).toISOString());
  assert.equal(normalizePostingDate(String(timestampMs)), new Date(timestampMs).toISOString());
});

test('normalizes ISO strings and Date values, and classifies invalid or missing inputs', () => {
  const iso = '2026-10-09T12:34:56.000Z';
  assert.equal(normalizePostingDate(iso), iso);
  assert.equal(normalizePostingDate(new Date(iso)), iso);
  assert.equal(normalizePostingDate('not-a-date'), null);
  assert.equal(normalizePostingDate(null), null);
  assert.equal(classifyPostingDate('not-a-date'), 'invalid');
  assert.equal(classifyPostingDate(''), 'missing');
  assert.equal(parsePostingDate('not-a-date'), null);
});

test('enforces the inclusive configured lookback boundary and rejects future dates', () => {
  const now = new Date('2026-10-11T12:00:00.000Z');
  const cutoff = now.getTime() - (3 * 24 * 60 * 60 * 1000);

  assert.equal(isJobWithinConfiguredLookback({ posted_date: cutoff }, 3, now), true);
  assert.equal(isJobWithinConfiguredLookback({ posted_date: cutoff - 1 }, 3, now), false);
  assert.equal(isJobWithinConfiguredLookback({ posted_date: now.getTime() + 1 }, 3, now), false);
  assert.equal(isJobWithinConfiguredLookback({ posted_date: null }, 3, now), true);
  assert.equal(isJobWithinConfiguredLookback({ posted_date: 'invalid' }, 3, now), true);
});

test('compares Unix timestamps in seconds and milliseconds as the same posting date', () => {
  const timestampMs = 1791495234748;
  const now = new Date('2026-10-12T00:00:00.000Z');
  const oldTimestampMs = Date.parse('2026-09-01T00:00:00.000Z');

  for (const timestamp of [timestampMs, String(timestampMs), Math.floor(timestampMs / 1000), String(Math.floor(timestampMs / 1000))]) {
    assert.equal(isJobWithinConfiguredLookback({ posted_date: timestamp }, 30, now), true);
  }

  for (const timestamp of [oldTimestampMs, String(oldTimestampMs), Math.floor(oldTimestampMs / 1000), String(Math.floor(oldTimestampMs / 1000))]) {
    assert.equal(isJobWithinConfiguredLookback({ posted_date: timestamp }, 30, now), false);
  }
});
