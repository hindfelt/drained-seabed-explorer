# Seabed Studio P0 — Engine/Pack Split + Automated Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-off Öresund app into an engine that renders any "region pack", plus a zero-dependency CLI that generates packs for any bbox on Earth from open data — proven by regenerating the Öresund automatically and generating two regions we've never touched.

**Architecture:** The repo splits into an unchanged-looking runtime (`src/`, boots from `public/packs/<slug>/` chosen by `?region=` query param) and a new `generator/` (Node ≥ 20, zero npm deps, adapters-per-source, `node:test` suite with recorded fixtures — tests never hit the network). A region pack is 4 files: `meta.json`, `bathymetry.json` + `bathymetry.bin` (Int16 decimeters), `satellite.jpg`, `sites.json` (all positions in WGS84; the engine converts once at boot).

**Tech Stack:** Three.js + Vite (runtime, unchanged deps); Node ≥ 20 built-ins only for the generator (`fetch`, `node:test`, `node:fs`); data sources: GEBCO via ERDDAP, EMODnet DTM (Europe refinement), EOX Sentinel-2 WMS, UKHO global wrecks via EMODnet WFS `emodnet:wwshipwrecks`, OSM Overpass.

## Global Constraints

- Runtime dependencies stay exactly `three` + `vite`. Generator adds **zero** npm dependencies.
- No `Math.random()` anywhere; all seeding deterministic (existing convention).
- Generator tests use fixtures + injectable fetch; `npm test` must pass offline.
- Every adapter carries `{ name, coverage, license, attribution }` metadata; `meta.json` aggregates attributions of sources actually used.
- Never fabricate coordinates: sites without charted positions get `approximate: true` (existing ≈ rendering).
- All positions in pack files are `[lat, lon]` WGS84. World mapping: `x = lerp(-600, 600, (lon-lonMin)/(lonMax-lonMin))`, `z = lerp(600, -600, (lat-latMin)/(latMax-latMin))`.
- Bathymetry binary: little-endian Int16, row-major (row 0 = latMin/south, col 0 = lonMin/west), value = elevation in **decimeters** (m × 10); sentinel `-32768` = no data.
- Preserve hard-won engine behaviors: tanh land compression, wrecks cast-but-never-receive shadows, world-position satellite UVs, graceful missing-asset fallbacks.
- Commit after every task with the session footer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_012gL3S24522yASJzpPugttE`

**Verified endpoints (live-tested this week — copy exactly):**
- GEBCO grid: `https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020.json?elevation[(LAT_MIN):(LAT_MAX)][(LON_MIN):(LON_MAX)]`
- EMODnet DTM: `https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024.json?elevation[(LAT_MIN):(LAT_MAX)][(LON_MIN):(LON_MAX)]` (NaN on land)
- EOX imagery: `https://tiles.maps.eox.at/wms?service=WMS&request=GetMap&version=1.1.1&layers=s2cloudless-2023&bbox={lonMin},{latMin},{lonMax},{latMax}&srs=EPSG:4326&width=4096&height=4096&format=image/jpeg`
- UKHO wrecks: `https://ows.emodnet-humanactivities.eu/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&typeNames=emodnet:wwshipwrecks&outputFormat=application/json&bbox={lonMin},{latMin},{lonMax},{latMax},EPSG:4326&count=500` (lon,lat order; returned 39 features for the Öresund window)
- Overpass places: POST `https://overpass-api.de/api/interpreter` body `[out:json][timeout:25];node["place"~"^(city|town|village)$"]({latMin},{lonMin},{latMax},{lonMax});out body;`

---

### Task 1: Test runner + bathymetry binary codec

**Files:**
- Create: `generator/lib/bathy-codec.mjs`
- Test: `generator/lib/bathy-codec.test.mjs`
- Modify: `package.json` (add `"test": "node --test generator/"` to scripts)

