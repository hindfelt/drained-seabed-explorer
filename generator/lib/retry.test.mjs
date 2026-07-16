import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from './retry.mjs';

test('returns the first success without retrying', async () => {
  let calls = 0;
  const result = await withRetry(async () => { calls++; return 'ok'; });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('retries with fixed backoff and succeeds', async () => {
  const delays = [];
  let calls = 0;
  const result = await withRetry(
    async () => { calls++; if (calls < 3) throw new Error(`fail ${calls}`); return 'ok'; },
    { attempts: 3, delayMs: 2000, sleep: async (ms) => delays.push(ms) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test('rethrows the last error after exhausting attempts', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw new Error(`fail ${calls}`); },
      { attempts: 3, sleep: async () => {} }),
    /fail 3/,
  );
  assert.equal(calls, 3);
});
