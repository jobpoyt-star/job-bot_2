const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../src/runPipeline');

test('local runner repeats complete cycles after waiting and awaits cleanup each time', async () => {
  const output = [];
  const originalLog = console.log;
  const originalError = console.error;
  const controller = new AbortController();
  let pipelineCalls = 0;
  let cleanupCalls = 0;
  const waits = [];

  console.log = (message) => output.push(String(message));
  console.error = (message) => output.push(String(message));

  try {
    const exitCode = await main({
      runPipeline: async (options) => {
        pipelineCalls += 1;
        assert.deepEqual(options, {
          throwOnError: true,
          awaitTimedOutScrapers: true,
          runAiWorker: true,
        });
      },
      closeBrowserFn: async () => {
        cleanupCalls += 1;
      },
      waitFn: async (intervalMs) => {
        waits.push(intervalMs);
        if (waits.length === 2) controller.abort();
      },
      intervalMs: 60 * 60 * 1000,
      signal: controller.signal,
    });

    assert.equal(exitCode, 0);
    assert.equal(pipelineCalls, 2);
    assert.equal(cleanupCalls, 2);
    assert.deepEqual(waits, [60 * 60 * 1000, 60 * 60 * 1000]);
    assert.ok(output.includes('SCRAPE_CYCLE_STARTED cycle=1'));
    assert.ok(output.includes('SCRAPE_CYCLE_COMPLETED cycle=2'));
    assert.ok(output.includes(`NEXT_SCRAPE_CYCLE_IN_MS=${60 * 60 * 1000}`));
    assert.ok(output.some((line) => /^CYCLE_RUNTIME_MS=\d+$/.test(line)));
    assert.ok(output.some((line) => /^CYCLE_RUNTIME_SECONDS=\d+\.\d{3}$/.test(line)));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test('local runner reports a failed cycle and continues after the interval', async () => {
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  const controller = new AbortController();
  let pipelineCalls = 0;
  let cleanupCalls = 0;

  console.log = () => {};
  console.error = (message) => errors.push(String(message));

  try {
    const exitCode = await main({
      runPipeline: async () => {
        pipelineCalls += 1;
        if (pipelineCalls === 1) throw new Error('pipeline failed');
      },
      closeBrowserFn: async () => {
        cleanupCalls += 1;
      },
      waitFn: async () => {
        if (pipelineCalls === 2) controller.abort();
      },
      signal: controller.signal,
    });

    assert.equal(exitCode, 0);
    assert.equal(pipelineCalls, 2);
    assert.equal(cleanupCalls, 2);
    assert.ok(errors.includes('SCRAPE_CYCLE_FAILED cycle=1'));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});