**Interfaces:**
- Produces: `encodeBathy(elevations: number[] /* meters, NaN allowed */): Buffer` and `decodeBathy(buf: ArrayBuffer|Buffer): Float64Array /* meters, NaN for nodata */`. Int16 decimeters, `-32768` = NaN sentinel. Later tasks (pack assembly Task 7, engine loader Task 8) rely on these exact names.

- [ ] **Step 1: Write the failing test**

```js
// generator/lib/bathy-codec.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBathy, decodeBathy } from './bathy-codec.mjs';

test('round-trips meters at decimeter precision', () => {
  const src = [0, -12.34, 55.5, -3276.8, 3276.7];
  const out = decodeBathy(encodeBathy(src));
  assert.equal(out.length, src.length);
  for (let i = 0; i < src.length; i++) assert.ok(Math.abs(out[i] - src[i]) <= 0.05, `i=${i}`);
});

test('NaN survives as NaN via sentinel', () => {
  const out = decodeBathy(encodeBathy([1.5, NaN, -2]));
  assert.ok(Number.isNaN(out[1]));
  assert.equal(out[2], -2);
});

test('clamps out-of-range to int16 bounds', () => {
  const out = decodeBathy(encodeBathy([99999, -99999]));
  assert.ok(out[0] <= 3276.7 && out[1] >= -3276.7);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module ... bathy-codec.mjs`

- [ ] **Step 3: Write minimal implementation**

```js
// generator/lib/bathy-codec.mjs
const NODATA = -32768;

export function encodeBathy(elevations) {
  const out = new Int16Array(elevations.length);
  for (let i = 0; i < elevations.length; i++) {
    const m = elevations[i];
    out[i] = Number.isFinite(m)
      ? Math.max(-32767, Math.min(32767, Math.round(m * 10)))
      : NODATA;
  }
  return Buffer.from(out.buffer);
}

export function decodeBathy(buf) {
  const view = new Int16Array(buf.buffer ?? buf, buf.byteOffset ?? 0, (buf.byteLength ?? buf.length) / 2);
  const out = new Float64Array(view.length);
  for (let i = 0; i < view.length; i++) out[i] = view[i] === NODATA ? NaN : view[i] / 10;
  return out;
}
```

- [ ] **Step 4: Run tests, verify pass** — `npm test` → 3 pass.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(generator): bathymetry Int16 codec + node:test runner"` (+ footer).

---

### Task 2: GEBCO + EMODnet grid adapters (injectable fetch, fixtures)

**Files:**
- Create: `generator/adapters/bathy-gebco.mjs`, `generator/adapters/bathy-emodnet.mjs`, `generator/lib/erddap.mjs`
- Create: `generator/fixtures/gebco-oresund-mini.json` (record once: run the ERDDAP GEBCO URL for a *tiny* window `[(55.90):(55.94)][(12.60):(12.66)]`, save verbatim)
- Test: `generator/adapters/bathy-gebco.test.mjs`

**Interfaces:**
- Produces: each adapter exports `meta = { name, coverage: 'global'|'europe', license, attribution }` and `async fetchGrid(bbox, { fetchImpl = fetch } = {})` → `{ lats: number[], lons: number[], elevations: Float64Array /* row-major, meters, NaN = nodata */ }`. `bbox = { lonMin, latMin, lonMax, latMax }`. Task 3 (merge) and Task 7 (CLI) consume this exact shape.
- ERDDAP response shape (both endpoints): `{ table: { columnNames: ["time"?, "latitude","longitude","elevation"], rows: [[lat, lon, elev], ...] } }` — `generator/lib/erddap.mjs` exports `parseErddapGrid(json)` → the fetchGrid return shape (dedupe/sort unique lats and lons ascending, fill row-major grid, missing cells NaN).

- [ ] **Step 1: Record the fixture** — `curl -s "https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020.json?elevation[(55.90):(55.94)][(12.60):(12.66)]" -o generator/fixtures/gebco-oresund-mini.json` and eyeball it parses.
- [ ] **Step 2: Write the failing test**

```js
// generator/adapters/bathy-gebco.test.mjs
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
```

