'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { runJobPipeline } = require('./scheduler/cron');
const { closeBrowser } = require('./scrapers/browser');

const DEFAULT_LOOP_INTERVAL_MS = 60 * 60 * 1000;
const configuredLoopIntervalMs = Number(process.env.PIPELINE_LOOP_MS || process.env.SCRAPE_INTERVAL_MS);
const LOOP_INTERVAL_MS = Number.isFinite(configuredLoopIntervalMs) && configuredLoopIntervalMs > 0
  ? configuredLoopIntervalMs
  : DEFAULT_LOOP_INTERVAL_MS;

function waitForNextCycle(intervalMs, signal) {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    let timeout;
    const finish = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', finish);
      resolve();
    };

    timeout = setTimeout(finish, intervalMs);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

async function main({
  runPipeline = runJobPipeline,
  closeBrowserFn = closeBrowser,
  waitFn = waitForNextCycle,
  intervalMs = LOOP_INTERVAL_MS,
  signal,
} = {}) {
  let cycle = 0;

  while (!signal?.aborted) {
    cycle += 1;
    const startedAt = process.hrtime.bigint();
    console.log(`SCRAPE_CYCLE_STARTED cycle=${cycle}`);

    try {
      await runPipeline({
        throwOnError: true,
        awaitTimedOutScrapers: true,
        runAiWorker: true,
      });
    } catch (error) {
      console.error(`SCRAPE_CYCLE_FAILED cycle=${cycle}`);
      console.error(error && error.stack ? error.stack : error);
    }

    try {
      await closeBrowserFn();
    } catch (error) {
      console.error('Browser cleanup failed');
      console.error(error && error.stack ? error.stack : error);
    }

    const runtimeMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
    console.log(`SCRAPE_CYCLE_COMPLETED cycle=${cycle}`);
    console.log(`CYCLE_RUNTIME_MS=${runtimeMs}`);
    console.log(`CYCLE_RUNTIME_SECONDS=${(runtimeMs / 1000).toFixed(3)}`);

    if (signal?.aborted) break;
    console.log(`NEXT_SCRAPE_CYCLE_IN_MS=${intervalMs}`);
    try {
      await waitFn(intervalMs, signal);
    } catch (error) {
      console.error('Wait before next scrape cycle failed');
      console.error(error && error.stack ? error.stack : error);
      await waitForNextCycle(intervalMs, signal);
    }
  }

  return 0;
}

if (require.main === module) {
  const controller = new AbortController();
  const stop = () => {
    console.log('Scrape loop stopping after the current cycle');
    controller.abort();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  main({ signal: controller.signal })
    .catch((error) => {
      console.error('Scrape loop failed unexpectedly');
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    })
    .finally(() => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    });
}

module.exports = { main, waitForNextCycle };
