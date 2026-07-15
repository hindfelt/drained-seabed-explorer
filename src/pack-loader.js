// Region pack loader for the Drained Seabed Explorer engine.
//
// A region pack is a directory under public/packs/<slug>/ holding exactly:
//   meta.json       — name, bbox, grid dims, scale + color-band tuning, credits
//   bathymetry.json — header describing the binary grid
//   bathymetry.bin  — little-endian Int16 decimeters, row-major (row 0 = south)
//   satellite.jpg   — north-up RGB imagery covering exactly the bbox
//   sites.json      — { wrecks, places, shoals } with [lat, lon] WGS84 positions
//
// The loader fetches those, decodes the elevation grid back to meters, and
// hands the engine plain data. All lat/lon → world conversion happens once,
// in convertSites(), using the geoToWorld closure built by createHeightmap.

const NODATA = -32768;

// keep in sync with generator/lib/bathy-codec.mjs
function decodeBathy(buf) {
  const view = new DataView(buf);
  const out = new Float64Array(buf.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    const dm = view.getInt16(i * 2, true);
    out[i] = dm === NODATA ? NaN : dm / 10;
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

/**
 * Loads a region pack. Returns
 *   { meta, heightmapData: { nLat, nLon, bbox, elevations }, sites, satelliteUrl }
 * Throws with a descriptive message when any piece is missing or malformed —
 * main.js turns that into the on-screen boot error.
 */
export async function loadRegionPack(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`invalid region slug "${slug}"`);
  const base = `packs/${slug}`;

  const [meta, header, sites, binRes] = await Promise.all([
    fetchJson(`${base}/meta.json`),
    fetchJson(`${base}/bathymetry.json`),
    fetchJson(`${base}/sites.json`),
    fetch(`${base}/bathymetry.bin`),
  ]);
  if (!binRes.ok) throw new Error(`${binRes.status} for ${base}/bathymetry.bin`);
  const bin = await binRes.arrayBuffer();

  validateHeader(header);
  validateMeta(meta);

  const { nLat, nLon, bbox } = header;
  if (bin.byteLength !== nLat * nLon * 2) {
    throw new Error(
      `bathymetry.bin length ${bin.byteLength} ≠ nLat·nLon·2 = ${nLat * nLon * 2}`
    );
  }

  const elevations = decodeBathy(bin);
  // A pack that is all (or mostly) nodata must fail loudly here — sampling
  // arithmetic downstream would otherwise render plausible-looking terrain
  // out of nothing, which is exactly the kind of quiet fabrication this
  // project refuses to do.
  let nodataCount = 0;
  for (let i = 0; i < elevations.length; i++) {
    if (Number.isNaN(elevations[i])) nodataCount++;
  }
  if (nodataCount / elevations.length > 0.5) {
    throw new Error(
      `bathymetry is ${((nodataCount / elevations.length) * 100).toFixed(0)}% nodata — regenerate the pack`
    );
  }
  if (nodataCount > 0) {
    console.warn(`[pack] ${slug}: ${nodataCount} nodata cells — filling from nearest data`);
  }

  return {
    meta,
    heightmapData: { nLat, nLon, bbox, elevations },
    sites: {
      wrecks: sites.wrecks ?? [],
      places: sites.places ?? [],
      shoals: sites.shoals ?? [],
    },
    satelliteUrl: `${base}/satellite.jpg`,
  };
}

function validateBBox(bbox, label) {
  for (const key of ['latMin', 'latMax', 'lonMin', 'lonMax']) {
    if (!Number.isFinite(bbox?.[key])) throw new Error(`${label}.bbox.${key} is not a finite number`);
  }
  if (bbox.latMin >= bbox.latMax || bbox.lonMin >= bbox.lonMax) {
    throw new Error(`${label}.bbox minima must be less than maxima`);
  }
}

function validateHeader(header) {
  for (const key of ['nLat', 'nLon']) {
    if (!Number.isInteger(header?.[key]) || header[key] < 2) {
      throw new Error(`bathymetry.json ${key} must be an integer ≥ 2`);
    }
  }
  if (header.encoding !== 'int16-decimeters-le') {
    throw new Error(`bathymetry.json encoding "${header.encoding}" is not int16-decimeters-le`);
  }
  validateBBox(header.bbox, 'bathymetry.json');
}

function validateMeta(meta) {
  if (typeof meta?.name !== 'string' || meta.name === '') {
    throw new Error('meta.json name is missing');
  }
  validateBBox(meta.bbox, 'meta.json');
  const { seaFactor, landFactor, landCeiling } = meta.scale ?? {};
  for (const [key, value] of Object.entries({ seaFactor, landFactor, landCeiling })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`meta.json scale.${key} must be a positive finite number`);
    }
  }
}

/** Reads packs/index.json and resolves which slug to boot. */
export async function resolveRegionSlug(search = location.search) {
  const requested = new URLSearchParams(search).get('region');
  if (requested) return requested;
  const index = await fetchJson('packs/index.json');
  return index.default;
}

// ---------------------------------------------------------------------------
// Site conversion — pack records ([lat, lon] WGS84) → marker records ([x, z]).
// ---------------------------------------------------------------------------

// FNV-1a of the site id — the same deterministic idiom markers.js uses for
// its per-wreck rng. No Math.random anywhere.
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function headingFromId(id) {
  return (hashString(String(id)) % 62832) / 10000; // [0, 2π) at 1e-4 resolution
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Converts pack sites into the marker record shapes the scene layer renders.
 * `geoToWorld(lat, lon) → [x, z]` comes from the pack-scaled heightmap, and
 * `metersToWorld` converts real meters to world units for shoal radii.
 */
export function convertSites(sites, geoToWorld, metersToWorld) {
  const wrecks = sites.wrecks.map((w) => ({
    id: w.id,
    name: w.name ?? 'Unknown wreck',
    position: geoToWorld(w.latLon[0], w.latLon[1]),
    heading: headingFromId(w.id),
    length: clamp(w.lengthMeters ?? 28, 15, 50),
    type: w.type,
    sunkYear: w.sunkYear,
    description: w.story ?? w.category,
    approximate: Boolean(w.approximate),
  }));

  const places = sites.places.map((p) => ({
    id: p.id,
    name: p.name,
    position: geoToWorld(p.latLon[0], p.latLon[1]),
    kind: p.kind,
  }));

  const reefs = sites.shoals.map((s, i) => ({
    id: s.id,
    name: s.name ?? `Shoal ${i + 1}`,
    position: geoToWorld(s.latLon[0], s.latLon[1]),
    radius: clamp(metersToWorld(s.radiusMeters ?? 0), 25, 60),
    description:
      `A shoal rising to ${Math.abs(s.crestMeters).toFixed(0)} m below the old ` +
      'waterline, now standing proud of the drained floor around it.',
  }));

  return { reefs, wrecks, places };
}
