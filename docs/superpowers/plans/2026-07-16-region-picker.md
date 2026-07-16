# Region Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A map-based picker page (`generate.html`) where the user drags a rectangle on a world map and generates a region pack via a dev-only Vite endpoint, plus a region dropdown in the main app.

**Architecture:** Zero-dep slippy map (OSM raster tiles, hand-rolled Web Mercator math) on a second Vite page; a `configureServer` plugin exposes `POST /api/generate` in dev only, streaming NDJSON progress from the existing `assemblePack`; shared validation/index modules extracted from the CLI so both entry points use identical logic.

**Tech Stack:** Vite multi-page build; Node ≥ 20 built-ins only for generator code; no runtime test framework for browser code (browser gate instead).

**Spec:** `docs/superpowers/specs/2026-07-16-region-picker-design.md`

## Global Constraints

- `package.json` dependencies stay exactly `three` + `vite`. No new npm packages anywhere.
- No `Math.random()`; retry backoff is fixed (2 s, 4 s).
- Generator tests run offline: `npm test` (`node --test 'generator/**/*.test.mjs'`).
- The dev API exists ONLY under `vite dev` (`configureServer`); production builds must not contain it.
- OSM tile usage: include "© OpenStreetMap contributors" attribution on the map; tiles from `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- Commit after every task with the session footer.

---

### Task 1: Retry helper + wire into places fetch

**Files:**
- Create: `generator/lib/retry.mjs`
- Test: `generator/lib/retry.test.mjs`
- Modify: `generator/lib/pack.mjs` (places fetch gets retries)

**Interfaces:**
- Produces: `withRetry(fn, { attempts = 3, delayMs = 2000, sleep = defaultSleep } = {})` → Promise of `fn()`'s result; retries on rejection with fixed backoff `delayMs * attempt` (2 s, 4 s); rethrows the last error after all attempts. `sleep` is injectable so tests never wait.

- [ ] **Step 1: Write the failing test**

```js
// generator/lib/retry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from './retry.mjs';

