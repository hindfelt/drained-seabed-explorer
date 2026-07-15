import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleGrid, mergeToPackGrid } from './grid.mjs';

const flat = (v) => ({ lats: [0, 1, 2], lons: [0, 1, 2], elevations: new Float64Array(9).fill(v) });

test('bilinear sample of a constant grid is the constant', () => {
  assert.ok(Math.abs(sampleGrid(flat(-7), 0.5, 1.5) - -7) < 1e-9);
});

test('NaN corners fall back to nearest finite', () => {
  const g = flat(-5); g.elevations[4] = NaN; // center cell
  assert.ok(Number.isFinite(sampleGrid(g, 1.01, 1.01)));
});

test('merge prefers fine where finite, coarse elsewhere', () => {
  const fine = flat(-20); fine.elevations.fill(NaN, 0, 5);   // half nodata (land in EMODnet)
  const coarse = flat(10);
  const bbox = { lonMin: 0, latMin: 0, lonMax: 2, latMax: 2 };
  const m = mergeToPackGrid({ fine, coarse, bbox, nLat: 8, nLon: 8 });
  const vals = [...m.elevations];
  assert.ok(vals.includes(-20) && vals.includes(10));
  assert.ok(vals.every(Number.isFinite));
});
