'use strict';

const { defaultRetentionDays } = require('../config/env');
const { parsePostingDate } = require('./postingDate');

function parsePostedDate(postedDate) {
  return parsePostingDate(postedDate);
}

function isRecentJob(postedDate, days) {
  const retentionDays = Number(days);
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    return true;
  }

  if (postedDate === null || postedDate === undefined || postedDate === '') {
    return true;
  }

  if (typeof postedDate === 'string' && !postedDate.trim()) {
    return true;
  }

  const parsedDate = parsePostedDate(postedDate);
  if (!parsedDate) {
    return true;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return parsedDate >= cutoff;
}

function filterRecentJobs(jobs, days) {
  const inputJobs = Array.isArray(jobs) ? jobs : [];
  const retentionDays = Number(days);
  const effectiveDays = Number.isFinite(retentionDays) && retentionDays >= 0 ? retentionDays : defaultRetentionDays;

  return inputJobs.filter((job) => {
    const postedDate = job?.posted_date ?? job?.postedDate ?? null;
    return isRecentJob(postedDate, effectiveDays);
  });
}

module.exports = {
  parsePostedDate,
  isRecentJob,
  filterRecentJobs,
};
