import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJpegSize } from '../adapters/imagery-eox.mjs';
import { buildMeta } from './meta.mjs';

const bbox = { lonMin: 12.44, latMin: 55.82, lonMax: 12.94, latMax: 56.10 };
const exampleSeaFactor = 90 / 50.3;
const exampleP25 = -18.75 / exampleSeaFactor;

function examplePackGrid() {
  return {
    nLat: 2,
    nLon: 5,
    // With linear interpolation at (n - 1) * q, the sea quartiles are
    // p25 = exampleP25, p50 = -10, and p75 = -8.
    elevations: new Float64Array([
      -50.3, -20, exampleP25, -10.2, -10,
      -9, -8, -5, -1, 38.9,
    ]),
  };
}

function assertWithinPercent(actual, expected, percent, label) {
  const tolerance = Math.abs(expected) * percent / 100;
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${actual} to be within ${percent}% of ${expected}`,
  );
}

test('parseJpegSize reads the real SOF dimensions from tiny.jpg', () => {
  const jpeg = readFileSync(new URL('../fixtures/tiny.jpg', import.meta.url));
  assert.deepEqual(parseJpegSize(jpeg), { width: 1, height: 1 });
});

test('buildMeta derives Öresund-like exaggeration and color bands from grid statistics', () => {
  const result = buildMeta({
    name: 'Öresund',
    slug: 'oresund',
    bbox,
    packGrid: examplePackGrid(),
    sources: [],
    now: '2026-07-15',
  });

  assert.equal(result.scale.seaFactor, exampleSeaFactor);
  assert.equal(result.scale.landFactor, exampleSeaFactor / 2);
  assertWithinPercent(result.scale.seaFactor, 1.8, 25, 'seaFactor');
  assertWithinPercent(result.scale.landFactor, 0.9, 25, 'landFactor');
  assert.equal(result.stats.minMeters, -50.3);
  assert.equal(result.stats.maxMeters, 38.9);
  assert.deepEqual(result.stats.seaPercentiles, {
    p25: exampleP25,
    p50: -10,
    p75: -8,
  });

  const reference = {
    landCeiling: 33.5,
    shelfEdge: -22,
    midEdge: -32,
    trenchStart: -55,
    trenchFull: -80,
    saltMin: -25,
    saltMax: -5,
  };
  assertWithinPercent(result.scale.landCeiling, reference.landCeiling, 25, 'landCeiling');
  for (const [key, expected] of Object.entries(reference)) {
    if (key !== 'landCeiling') {
      assertWithinPercent(result.colorBands[key], expected, 25, key);
    }
  }
});

test('buildMeta deduplicates source attributions and honors an injected date', () => {
  const result = buildMeta({
    name: 'Öresund',
    slug: 'oresund',
    bbox,
    packGrid: examplePackGrid(),
    sources: [
      { attribution: 'Bathymetry © Example' },
      { attribution: 'Imagery © Example' },
      { attribution: 'Bathymetry © Example' },
    ],
    now: '2030-02-03',
  });

  assert.deepEqual(result.attributions, ['Bathymetry © Example', 'Imagery © Example']);
  assert.equal(result.generatedAt, '2030-02-03');
});
