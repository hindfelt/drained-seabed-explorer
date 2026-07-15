import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchGrid, meta } from './bathy-gebco.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/gebco-oresund-mini.json', import.meta.url)));
const fakeFetch = async (url) => {
  assert.match(String(url), /GEBCO_2020\.json\?elevation\[\(55\.9\):\(55\.94\)\]\[\(12\.6\):\(12\.66\)\]/);
  return { ok: true, json: async () => fixture };
};

test('parses ERDDAP grid into sorted lats/lons + row-major elevations', async () => {
  const g = await fetchGrid({ lonMin: 12.60, latMin: 55.90, lonMax: 12.66, latMax: 55.94 }, { fetchImpl: fakeFetch });
  assert.ok(g.lats.length >= 5 && g.lons.length >= 5);
  assert.ok(g.lats.every((v, i) => i === 0 || v > g.lats[i - 1]), 'lats ascending');
  assert.equal(g.elevations.length, g.lats.length * g.lons.length);
  const mid = g.elevations[Math.floor(g.elevations.length / 2)];
  assert.ok(Number.isFinite(mid) && mid < 0, 'mid-strait is below sea level');
});

test('declares source metadata', () => {
  assert.equal(meta.coverage, 'global');
  assert.ok(meta.attribution.includes('GEBCO'));
});