- [ ] **Step 3: Run to verify fail**, then **Step 4: implement**

```js
// generator/lib/erddap.mjs
export function parseErddapGrid(json) {
  const { columnNames, rows } = json.table;
  const iLat = columnNames.indexOf('latitude');
  const iLon = columnNames.indexOf('longitude');
  const iEl = columnNames.indexOf('elevation');
  const lats = [...new Set(rows.map((r) => r[iLat]))].sort((a, b) => a - b);
  const lons = [...new Set(rows.map((r) => r[iLon]))].sort((a, b) => a - b);
  const latIdx = new Map(lats.map((v, i) => [v, i]));
  const lonIdx = new Map(lons.map((v, i) => [v, i]));
  const elevations = new Float64Array(lats.length * lons.length).fill(NaN);
  for (const r of rows) {
    const el = r[iEl];
    elevations[latIdx.get(r[iLat]) * lons.length + lonIdx.get(r[iLon])] =
      el == null ? NaN : el;
  }
  return { lats, lons, elevations };
}

export async function fetchErddapGrid(datasetUrl, bbox, fetchImpl) {
  const url = `${datasetUrl}.json?elevation[(${bbox.latMin}):(${bbox.latMax})][(${bbox.lonMin}):(${bbox.lonMax})]`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`ERDDAP ${res.status ?? 'error'} for ${url}`);
  return parseErddapGrid(await res.json());
}
```

```js
// generator/adapters/bathy-gebco.mjs
import { fetchErddapGrid } from '../lib/erddap.mjs';

export const meta = {
  name: 'gebco-2020',
  coverage: 'global',
  license: 'GEBCO grid — free to use',
  attribution: 'Bathymetry © GEBCO Compilation Group',
};

export async function fetchGrid(bbox, { fetchImpl = fetch } = {}) {
  return fetchErddapGrid('https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020', bbox, fetchImpl);
}
```

`generator/adapters/bathy-emodnet.mjs` is identical in shape with `datasetUrl = 'https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024'`, `meta = { name: 'emodnet-dtm-2024', coverage: 'europe', license: 'EMODnet — free reuse with attribution', attribution: 'Bathymetry © EMODnet Bathymetry Consortium' }`, plus `export function covers(bbox) { return bbox.latMin > 25 && bbox.latMax < 73 && bbox.lonMin > -36 && bbox.lonMax < 43; }`.

- [ ] **Step 5: Run tests pass, commit** — `feat(generator): GEBCO + EMODnet grid adapters with ERDDAP parser`.

---

### Task 3: Grid merge + resample onto pack grid

**Files:**
- Create: `generator/lib/grid.mjs`
- Test: `generator/lib/grid.test.mjs`

**Interfaces:**
- Produces: `sampleGrid(grid, lat, lon): number` (bilinear over `{lats,lons,elevations}`, NaN-aware: if any corner NaN, nearest finite corner; NaN if all NaN); `mergeToPackGrid({ fine, coarse, bbox, nLat = 256, nLon = 256 })` → `{ nLat, nLon, elevations: Float64Array }` — regular grid over bbox, per cell: fine value if finite (sea detail), else coarse (land + gaps), mirroring the proven Öresund merge. Task 7 consumes.

- [ ] **Step 1: Failing tests** (synthetic 3×3 grids — deterministic, no fixtures)

```js
// generator/lib/grid.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleGrid, mergeToPackGrid } from './grid.mjs';

const flat = (v) => ({ lats: [0, 1, 2], lons: [0, 1, 2], elevations: new Float64Array(9).fill(v) });

test('bilinear sample of a constant grid is the constant', () => {
  assert.ok(Math.abs(sampleGrid(flat(-7), 0.5, 1.5) - -7) < 1e-9);
});

test('NaN corners fall back to nearest finite', () => {
  const g = flat(-5); g.elevations[4] = NaN; // center cell
  assert.ok(Number.isFinite(sampleGrid(g, 1.01, 1.01)));
});

test('merge prefers fine where finite, coarse elsewhere', () => {
  const fine = flat(-20); fine.elevations.fill(NaN, 0, 5);   // half nodata (land in EMODnet)
  const coarse = flat(10);
  const bbox = { lonMin: 0, latMin: 0, lonMax: 2, latMax: 2 };
  const m = mergeToPackGrid({ fine, coarse, bbox, nLat: 8, nLon: 8 });
  const vals = [...m.elevations];
  assert.ok(vals.includes(-20) && vals.includes(10));
  assert.ok(vals.every(Number.isFinite));
});
```

