import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBathy, decodeBathy } from './bathy-codec.mjs';

test('round-trips meters at decimeter precision', () => {
  const src = [0, -12.34, 55.5, -3276.7, 3276.7];
  const out = decodeBathy(encodeBathy(src));
  assert.equal(out.length, src.length);
  for (let i = 0; i < src.length; i++) assert.ok(Math.abs(out[i] - src[i]) <= 0.05, `i=${i}`);
});

test('NaN survives as NaN via sentinel', () => {
  const out = decodeBathy(encodeBathy([1.5, NaN, -2]));
  assert.ok(Number.isNaN(out[1]));
  assert.equal(out[2], -2);
});

test('clamps out-of-range to int16 bounds', () => {
  const out = decodeBathy(encodeBathy([99999, -99999]));
  assert.ok(out[0] <= 3276.7 && out[1] >= -3276.7);
});
