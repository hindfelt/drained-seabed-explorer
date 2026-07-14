// Terrain for the Drained Seabed Explorer, built from REAL open bathymetry of
// the northern Öresund (EMODnet Bathymetry DTM 2024 for the sea floor, merged
// with GEBCO 2020 for land and gaps — see build in bathymetry.json `source`).
//
// The real sound is only ~0–45 m deep over ~31 km — flat as a pancake at true
// scale — so depths and heights are vertically exaggerated for drama, then a
// whisper of seeded fBm is layered on for surface texture. Deterministic: same
// seed → same terrain. Only two imports: the bathymetry grid and the geo frame.
//
// Elevation convention (y): y = 0 is the former waterline. Sea floor is negative
// (down to ~-90 in the deep north), land positive (Swedish/Danish coasts and Ven
// island), clamped to [-100, +35].

import bathymetry from './bathymetry.json' with { type: 'json' };
import { TERRAIN_SIZE, worldToGeo, geoToWorld } from './geo.js';

export { TERRAIN_SIZE, geoToWorld };
export const TERRAIN_RESOLUTION = 512; // grid cells per side → (513)² samples

// Vertical exaggeration (world units per metre) and surface-detail amplitude.
export const SEA_EXAGGERATION = 1.8; // -50 m → -90 units
export const LAND_EXAGGERATION = 0.9; // world units per metre of land, before tanh compression
const DETAIL_AMPLITUDE = 1.5; // ± world units of fBm surface texture
const ELEV_MIN = -100;
const ELEV_MAX = 35;
// Land is smoothly compressed toward this ceiling with tanh instead of a hard
// clamp, so inland ridges (Glumslöv/Rydebäck ~40–90 m) keep visible relief
// rather than flattening into a slab at +35. Kept a touch below ELEV_MAX so the
// fBm detail on the highest ridges never re-creates a clamp plateau.
const LAND_CEILING = 33.5;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(rand) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function latticeValue(ix, iz) {
    return perm[(perm[ix & 255] + (iz & 255)) & 255] / 255;
  }
  function valueNoise(x, z) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fz = z - z0;
    const u = fx * fx * (3 - 2 * fx);
    const v = fz * fz * (3 - 2 * fz);
    const v00 = latticeValue(x0, z0);
    const v10 = latticeValue(x0 + 1, z0);
    const v01 = latticeValue(x0, z0 + 1);
    const v11 = latticeValue(x0 + 1, z0 + 1);
    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
  }
  function fbm(x, z, octaves) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * (valueNoise(x * freq, z * freq) * 2 - 1);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
  return { fbm };
}

// ---------------------------------------------------------------------------
// Bathymetry sampling (bilinear over the real grid, in metres)
// ---------------------------------------------------------------------------

const { latMin, latMax, lonMin, lonMax, nLat, nLon, elevations } = bathymetry;

// Sample the real elevation grid (metres) at a lat/lon, bilinear, clamped to
// the grid bounds. Row 0 = latMin (south), col 0 = lonMin (west), ascending.
function sampleMeters(lat, lon) {
  const fLat =
    ((clamp(lat, latMin, latMax) - latMin) / (latMax - latMin)) * (nLat - 1);
  const fLon =
    ((clamp(lon, lonMin, lonMax) - lonMin) / (lonMax - lonMin)) * (nLon - 1);
  let i = Math.floor(fLat);
  let j = Math.floor(fLon);
  if (i >= nLat - 1) i = nLat - 2;
  if (j >= nLon - 1) j = nLon - 2;
  if (i < 0) i = 0;
  if (j < 0) j = 0;
  const ti = fLat - i;
  const tj = fLon - j;
  const a = elevations[i * nLon + j];
  const b = elevations[i * nLon + j + 1];
  const c = elevations[(i + 1) * nLon + j];
  const d = elevations[(i + 1) * nLon + j + 1];
  const top = a + (b - a) * tj;
  const bot = c + (d - c) * tj;
  return top + (bot - top) * ti;
}

// Real metres → exaggerated world elevation (before surface detail / clamp).
// Sea is a straight scale; land is tanh-compressed so ridges roll off smoothly
// toward LAND_CEILING (tanh ≈ linear for the low beaches, coasts and towns, so
// those elevations are essentially unchanged).
function metersToWorld(m) {
  if (m < 0) return m * SEA_EXAGGERATION;
  return LAND_CEILING * Math.tanh((m * LAND_EXAGGERATION) / LAND_CEILING);
}

// ---------------------------------------------------------------------------
// Heightmap generation
// ---------------------------------------------------------------------------

export function generateHeightmap(seed = 1337) {
  const size = TERRAIN_SIZE;
  const resolution = TERRAIN_RESOLUTION;
  const N = resolution + 1;
  const half = size / 2;

  const rand = mulberry32(seed);
  const { fbm } = makeNoise(rand);

  function elevationAt(x, z) {
    const [lat, lon] = worldToGeo(x, z);
    const base = metersToWorld(sampleMeters(lat, lon));
    const detail = fbm(x * 0.02, z * 0.02, 4) * DETAIL_AMPLITUDE;
    return clamp(base + detail, ELEV_MIN, ELEV_MAX);
  }

  const heights = new Float32Array(N * N);
  let min = Infinity;
  let max = -Infinity;

  for (let iz = 0; iz < N; iz++) {
    const z = -half + (iz / resolution) * size;
    for (let ix = 0; ix < N; ix++) {
      const x = -half + (ix / resolution) * size;
      heights[iz * N + ix] = elevationAt(x, z);
      const y = heights[iz * N + ix];
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }

  function getHeightAt(x, z) {
    const cx = clamp(x, -half, half);
    const cz = clamp(z, -half, half);
    const gx = ((cx + half) / size) * resolution;
    const gz = ((cz + half) / size) * resolution;
    let ix = Math.floor(gx);
    let iz = Math.floor(gz);
    if (ix >= resolution) ix = resolution - 1;
    if (iz >= resolution) iz = resolution - 1;
    if (ix < 0) ix = 0;
    if (iz < 0) iz = 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = heights[iz * N + ix];
    const h10 = heights[iz * N + ix + 1];
    const h01 = heights[(iz + 1) * N + ix];
    const h11 = heights[(iz + 1) * N + ix + 1];
    const a = h00 + (h10 - h00) * fx;
    const b = h01 + (h11 - h01) * fx;
    return a + (b - a) * fz;
  }

  return { size, resolution, heights, min, max, getHeightAt };
}