- [ ] **Step 2: fail → implement.** `sampleGrid`: binary-search bracketing indices in `lats`/`lons`, clamp to edges, bilinear with the NaN fallback described. `mergeToPackGrid`: double loop over the regular lat/lon lattice (`lat = latMin + (latMax-latMin) * i/(nLat-1)`), `const f = sampleGrid(fine, lat, lon); out[i*nLon+j] = Number.isFinite(f) ? f : sampleGrid(coarse, lat, lon);`. If `fine` is null (no regional adapter covers the bbox) use coarse only.
- [ ] **Step 3: pass, commit** — `feat(generator): NaN-aware bilinear sampling and fine/coarse grid merge`.

---

### Task 4: UKHO wrecks adapter (WFS → normalized sites)

**Files:**
- Create: `generator/adapters/wrecks-emodnet.mjs`
- Create: `generator/fixtures/wwshipwrecks-oresund.json` (record once: the verified WFS GET for the Öresund bbox, `count=200`)
- Test: `generator/adapters/wrecks-emodnet.test.mjs`

**Interfaces:**
- Produces: `meta` (attribution: 'Wrecks © UK Hydrographic Office via EMODnet Human Activities, OGL') and `async fetchWrecks(bbox, { fetchImpl = fetch, max = 60 } = {})` → array of
  `{ id: string, name: string|null, latLon: [lat, lon], type: string|null, sunkYear: number|null, depthMeters: number|null, lengthMeters: number|null, category: string, story: string|null, approximate: boolean }`.
  Rules: geometry coordinates are `[lon, lat]` → flip; `approximate = true` when `position_m` (position method) is missing/'n/a' or quality fields indicate unsurveyed; `sunkYear` parsed from `date_sunk` (`/\b(1[5-9]\d\d|20\d\d)\b/`); `story` from `circumstan` when non-empty; if more than `max` wrecks, keep named ones first, then deepest — and record `dropped` count on the returned array as `result.dropped`. Task 7 consumes.

- [ ] **Step 1: Record fixture** — `curl -s "https://ows.emodnet-humanactivities.eu/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&typeNames=emodnet:wwshipwrecks&outputFormat=application/json&bbox=12.44,55.82,12.94,56.10,EPSG:4326&count=200" -o generator/fixtures/wwshipwrecks-oresund.json`
- [ ] **Step 2: Failing test**

```js
// generator/adapters/wrecks-emodnet.test.mjs
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
});

test('caps to max, preferring named wrecks, and reports dropped', async () => {
  const w = await fetchWrecks(bbox, { fetchImpl: fakeFetch, max: 10 });
  assert.equal(w.length, 10);
  assert.equal(w.dropped, 29);
});
```

- [ ] **Step 3: fail → implement** (straight mapping over `features`; note `numberMatched` may exceed `count` — if so, log it; P0 accepts the first page).
- [ ] **Step 4: pass, commit** — `feat(generator): UKHO global wrecks adapter (EMODnet WFS)`.

---

### Task 5: Places (Overpass) + shoal detection

**Files:**
- Create: `generator/adapters/places-overpass.mjs`, `generator/lib/shoals.mjs`
- Create: `generator/fixtures/overpass-oresund.json` (record once: the Overpass POST for the Öresund bbox)
- Test: `generator/adapters/places-overpass.test.mjs`, `generator/lib/shoals.test.mjs`

