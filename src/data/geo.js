// Geographic reference frame for the Drained Seabed Explorer.
//
// The scene models a real window of the northern Öresund (WGS84):
//   lat 55.82 .. 56.10   (north),  lon 12.44 .. 12.94  (east)
// mapped onto a 1200×1200 world (XZ plane, centered at origin) with
//   +x = east, -z = north  (so higher latitude → smaller z).
// At ~56°N this window is ≈31×31 km — near square — so we treat it as exact.
//
// Shared by heightmap.js (terrain) and sites.js (site coordinates); it imports
// nothing, so there is no dependency cycle.

export const TERRAIN_SIZE = 1200;

export const LON_MIN = 12.44;
export const LON_MAX = 12.94;
export const LAT_MIN = 55.82;
export const LAT_MAX = 56.1;

// Real (lat, lon) → world [x, z].
export function geoToWorld(lat, lon) {
  const half = TERRAIN_SIZE / 2;
  const x = -half + ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * TERRAIN_SIZE;
  const z = half - ((lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * TERRAIN_SIZE;
  return [x, z];
}

// World [x, z] → real [lat, lon] (inverse of geoToWorld).
export function worldToGeo(x, z) {
  const half = TERRAIN_SIZE / 2;
  const lon = LON_MIN + ((x + half) / TERRAIN_SIZE) * (LON_MAX - LON_MIN);
  const lat = LAT_MIN + ((half - z) / TERRAIN_SIZE) * (LAT_MAX - LAT_MIN);
  return [lat, lon];
}
