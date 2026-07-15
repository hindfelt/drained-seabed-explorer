// Terrain heightmap for the Drained Seabed Explorer engine, built from a
// region pack's real bathymetry grid (see src/pack-loader.js for the format).
//
// Real seas are flat as a pancake at true scale, so depths and heights are
// vertically exaggerated for drama — per-pack factors tuned by the generator
// (meta.scale) — then a whisper of seeded fBm is layered on for surface
// texture. Deterministic: same seed → same terrain.
//
// Elevation convention (y): y = 0 is the former waterline. Sea floor is
// negative (the generator's auto-tuning keeps the deepest point near -90
// world units for any region), land positive, clamped to [-100, ceiling].

export const TERRAIN_SIZE = 1200;
export const TERRAIN_RESOLUTION = 512; // grid cells per side → (513)² samples

const DETAIL_AMPLITUDE = 1.5; // ± world units of fBm surface texture
const ELEV_MIN = -100; // safe for all packs: auto-tuned sea min is ≈ -90

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
// Heightmap generation from pack data
// ---------------------------------------------------------------------------

/**
 * Builds the world heightmap from a pack's real elevation grid.
 * @param heightmapData `{ nLat, nLon, bbox, elevations }` from loadRegionPack
 * @param scale `meta.scale` — `{ seaFactor, landFactor, landCeiling }`
 * @returns `{ size, resolution, heights, min, max, getHeightAt, geoToWorld }`
 */
export function createHeightmap(heightmapData, scale, seed = 1337) {
  const { nLat, nLon, bbox, elevations } = heightmapData;
  const { seaFactor, landFactor, landCeiling } = scale;
  const { latMin, latMax, lonMin, lonMax } = bbox;

  const size = TERRAIN_SIZE;
  const resolution = TERRAIN_RESOLUTION;
  const N = resolution + 1;
  const half = size / 2;
  const elevMax = landCeiling + DETAIL_AMPLITUDE;

  // Per-pack geographic frame: bbox → 1200×1200 world (+x east, -z north).
  function geoToWorld(lat, lon) {
    const x = -half + ((lon - lonMin) / (lonMax - lonMin)) * size;
    const z = half - ((lat - latMin) / (latMax - latMin)) * size;
    return [x, z];
  }

  function worldToGeo(x, z) {
    const lon = lonMin + ((x + half) / size) * (lonMax - lonMin);
    const lat = latMin + ((half - z) / size) * (latMax - latMin);
    return [lat, lon];
  }

  // Sample the real elevation grid (meters) at a lat/lon, bilinear, clamped
  // to the grid bounds. Row 0 = latMin (south), col 0 = lonMin (west).
  // NaN-aware, mirroring generator/lib/grid.mjs: nodata corners must not
  // poison the arithmetic (one NaN corner would silently flatten the sample
  // to fabricated sea level), so fall back to the nearest finite corner.
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
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d)) {
      const top = a + (b - a) * tj;
      const bot = c + (d - c) * tj;
      return top + (bot - top) * ti;
    }
    const corners = [
      [a, ti * ti + tj * tj],
      [b, ti * ti + (1 - tj) * (1 - tj)],
      [c, (1 - ti) * (1 - ti) + tj * tj],
      [d, (1 - ti) * (1 - ti) + (1 - tj) * (1 - tj)],
    ];
    let nearest = NaN;
    let nearestDist = Infinity;
    for (const [value, dist] of corners) {
      if (Number.isFinite(value) && dist < nearestDist) {
        nearest = value;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  // Real meters → exaggerated world elevation (before surface detail/clamp).
  // Sea is a straight scale; land is tanh-compressed so ridges roll off
  // smoothly toward the pack's land ceiling (tanh ≈ linear for low coasts,
  // so beaches and towns are essentially unchanged).
  function metersToWorldElevation(m) {
    if (!Number.isFinite(m)) return 0; // packs are fully merged; belt & braces
    if (m < 0) return m * seaFactor;
    return landCeiling * Math.tanh((m * landFactor) / landCeiling);
  }

  // Real meters of horizontal distance → world units (used for shoal radii).
  const metersPerDegreeLat = 111320;
  const bboxMetersNS = (latMax - latMin) * metersPerDegreeLat;
  function metersToWorld(meters) {
    return (meters / bboxMetersNS) * size;
  }

  const rand = mulberry32(seed);
  const { fbm } = makeNoise(rand);

  function elevationAt(x, z) {
    const [lat, lon] = worldToGeo(x, z);
    const base = metersToWorldElevation(sampleMeters(lat, lon));
    const detail = fbm(x * 0.02, z * 0.02, 4) * DETAIL_AMPLITUDE;
    return clamp(base + detail, ELEV_MIN, elevMax);
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

  return { size, resolution, heights, min, max, getHeightAt, geoToWorld, metersToWorld };
}