**Interfaces:**
- Produces: `fetchPlaces(bbox, { fetchImpl = fetch, max = 12 } = {})` → `[{ id, name, latLon: [lat,lon], kind: 'city'|'town'|'village' }]`, capped by kind priority city > town > village then alphabetical. `findShoals(packGrid, bbox, { count = 4, minProminence = 5 } = {})` → `[{ id, name: null, latLon, crestMeters, radiusMeters }]` — local maxima among sea cells (elevation < 0) that stand ≥ `minProminence` m above the mean of their 5-cell ring, non-overlapping (min separation 8 cells), sorted shallowest-first. Task 7 consumes both.

- [ ] **Step 1: Record fixture** — `curl -s -X POST https://overpass-api.de/api/interpreter --data-urlencode 'data=[out:json][timeout:25];node["place"~"^(city|town|village)$"](55.82,12.44,56.10,12.94);out body;' -o generator/fixtures/overpass-oresund.json`
- [ ] **Step 2: Failing tests** — places: fixture must yield Helsingborg (city) and ≥ 6 places, all inside bbox, kinds valid. Shoals: build a synthetic 32×32 grid, all −30 m, plant two bumps (−4 m crest, radius 2 cells) and one land blob (+5) → expect exactly the two sea bumps found, land excluded, shallowest first.
- [ ] **Step 3: fail → implement.** Overpass: POST with `fetchImpl`, map `elements` (`{ id: 'place-'+el.id, name: el.tags.name, latLon: [el.lat, el.lon], kind: el.tags.place }`), drop unnamed, cap. Shoals: two-pass — collect candidate maxima, then greedy pick by crest with separation constraint; `radiusMeters` = cells-above-(crest−prominence/2) × cell size.
- [ ] **Step 4: pass, commit** — `feat(generator): Overpass places adapter and grid-based shoal detection`.

---

### Task 6: Imagery adapter + meta assembly (auto-exaggeration, color bands)

**Files:**
- Create: `generator/adapters/imagery-eox.mjs` (move/adapt logic from `scripts/build-satellite.mjs`), `generator/lib/meta.mjs`
- Test: `generator/lib/meta.test.mjs` (imagery adapter is thin I/O; JPEG SOF-dimension parsing gets a unit test with a 1×1 fixture jpg committed as `generator/fixtures/tiny.jpg`)

**Interfaces:**
- Produces: `fetchImagery(bbox, { fetchImpl = fetch, size = 4096 } = {})` → `{ jpeg: Buffer, width, height, source, attribution }` (EOX first, Esri export fallback, JPEG magic + SOF check as in the existing script). `buildMeta({ name, slug, bbox, packGrid, sources })` → the pack `meta.json` object:

```json
{
  "name": "Öresund", "slug": "oresund",
  "bbox": { "lonMin": 12.44, "latMin": 55.82, "lonMax": 12.94, "latMax": 56.10 },
  "grid": { "nLat": 256, "nLon": 256 },
  "scale": { "seaFactor": 1.8, "landFactor": 0.9, "landCeiling": 33.5 },
  "colorBands": { "shelfEdge": -22, "midEdge": -32, "trenchStart": -55, "trenchFull": -80, "saltMin": -25, "saltMax": -5 },
  "stats": { "minMeters": -50.3, "maxMeters": 38.9, "seaPercentiles": { "p25": -9.1, "p50": -18.2, "p75": -30.5 } },
  "attributions": ["Bathymetry © GEBCO…", "…"],
  "generatedAt": "2026-07-15"
}
```

  Rules under test: `seaFactor = min(3.5, 90 / max(10, |minMeters|))`; `landFactor = seaFactor / 2`; band edges from sea-depth percentiles **in world units** (`shelfEdge = p50·seaFactor` clamped to [−30, −12], `trenchStart = p75·seaFactor·1.4` clamped ≤ −45, `saltMin/saltMax` bracket `[p25, p25/3]·seaFactor`) — this generalizes the hand-tuned Öresund values and must reproduce them within ±25% when fed the real Öresund grid stats.
