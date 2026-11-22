// Terrain generator for the Drained Seabed Explorer.
// Supports both the bundled high-detail northern Öresund bathymetry grid AND
// dynamically fetched bathymetry grids for any region picked on the World Map.

import defaultBathymetry from './bathymetry.json' with { type: 'json' };
import { TERRAIN_SIZE, DEFAULT_BBOX, createGeoProjection, worldToGeo, geoToWorld } from './geo.js';

export { TERRAIN_SIZE, geoToWorld, worldToGeo, createGeoProjection };
export const TERRAIN_RESOLUTION = 512; // grid cells per side → (513)² samples

// Default Öresund vertical exaggeration (world units per metre)
export const SEA_EXAGGERATION = 2.15;
export const LAND_EXAGGERATION = 1.25;
const ELEV_MIN = -124;
const ELEV_MAX = 48;
const DEFAULT_LAND_CEILING = 45;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
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
      freq *= 2.04;
    }
    return sum / norm;
  }

  function ridged(x, z, octaves) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(valueNoise(x * freq, z * freq) * 2 - 1);
      const r = n * n * weight;
      weight = clamp(r * 1.6, 0.25, 1);
      sum += r * amp;
      norm += amp;
      amp *= 0.48;
      freq *= 2.12;
    }
    return sum / norm;
  }

  return { fbm, ridged };
}

/**
 * Builds a sculpted 512×512 heightmap from any bathymetry grid + scale config.
 */
export function generateHeightmapFromGrid(bathyGrid, options = {}) {
  const {
    seaExaggeration = SEA_EXAGGERATION,
    landExaggeration = LAND_EXAGGERATION,
    landCeiling = DEFAULT_LAND_CEILING,
    seed = 1337,
  } = options;

  const { latMin, latMax, lonMin, lonMax, nLat, nLon, elevations } = bathyGrid;
  const bbox = { latMin, latMax, lonMin, lonMax };
  const projection = createGeoProjection(bbox);

  const size = TERRAIN_SIZE;
  const resolution = TERRAIN_RESOLUTION;
  const N = resolution + 1;
  const half = size / 2;

  function sampleMeters(lat, lon) {
    const fLat = ((clamp(lat, latMin, latMax) - latMin) / (latMax - latMin || 1)) * (nLat - 1);
    const fLon = ((clamp(lon, lonMin, lonMax) - lonMin) / (lonMax - lonMin || 1)) * (nLon - 1);
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

  function metersToWorld(m) {
    if (m < 0) return m * seaExaggeration;
    return landCeiling * Math.tanh((m * landExaggeration) / landCeiling);
  }

  const rand = mulberry32(seed);
  const { fbm, ridged } = makeNoise(rand);

  const baseHeights = new Float32Array(N * N);
  let minMeters = Infinity;
  let maxMeters = -Infinity;

  for (let iz = 0; iz < N; iz++) {
    const z = -half + (iz / resolution) * size;
    for (let ix = 0; ix < N; ix++) {
      const x = -half + (ix / resolution) * size;
      const [lat, lon] = projection.worldToGeo(x, z);
      const m = sampleMeters(lat, lon);
      if (m < minMeters) minMeters = m;
      if (m > maxMeters) maxMeters = m;
      baseHeights[iz * N + ix] = metersToWorld(m);
    }
  }

  const heights = new Float32Array(N * N);
  let min = Infinity;
  let max = -Infinity;
  const step = size / resolution;

  for (let iz = 0; iz < N; iz++) {
    const z = -half + (iz / resolution) * size;
    const izPrev = iz > 0 ? iz - 1 : 0;
    const izNext = iz < resolution ? iz + 1 : resolution;

    for (let ix = 0; ix < N; ix++) {
      const x = -half + (ix / resolution) * size;
      const ixPrev = ix > 0 ? ix - 1 : 0;
      const ixNext = ix < resolution ? ix + 1 : resolution;

      const base = baseHeights[iz * N + ix];

      const dhdx = (baseHeights[iz * N + ixNext] - baseHeights[iz * N + ixPrev]) / (2 * step);
      const dhdz = (baseHeights[izNext * N + ix] - baseHeights[izPrev * N + ix]) / (2 * step);
      const slopeMag = Math.hypot(dhdx, dhdz);

      const steepness = smoothstep(0.14, 0.72, slopeMag);
      const landFactor = smoothstep(-2, 6, base);
      const ridgeBoost = Math.max(steepness, landFactor * 0.48);

      const crag = (ridged(x * 0.018, z * 0.018, 4) - 0.42) * (2.6 + ridgeBoost * 9.5);
      const fineRock = fbm(x * 0.055, z * 0.055, 3) * (1.25 + steepness * 3.4);

      const terraceStep = 5.4;
      const phase = (base + crag * 0.35) / terraceStep;
      const frac = phase - Math.floor(phase);
      const terraceDelta = (smoothstep(0.18, 0.82, frac) - frac) * terraceStep * 0.52 * steepness;

      const flowWarp = fbm(x * 0.012, z * 0.012, 2) * 24;
      const flowGroove = Math.sin((x + flowWarp) * 0.16) * 0.65 * (1 - landFactor) * (1 - steepness * 0.7);

      const y = clamp(base + crag + fineRock + terraceDelta + flowGroove, ELEV_MIN, ELEV_MAX);
      heights[iz * N + ix] = y;
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

  function getMetersAt(x, z) {
    const [lat, lon] = projection.worldToGeo(clamp(x, -half, half), clamp(z, -half, half));
    return sampleMeters(lat, lon);
  }

  return {
    size,
    resolution,
    heights,
    min,
    max,
    minMeters,
    maxMeters,
    seaExaggeration,
    landExaggeration,
    bbox,
    widthKm: projection.widthKm,
    heightKm: projection.heightKm,
    geoToWorld: projection.geoToWorld,
    worldToGeo: projection.worldToGeo,
    getHeightAt,
    getMetersAt,
  };
}

export function generateHeightmap(seed = 1337) {
  return generateHeightmapFromGrid(defaultBathymetry, {
    seaExaggeration: SEA_EXAGGERATION,
    landExaggeration: LAND_EXAGGERATION,
    landCeiling: DEFAULT_LAND_CEILING,
    seed,
  });
}
