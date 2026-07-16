import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchPlaces, meta } from './places-overpass.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/overpass-oresund.json', import.meta.url)));
const bbox = { lonMin: 12.44, latMin: 55.82, lonMax: 12.94, latMax: 56.10 };
const query = '[out:json][timeout:25];node["place"~"^(city|town|village)$"](55.82,12.44,56.1,12.94);out body;';
const fakeFetch = async (url, options) => {
  assert.equal(url, 'https://overpass-api.de/api/interpreter');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(options.body, `data=${encodeURIComponent(query)}`);
  return { ok: true, json: async () => fixture };
};

test('normalizes and prioritizes Öresund places from Overpass', async () => {
  const places = await fetchPlaces(bbox, { fetchImpl: fakeFetch });

  assert.ok(places.length >= 6);
  assert.equal(places.length, 12);
  assert.ok(places.some((place) => place.name === 'Helsingborg' && place.kind === 'city'));
  assert.deepEqual(places.map((place) => place.kind), [
    'city',
    'town', 'town', 'town', 'town', 'town', 'town', 'town',
    'village', 'village', 'village', 'village',
  ]);

  for (const kind of ['city', 'town', 'village']) {
    const names = places.filter((place) => place.kind === kind).map((place) => place.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  }

  for (const place of places) {
    const [lat, lon] = place.latLon;
    assert.ok(lat >= bbox.latMin && lat <= bbox.latMax, `${place.name} latitude is inside bbox`);
    assert.ok(lon >= bbox.lonMin && lon <= bbox.lonMax, `${place.name} longitude is inside bbox`);
    assert.ok(['city', 'town', 'village'].includes(place.kind));
  }
});

test('honors a smaller cap after prioritizing by kind and name', async () => {
  const places = await fetchPlaces(bbox, { fetchImpl: fakeFetch, max: 3 });

  assert.deepEqual(
    places.map(({ name, kind }) => ({ name, kind })),
    [
      { name: 'Helsingborg', kind: 'city' },
      { name: 'Bjuv', kind: 'town' },
      { name: 'Helsingør', kind: 'town' },
    ],
  );
});

test('declares OpenStreetMap source metadata', () => {
  assert.deepEqual(Object.keys(meta), ['name', 'coverage', 'license', 'attribution']);
  assert.equal(meta.coverage, 'global');
  assert.match(meta.license, /ODbL/);
  assert.equal(meta.attribution, '© OpenStreetMap contributors');
});