- [ ] **Steps: failing tests → implement → pass → commit** — `feat(generator): imagery adapter + pack meta with auto exaggeration and color bands`.

---

### Task 7: Pack assembler CLI

**Files:**
- Create: `generator/cli.mjs`, `generator/lib/pack.mjs`
- Test: `generator/lib/pack.test.mjs`
- Modify: `package.json` scripts: `"generate": "node generator/cli.mjs"`

**Interfaces:**
- Consumes: everything above.
- Produces: `assemblePack({ bbox, name, slug, adapters, fetchImpl })` → writes `public/packs/<slug>/{meta.json,bathymetry.json,bathymetry.bin,satellite.jpg,sites.json}` and returns a report `{ wreckCount, placeCount, shoalCount, minMeters, maxMeters, warnings: string[] }`. `validatePack(dir)` → throws with a precise message on any structural problem (missing file, bin length ≠ nLat·nLon·2, site outside bbox, non-finite meta numbers). CLI: `npm run generate -- --bbox 12.44,55.82,12.94,56.10 --name "Öresund" --slug oresund` prints the report and exits non-zero on validation failure. `sites.json` shape: `{ "wrecks": [...Task-4 records], "places": [...Task-5], "shoals": [...Task-5] }`.
- `bathymetry.json` (header next to the bin): `{ "nLat": 256, "nLon": 256, "bbox": {...}, "encoding": "int16-decimeters-le", "nodata": -32768 }`.

- [ ] **Step 1: Failing test** — `assemblePack` with all-fake fetchers (reusing the fixtures) into a temp dir: assert all 5 files exist, `validatePack` passes, report counts match fixtures (39 wrecks pre-cap), then corrupt `bathymetry.bin` by truncating 2 bytes and assert `validatePack` throws `/bin length/`.
- [ ] **Step 2: fail → implement.** Warnings the assembler must emit (test at least the first): no regional bathy adapter covers bbox → `"bathymetry is GEBCO-only (~450 m) — small features will be smooth"`; zero wrecks → `"no charted wrecks in this area"`; imagery fallback used.
- [ ] **Step 3: pass, commit** — `feat(generator): pack assembler CLI with validation and report`.

---

### Task 8: Engine boots from a region pack

**Files:**
- Create: `src/pack-loader.js`
- Modify: `src/main.js` (async boot from pack), `src/data/heightmap.js` (accept data instead of importing JSON), `src/data/sites.js` → **delete**; `src/materials/terrainMaterial.js` (band edges from meta), `src/scene/markers.js` (import sites from loader-provided arrays instead of `../data/sites.js`), `src/ui/overlay.js` (title/subtitle from meta)
- Test: `generator/lib/pack.test.mjs` already covers pack integrity; engine change is verified by the browser gate in Task 9 (no test framework exists for the runtime — do not add one in P0).

**Interfaces:**
- Produces: `loadRegionPack(slug)` → `{ meta, heightmapData: { nLat, nLon, bbox, elevations: Float64Array }, sites: { wrecks, places, shoals }, satelliteUrl }` — fetches `packs/<slug>/…` (packs live in `public/`, so dev + build both serve them), decodes the bin with a **copy of the codec's decode function** (10 lines, keep runtime dep-free; add the comment `// keep in sync with generator/lib/bathy-codec.mjs`).
- `createHeightmap(heightmapData, scale)` replaces `generateHeightmap()`: same returned contract `{ size: 1200, resolution: 512, heights, min, max, getHeightAt, geoToWorld }`, built by bilinear-sampling `elevations` onto the 513² world lattice and applying `seaFactor` / tanh(`landFactor`, `landCeiling`) from `meta.scale`. The fBm detail layer (±1.5) and all downstream consumers stay unchanged.
- Slug selection in `main.js`: `const slug = new URLSearchParams(location.search).get('region') ?? (await fetch('packs/index.json').then(r => r.json())).default;` — `packs/index.json` is written by the CLI (`{ "default": "oresund", "packs": ["oresund", …] }`).
- Sites conversion at boot: `latLon` → `position: [x, z]` via `geoToWorld`; wrecks map to the existing marker record shape (`{ id, name, position, heading: deterministicFromId, length: clamp(lengthMeters ?? 28, 15, 50), type, sunkYear, description: story ?? category, approximate }`).

