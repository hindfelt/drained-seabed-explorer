import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchWrecks } from './wrecks-emodnet.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/wwshipwrecks-oresund.json', import.meta.url)));
const fakeFetch = async (url) => {
  assert.match(String(url), /typeNames=emodnet:wwshipwrecks/);
  assert.match(String(url), /bbox=12\.44,55\.82,12\.94,56\.1,EPSG:4326/);
  return { ok: true, json: async () => fixture };
};
const bbox = { lonMin: 12.44, latMin: 55.82, lonMax: 12.94, latMax: 56.10 };

test('normalizes the 39 Öresund wrecks', async () => {
  const w = await fetchWrecks(bbox, { fetchImpl: fakeFetch });
  assert.equal(w.length, 39);
  for (const x of w) {
    assert.ok(x.id && Array.isArray(x.latLon));
    assert.ok(x.latLon[0] > 55.8 && x.latLon[0] < 56.11, 'lat in range (coords flipped)');
    assert.equal(typeof x.approximate, 'boolean');
  }
  // Only the whole-minute position fixes are estimates; decimal-minute
  // charted positions must NOT be hedged with ≈ (position_m is 'n/a' for
  // every feature in this dataset and carries no signal).
  assert.equal(w.filter((x) => x.approximate).length, 4);
});

test('caps to max, preferring named wrecks, and reports dropped', async () => {
  const w = await fetchWrecks(bbox, { fetchImpl: fakeFetch, max: 10 });
  assert.equal(w.length, 10);
  assert.equal(w.dropped, 29);
});
