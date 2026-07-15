import test from 'node:test';
import assert from 'node:assert/strict';
import { findShoals } from './shoals.mjs';

const nLat = 32;
const nLon = 32;
const bbox = { lonMin: 12, latMin: 55, lonMax: 12.31, latMax: 55.31 };

function plantBump(elevations, centerRow, centerCol, crest) {
  for (let rowOffset = -2; rowOffset <= 2; rowOffset++) {
    for (let colOffset = -2; colOffset <= 2; colOffset++) {
      const distance = Math.max(Math.abs(rowOffset), Math.abs(colOffset));
      const elevation = distance === 0 ? crest : distance === 1 ? -13 : -22;
      elevations[(centerRow + rowOffset) * nLon + centerCol + colOffset] = elevation;
    }
  }
}

function expectedLatLon(row, col) {
  return [
    bbox.latMin + (bbox.latMax - bbox.latMin) * row / (nLat - 1),
    bbox.lonMin + (bbox.lonMax - bbox.lonMin) * col / (nLon - 1),
  ];
}

test('finds separated underwater shoals and excludes land', () => {
  const elevations = new Float64Array(nLat * nLon).fill(-30);
  plantBump(elevations, 8, 8, -4);
  plantBump(elevations, 23, 22, -4);

  plantBump(elevations, 15, 27, 5);

  const shoals = findShoals(
    { nLat, nLon, elevations },
    bbox,
    { count: 4, minProminence: 5 },
  );

  assert.equal(shoals.length, 2);
  assert.deepEqual(shoals.map((shoal) => shoal.crestMeters), [-4, -4]);
  assert.deepEqual(shoals.map((shoal) => shoal.latLon), [expectedLatLon(8, 8), expectedLatLon(23, 22)]);
  assert.ok(shoals.every((shoal) => shoal.crestMeters < 0));
  assert.ok(shoals.every((shoal) => shoal.radiusMeters > 0));
});

test('selects shallowest-first and suppresses crests less than eight cells apart', () => {
  const elevations = new Float64Array(nLat * nLon).fill(-30);
  plantBump(elevations, 12, 12, -4);
  plantBump(elevations, 12, 18, -6);
  plantBump(elevations, 24, 24, -8);

  const shoals = findShoals({ nLat, nLon, elevations }, bbox, { count: 4 });

  assert.deepEqual(shoals.map((shoal) => shoal.crestMeters), [-4, -8]);
});