- [ ] **Step 1:** Write `pack-loader.js` + refactors (single sitting — the pieces are interdependent).
- [ ] **Step 2:** `npx vite build` → must complete clean.
- [ ] **Step 3:** Commit — `refactor(engine): boot from region packs; delete hardcoded Öresund data`.

---

### Task 9: Regenerate the Öresund automatically — parity gate

**Files:**
- Create: `public/packs/oresund/` (generated, committed)
- Modify: `README.md` (generate + region-switch instructions)

- [ ] **Step 1:** `npm run generate -- --bbox 12.44,55.82,12.94,56.10 --name "Öresund" --slug oresund` — report should show ~39 wrecks, warnings empty (EMODnet covers).
- [ ] **Step 2: Browser gate (manual/scripted via the `window.__viz` hook):** `npm run dev`, open `?region=oresund` — zero console errors; land on both coasts + Ven present; wrecks render with labels & ≈ flags; toggles + water cycle work; satellite orientation correct (Ven's fields on Ven). Screenshot for the record.
- [ ] **Step 3:** Delete the now-redundant `scripts/build-bathymetry.mjs`, `scripts/build-satellite.mjs`, `src/data/bathymetry.json`, `src/assets/satellite-land.jpg` (their logic lives in adapters; the old committed assets are superseded by the pack). `npx vite build` still clean.
- [ ] **Step 4:** Commit — `feat: Öresund as the first generated region pack`.

---

### Task 10: Two novel regions — the generalization proof

**Files:**
- Create: `public/packs/geiranger/`, `public/packs/bora-bora/` (generated)
- Create: `docs/P0-FINDINGS.md`

- [ ] **Step 1:** `npm run generate -- --bbox 6.95,62.05,7.35,62.25 --name "Geirangerfjord" --slug geiranger` (deep narrow fjord: stresses exaggeration auto-tuning + steep coasts; EMODnet covers).
- [ ] **Step 2:** `npm run generate -- --bbox -151.85,-16.60,-151.65,-16.42 --name "Bora Bora" --slug bora-bora` (tropical atoll: GEBCO-only warning expected, sparse wrecks, tiny land — stresses the opposite regime).
- [ ] **Step 3:** Browser gate on each (`?region=geiranger`, `?region=bora-bora`): boots clean, terrain plausible, auto color bands sane, honest warnings surfaced in the credits line. Screenshots.
- [ ] **Step 4:** Write `docs/P0-FINDINGS.md`: what auto-tuning got right/wrong per region, GEBCO-only quality verdict, list of P1 adjustments. Commit + push everything — `feat: Geirangerfjord + Bora Bora packs; P0 findings`.

---

## After P0 (separate plans, written when P0's findings are in)

- **P1 — Web generator**: MapLibre bbox picker, live data-availability panel, server pipeline (Cloudflare Worker + R2 cache) reusing `generator/` unchanged, zip download.
- **P2 — Offline packaging**: single-file HTML build (inline runtime + base64 pack), PWA variant, self-hosted font subset, automated screenshot QA.

## Self-review notes

- Spec coverage: engine split (T8), pack format (T1/T7), all five adapters (T2/T4/T5/T6), auto-tuning (T6), validation + honesty warnings (T7), proof regions (T9/T10). UI generator + offline packaging intentionally out of P0 scope (separate plans).
- Type consistency: `bbox` object shape, `fetchGrid`/`fetchWrecks`/`fetchPlaces` signatures, pack file names, and `meta.json` keys are used identically across T2–T8.
- The one deliberate duplication: the 10-line bin decoder exists in both generator and runtime to keep the runtime dependency-free — marked with sync comments on both sides.