test('returns the first success without retrying', async () => {
  let calls = 0;
  const result = await withRetry(async () => { calls++; return 'ok'; });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('retries with fixed backoff and succeeds', async () => {
  const delays = [];
  let calls = 0;
  const result = await withRetry(
    async () => { calls++; if (calls < 3) throw new Error(`fail ${calls}`); return 'ok'; },
    { attempts: 3, delayMs: 2000, sleep: async (ms) => delays.push(ms) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test('rethrows the last error after exhausting attempts', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw new Error(`fail ${calls}`); },
      { attempts: 3, sleep: async () => {} }),
    /fail 3/,
  );
  assert.equal(calls, 3);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → `Cannot find module ... retry.mjs`.
- [ ] **Step 3: Implement**

```js
// generator/lib/retry.mjs
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry(fn, { attempts = 3, delayMs = 2000, sleep = defaultSleep } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Wire into pack.mjs.** In `assemblePack`, change the places promise (currently `fetchOptionalSites(() => selected.places.fetchPlaces(bbox, { fetchImpl }), 'places', warnings)`) to:

```js
  const placesPromise = fetchOptionalSites(
    () => withRetry(() => selected.places.fetchPlaces(bbox, { fetchImpl })),
    'places',
    warnings,
  );
```

with `import { withRetry } from './retry.mjs';` at the top. The existing pack test's fixture fetch never rejects, so behavior is unchanged there.

- [ ] **Step 5: `npm test` → all pass. Commit** — `feat(generator): fixed-backoff retry for flaky Overpass places`.

---

### Task 2: Extract shared bbox/slug validation from the CLI

**Files:**
- Create: `generator/lib/bbox-args.mjs`
- Test: `generator/lib/bbox-args.test.mjs`
- Modify: `generator/cli.mjs` (delete its inline `parseBbox` and slug regex; import the shared module)

**Interfaces:**
- Produces: `parseBbox(value: string)` → `{ lonMin, latMin, lonMax, latMax }`, throws `Error` with a user-readable message on any invalid input (not 4 parts, non-finite, out of WGS84 range, min ≥ max). `validateSlug(slug: string)` → returns the slug, throws on anything not matching `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. `validateName(name: string)` → returns trimmed name, throws if empty.

- [ ] **Step 1: Failing test**

```js
// generator/lib/bbox-args.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBbox, validateSlug, validateName } from './bbox-args.mjs';

test('parses a valid bbox string', () => {
  assert.deepEqual(parseBbox('12.44,55.82,12.94,56.10'),
    { lonMin: 12.44, latMin: 55.82, lonMax: 12.94, latMax: 56.10 });
});

test('rejects malformed bboxes with readable messages', () => {
  assert.throws(() => parseBbox('1,2,3'), /lonMin,latMin,lonMax,latMax/);
  assert.throws(() => parseBbox('a,b,c,d'), /finite/);
  assert.throws(() => parseBbox('-181,0,0,1'), /WGS84/);
  assert.throws(() => parseBbox('1,1,1,2'), /minima/);
});

test('validates slugs and names', () => {
  assert.equal(validateSlug('bora-bora'), 'bora-bora');
  assert.throws(() => validateSlug('Bora Bora'), /lowercase/);
  assert.throws(() => validateSlug('-x'), /lowercase/);
  assert.equal(validateName('  Öresund '), 'Öresund');
  assert.throws(() => validateName('  '), /empty/);
});
```

- [ ] **Step 2: fail → implement.** Move the CLI's existing logic verbatim into the module (same messages, plus the new exports):

```js
// generator/lib/bbox-args.mjs
export function parseBbox(value) {
  const parts = String(value).split(',');
  if (parts.length !== 4) throw new Error('bbox must be lonMin,latMin,lonMax,latMax');
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) throw new Error('bbox coordinates must be finite numbers');
  const [lonMin, latMin, lonMax, latMax] = numbers;
  if (lonMin < -180 || lonMax > 180 || latMin < -90 || latMax > 90) {
    throw new Error('bbox coordinates must be within WGS84 longitude/latitude ranges');
  }
  if (lonMin >= lonMax || latMin >= latMax) throw new Error('bbox minima must be less than maxima');
  return { lonMin, latMin, lonMax, latMax };
}

export function validateSlug(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug ?? ''))) {
    throw new Error('slug must contain only lowercase letters, numbers, and single hyphens');
  }
  return slug;
}

export function validateName(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length === 0) throw new Error('name must not be empty');
  return trimmed;
}
```

- [ ] **Step 3: Update cli.mjs** to `import { parseBbox, validateSlug, validateName } from './lib/bbox-args.mjs';`, delete its inline `parseBbox` function, and in `parseArgs` replace the name/slug/bbox blocks with:

```js
  const name = validateName(values.get('name'));
  const slug = validateSlug(values.get('slug'));
  const bbox = parseBbox(values.get('bbox'));
  return { bbox, name, slug };
```

- [ ] **Step 4: `npm test` pass; smoke `npm run generate -- --help` prints usage. Commit** — `refactor(generator): shared bbox/slug/name validation module`.

---

### Task 3: Extract updatePackIndex into a shared module

**Files:**
- Create: `generator/lib/pack-index.mjs`
- Test: `generator/lib/pack-index.test.mjs`
- Modify: `generator/cli.mjs` (delete inline `updatePackIndex`, import shared)

**Interfaces:**
- Produces: `updatePackIndex(packsDir: string, slug: string)` → Promise<void>; creates `packsDir` if needed; writes `index.json` `{ default, packs }` preserving an existing default, sorted slugs, deduped. Behavior identical to the current CLI implementation (move it verbatim).

- [ ] **Step 1: Failing test**

```js
// generator/lib/pack-index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updatePackIndex } from './pack-index.mjs';

async function readIndex(dir) {
  return JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
}

test('creates a fresh index with the first slug as default', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'packs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await updatePackIndex(dir, 'oresund');
  assert.deepEqual(await readIndex(dir), { default: 'oresund', packs: ['oresund'] });
});

test('adds slugs sorted and preserves the existing default', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'packs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await updatePackIndex(dir, 'oresund');
  await updatePackIndex(dir, 'bora-bora');
  assert.deepEqual(await readIndex(dir), { default: 'oresund', packs: ['bora-bora', 'oresund'] });
});

test('rejects a corrupt index instead of clobbering it', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'packs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'index.json'), '[]');
  await assert.rejects(() => updatePackIndex(dir, 'x'), /JSON object/);
});
```

- [ ] **Step 2: fail → implement** by moving the CLI's `updatePackIndex` function verbatim into `generator/lib/pack-index.mjs` (exported), with its `mkdir/readFile/writeFile` imports. Update `cli.mjs` to `import { updatePackIndex } from './lib/pack-index.mjs';` and delete the inline copy.
- [ ] **Step 3: `npm test` pass. Commit** — `refactor(generator): shared pack index module`.

---

### Task 4: assemblePack progress callback

**Files:**
- Modify: `generator/lib/pack.mjs`
- Test: extend `generator/lib/pack.test.mjs`

**Interfaces:**
- Produces: `assemblePack({ ..., onProgress = () => {} })` — called with stage strings, in order: `'bathymetry'`, `'wrecks'`, `'places'`, `'imagery'` (each fired when that fetch RESOLVES, so order can vary between the four), then always `'assembling'` and `'validating'` before their phases. Existing callers unaffected.

- [ ] **Step 1: Extend the pack test** — in the existing fixture-backed test, pass a collector and assert:

```js
  const stages = [];
  // add to the assemblePack options object in the existing test:
  //   onProgress: (stage) => stages.push(stage),
  // and after the report assertions:
  assert.deepEqual([...stages].sort(), ['assembling', 'bathymetry', 'imagery', 'places', 'validating', 'wrecks']);
  assert.ok(stages.indexOf('assembling') > stages.indexOf('bathymetry'));
  assert.equal(stages[stages.length - 1], 'validating');
```

- [ ] **Step 2: fail → implement.** In `assemblePack`, add `onProgress = () => {}` to the destructured options. Tag each fetch promise: `coarsePromise.then((v) => { onProgress('bathymetry'); return v; })` — wrap coarse (bathymetry), wrecks, places, imagery promises this way (fine shares the bathymetry stage; do not tag it). After the `Promise.all`, call `onProgress('assembling')` before the merge/write block, and `onProgress('validating')` right before `await validatePack(outDir)`.
- [ ] **Step 3: `npm test` pass. Commit** — `feat(generator): assemblePack progress callback`.

---

### Task 5: Dev API Vite plugin + vite.config.js

**Files:**
- Create: `generator/dev-api.mjs`
- Create: `vite.config.js`
- Test: `generator/dev-api.test.mjs`

**Interfaces:**
- Produces: `devGenerateApi()` → Vite plugin `{ name: 'dev-generate-api', configureServer(server) }`. Also exports `handleGenerate(req, res, { assemble, updateIndex, cwd })` (dependency-injected for tests) implementing: JSON body parse → validate (`bbox-args.mjs`) → 400 on invalid; 409 if a generation is already running; otherwise stream NDJSON lines `{"stage":...}` per progress event, then `{"done":true,"report":{...}}` or `{"error":"message"}`; always `updateIndex` after success.
- Consumes: `assemblePack` (Task 4 signature), `updatePackIndex` (Task 3), `parseBbox`/`validateSlug`/`validateName` (Task 2).

- [ ] **Step 1: Failing test** (mock req/res with streams — no Vite needed)

```js
// generator/dev-api.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { handleGenerate, __resetBusyForTests } from './dev-api.mjs';

function makeReq(body) {
  const req = new PassThrough();
  req.method = 'POST';
  req.end(JSON.stringify(body));
  return req;
}

function makeRes() {
  const chunks = [];
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    write(c) { chunks.push(String(c)); },
    end(c) { if (c) chunks.push(String(c)); this.ended = true; },
    lines() { return chunks.join('').trim().split('\n').map((l) => JSON.parse(l)); },
  };
}

const goodBody = { bbox: { lonMin: 1, latMin: 1, lonMax: 2, latMax: 2 }, name: 'X', slug: 'x' };

test('streams stages then a final report', async () => {
  __resetBusyForTests();
  const res = makeRes();
  await handleGenerate(makeReq(goodBody), res, {
    assemble: async ({ onProgress }) => { onProgress('bathymetry'); onProgress('validating'); return { wreckCount: 1, warnings: [] }; },
    updateIndex: async () => {},
    cwd: '/tmp',
  });
  const lines = res.lines();
  assert.deepEqual(lines[0], { stage: 'bathymetry' });
  assert.equal(lines.at(-1).done, true);
  assert.equal(lines.at(-1).report.wreckCount, 1);
});

test('rejects invalid slugs with 400 before generating', async () => {
  __resetBusyForTests();
  const res = makeRes();
  await handleGenerate(makeReq({ ...goodBody, slug: 'Bad Slug' }), res, {
    assemble: async () => { throw new Error('must not be called'); },
    updateIndex: async () => {},
    cwd: '/tmp',
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.lines()[0].error, /lowercase/);
});

test('streams an error line when generation throws', async () => {
  __resetBusyForTests();
  const res = makeRes();
  await handleGenerate(makeReq(goodBody), res, {
    assemble: async () => { throw new Error('ERDDAP down'); },
    updateIndex: async () => {},
    cwd: '/tmp',
  });
  assert.match(res.lines().at(-1).error, /ERDDAP down/);
});

test('409s when a generation is already in flight', async () => {
  __resetBusyForTests();
  let release;
  const gate = new Promise((r) => { release = r; });
  const res1 = makeRes();
  const first = handleGenerate(makeReq(goodBody), res1, {
    assemble: async () => { await gate; return { warnings: [] }; },
    updateIndex: async () => {}, cwd: '/tmp',
  });
  const res2 = makeRes();
  await handleGenerate(makeReq(goodBody), res2, {
    assemble: async () => ({ warnings: [] }), updateIndex: async () => {}, cwd: '/tmp',
  });
  assert.equal(res2.statusCode, 409);
  release();
  await first;
});
```

- [ ] **Step 2: fail → implement**

```js
// generator/dev-api.mjs
import path from 'node:path';
import { parseBbox, validateSlug, validateName } from './lib/bbox-args.mjs';
import { updatePackIndex } from './lib/pack-index.mjs';

let busy = false;
export function __resetBusyForTests() { busy = false; }

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function handleGenerate(req, res, { assemble, updateIndex, cwd }) {
  let options;
  try {
    const body = await readJsonBody(req);
    options = {
      bbox: parseBbox([body.bbox?.lonMin, body.bbox?.latMin, body.bbox?.lonMax, body.bbox?.latMax].join(',')),
      name: validateName(body.name),
      slug: validateSlug(body.slug),
    };
  } catch (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.end(`${JSON.stringify({ error: error.message })}\n`);
    return;
  }

  if (busy) {
    res.statusCode = 409;
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.end(`${JSON.stringify({ error: 'a generation is already running' })}\n`);
    return;
  }

  busy = true;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson');
  try {
    const packsDir = path.resolve(cwd, 'public', 'packs');
    const outDir = path.join(packsDir, options.slug);
    const report = await assemble({
      ...options,
      outDir,
      onProgress: (stage) => res.write(`${JSON.stringify({ stage })}\n`),
    });
    await updateIndex(packsDir, options.slug);
    res.end(`${JSON.stringify({ done: true, report })}\n`);
  } catch (error) {
    res.end(`${JSON.stringify({ error: error.message })}\n`);
  } finally {
    busy = false;
  }
}

export function devGenerateApi() {
  return {
    name: 'dev-generate-api',
    async configureServer(server) {
      const { assemblePack } = await import('./lib/pack.mjs');
      server.middlewares.use('/api/generate', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        handleGenerate(req, res, {
          assemble: assemblePack,
          updateIndex: updatePackIndex,
          cwd: server.config.root,
        });
      });
    },
  };
}
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { devGenerateApi } from './generator/dev-api.mjs';

export default defineConfig({
  plugins: [devGenerateApi()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        generate: resolve(import.meta.dirname, 'generate.html'),
      },
    },
  },
});
```

Note: `generate.html` does not exist until Task 6 — create it in the same commit as the config OR keep the `input` addition commented until Task 6. Preferred: land vite.config.js in THIS task with only the plugin (no `build.rollupOptions`), and add the two-page `input` in Task 6.

- [ ] **Step 3: `npm test` pass; `npx vite build` still clean. Commit** — `feat(generator): dev-only /api/generate endpoint with NDJSON progress`.

---

### Task 6: Picker page — slippy map, form, progress stream

**Files:**
- Create: `generate.html`, `src/generate/main.js`, `src/generate/slippy-map.js`, `src/generate/generate.css`
- Modify: `vite.config.js` (add the two-page `build.rollupOptions.input` from Task 5's note)

**Interfaces:**
- Consumes: `POST /api/generate` (Task 5 NDJSON contract).
- Produces: `createSlippyMap(container, { center: [lat, lon], zoom })` → `{ getBBox(): {lonMin,latMin,lonMax,latMax}|null, setDrawMode(on: boolean), onBBoxChange(cb), destroy() }`. Internals: Web Mercator `lonLatToWorld`/`worldToLonLat` at zoom z; tile pool of `<img>` elements; pointer drag pans; wheel zooms ±1 around the cursor (clamp z to [2, 16]); in draw mode, pointer drag draws the selection rectangle instead of panning.

Key formulas (Web Mercator, tile size 256):

```js
const worldX = (lon) => (lon + 180) / 360;                    // 0..1
const worldY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; // 0..1
};
const worldToLon = (x) => x * 360 - 180;
const worldToLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
```

- [ ] **Step 1: Write `src/generate/slippy-map.js`.** Responsibilities and structure:
  - State: `{ centerX, centerY, zoom }` in world units (0..1), plus `drawMode`, `bbox` (world-unit rect or null).
  - `render()`: scale = 256 · 2^zoom px per world unit. Visible world rect from container size; loop needed tiles `tx ∈ [floor(x0·2^z), floor(x1·2^z)]` (same for y, clamp 0..2^z−1); reuse `<img>` per `z/x/y` key from a Map, create missing (`img.src = \`https://tile.openstreetmap.org/${z}/${tx}/${ty}.png\`` , absolutely positioned at `(tx/2^z − x0)·scale, (ty/2^z − y0)·scale`), remove off-screen/off-zoom tiles. Position the selection rectangle div the same way when `bbox` is set.
  - Events: `pointerdown/move/up` — in pan mode adjust `centerX/centerY` by `−dpx/scale`; in draw mode record anchor on down, update `bbox` on move, fire `onBBoxChange(getBBox())` on up. `wheel` — `zoom = clamp(zoom ± 1, 2, 16)` keeping the cursor's world point fixed: `center += (cursorWorld − center) · (1 − 2^(oldZ−newZ))`.
  - `getBBox()` converts the world rect to `{lonMin,latMin,lonMax,latMax}` via `worldToLon/worldToLat` (note: larger worldY = smaller lat, so latMin comes from the rect's BOTTOM edge).
  - Attribution: a fixed corner div `© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`.
- [ ] **Step 2: Write `generate.html`** — same font/style bootstrapping as `index.html`, with `<div id="map">`, side panel `<aside id="picker-panel">` (bbox readout, warnings `<ul>`, name/slug inputs, Draw area + Generate buttons, `<pre id="progress-log">`), and `<script type="module" src="/src/generate/main.js">`.
- [ ] **Step 3: Write `src/generate/main.js`.** Wire-up:
  - `createSlippyMap(document.getElementById('map'), { center: [30, 0], zoom: 3 })`.
  - "Draw area" button toggles `setDrawMode`; `onBBoxChange` fills the readout: coordinates to 4 decimals, spans in km (`latSpan·111.32`, `lonSpan·111.32·cos(midLat)`), and warnings: aspect ratio (km) outside [0.6, 1.6] → "box is far from square — the scene is 1200×1200"; lat span outside [0.15, 1.0]° → "span outside the sweet spot (≈0.15°–1.0°)".
  - Name input auto-derives slug: lowercase, strip diacritics (`normalize('NFD').replace(/\p{M}/gu, '')`), non-alphanumerics → hyphens, trim hyphens; slug field stays editable.
  - Generate: `fetch('/api/generate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ bbox, name, slug }) })`; read `res.body.getReader()`, decode chunks, split on newlines, append each parsed line to the log (`stage: bathymetry ✓` style); on `{done, report}` render the report + `<a href="/?region=SLUG">Open SLUG →</a>`; on `{error}` render it red. On 404 → "generation needs the dev server — run npm run dev". Disable the Generate button while streaming.
- [ ] **Step 4: Write `src/generate/generate.css`** — full-viewport map, absolutely positioned right panel reusing the app's palette (`#0e100e` panel, `#f1ead9` text, accent `#2fb8a6`), monospace log.
- [ ] **Step 5: Update `vite.config.js`** with the two-page `input` block from Task 5's note.
- [ ] **Step 6: Verify by hand** — `npm run dev`, open `/generate.html`: map pans/zooms, rectangle draws, warnings react, `npx vite build` emits both pages. Commit — `feat: map-based region picker page`.

---

### Task 7: Region dropdown + picker link in the main app

**Files:**
- Modify: `src/ui/overlay.js`

**Interfaces:**
- Consumes: `packs/index.json` (`{ default, packs: [slug...] }`), current slug from `location.search`.

- [ ] **Step 1: Implement.** In `initOverlay`, after the header block in `panel.innerHTML`, add a region row (between header and the first divider):

```html
<div class="panel__region">
  <label class="toggle-row" for="region-select">
    <span class="toggle-row__text">
      <span class="toggle-row__label">Region</span>
    </span>
    <select id="region-select" class="region-select"></select>
  </label>
  <a class="region-new" href="generate.html">+ new region</a>
</div>
```

  After `root.appendChild(panel)`, populate it:

```js
  const regionSelect = panel.querySelector('#region-select');
  const currentSlug = new URLSearchParams(location.search).get('region');
  fetch('packs/index.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((index) => {
      if (!index || !Array.isArray(index.packs)) return;
      const active = currentSlug ?? index.default;
      for (const slug of index.packs) {
        const option = document.createElement('option');
        option.value = slug;
        option.textContent = slug;
        option.selected = slug === active;
        regionSelect.appendChild(option);
      }
      regionSelect.addEventListener('change', () => {
        location.search = `?region=${encodeURIComponent(regionSelect.value)}`;
      });
    })
    .catch(() => {});
```

  Add matching styles to `src/ui/overlay.css` (`.region-select` dark select matching the panel, `.region-new` small accent link).
- [ ] **Step 2: Verify** — dev server: dropdown lists all three packs, switching navigates, "+ new region" opens the picker. `npx vite build` clean. Commit — `feat: region switcher + picker link in overlay`.

---

### Task 8: End-to-end browser gate + adversarial review

**Files:**
- Create: `docs/screenshots/picker-p0.png` (and the generated demo pack under `public/packs/`)

- [ ] **Step 1: End-to-end**: on `/generate.html`, draw a bbox over the Strait of Gibraltar (≈ −5.75,35.85 → −5.25,36.25), name "Gibraltar", generate through the UI, watch stages stream, open `/?region=gibraltar`, confirm clean boot. Screenshot the picker mid/post-generation and the booted region.
- [ ] **Step 2:** `npm test` all pass; `npx vite build` clean; confirm `dist/` contains NO `/api/generate` handler (grep `dist/assets` for `dev-generate-api` → nothing).
- [ ] **Step 3:** Codex adversarial review of the working tree (focus: tile math correctness, stream parsing, dev-only guarantee, injection via name/slug into HTML). Address findings.
- [ ] **Step 4:** Commit — `feat: region picker end-to-end (Gibraltar demo)` — and push.

## Self-review notes

- Spec coverage: map+draw (T6), dev API + streaming (T5), retry (T1), shared
  validation (T2), shared index (T3), progress (T4), dropdown+link (T7),
  gate+review (T8). Prod-degradation copy in T6 Step 3. ✓
- Type consistency: `{lonMin,latMin,lonMax,latMax}` bbox object everywhere;
  NDJSON line shapes `{stage}` / `{done,report}` / `{error}` in T5 and T6. ✓
- No placeholders; every code step carries real code or exact structure. ✓
