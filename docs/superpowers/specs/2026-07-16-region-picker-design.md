# Region Picker — Design

Date: 2026-07-16. Status: approved (architecture + map tech chosen by user).

## Purpose

A map-based UI to generate new region packs: pan/zoom a world map, drag a
rectangle, name it, generate, watch progress, jump into the drained view.
Local dev tool — the cloud pipeline remains P1.

## Decisions (user-approved)

- **Local dev tool**: picker page served by the Vite dev server; a dev-only
  middleware runs the existing generator on this machine. No new
  infrastructure.
- **Zero-dep slippy map**: hand-rolled OSM raster-tile map. `package.json`
  dependencies stay exactly `three` + `vite`.

## Architecture

```
generate.html                     second Vite page (multi-page build input)
src/generate/
  main.js                         page wiring: map + form + progress stream
  slippy-map.js                   zero-dep OSM tile map w/ bbox draw mode
  generate.css                    page styles (reuses overlay design tokens)
generator/
  dev-api.mjs                     Vite plugin: POST /api/generate (dev only)
  lib/retry.mjs                   withRetry() — used for flaky Overpass
  lib/pack-index.mjs              updatePackIndex() shared by CLI + dev API
  lib/bbox-args.mjs               parseBbox()/validateSlug() shared by CLI + dev API
vite.config.js                    new: registers dev-api plugin + generate.html input
src/ui/overlay.js                 region dropdown + "+ new region" link
```

## Components

**Slippy map (`src/generate/slippy-map.js`)** — Web Mercator tile math
(z/x/y), DOM `<img>` tiles from `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
positioned in a translated container. Drag to pan, wheel to zoom (integer
steps around cursor), buttons for zoom. "Draw area" mode: pointer drag draws
the bbox rectangle (absolutely positioned overlay div); exposes
`onBBoxDrawn(bbox)` and `screenToLatLon()`. Attribution line
"© OpenStreetMap contributors" fixed on the map. No dependencies.

**Picker page (`src/generate/main.js`)** — right-hand panel in the app's
instrument style: bbox readout (coords + km span), warnings when the box is
far from square (world maps to a fixed 1200² scene) or outside ~0.15°–1.0°
span, name input with auto-derived slug (editable), Generate button.
Generation streams NDJSON progress lines into a log; success shows the
report + "Open region" link (`/?region=<slug>`). If `POST /api/generate`
404s (production build), the page shows "generation needs the dev server —
run npm run dev" and the map stays usable for exploring bboxes to use with
the CLI.

**Dev API (`generator/dev-api.mjs`)** — Vite plugin, `configureServer` only
(never in build output). `POST /api/generate` with JSON
`{ bbox: {lonMin,latMin,lonMax,latMax}, name, slug }`:
1. Validate via `bbox-args.mjs` (shared with CLI) → 400 with message on
   failure; slug collisions with an existing pack are allowed (regenerate).
2. Run `assemblePack` with a new `onProgress(stage)` callback, streaming
   NDJSON lines: `{stage}` … `{done, report}` or `{error}`.
3. `updatePackIndex` via the shared module.
Concurrency guard: one generation at a time (409 if busy).

**Generator changes** —
- `assemblePack` gains optional `onProgress(stage: string)` (default noop);
  stages: `bathymetry`, `wrecks`, `places`, `imagery`, `assembling`,
  `validating`.
- Places fetch wrapped in `withRetry` (3 attempts, fixed 2 s/4 s backoff, no
  Math.random) — the P0 lesson about the flaky public Overpass instance.
- `updatePackIndex` moves out of `cli.mjs` into `lib/pack-index.mjs`
  (unchanged behavior, now tested); CLI imports it.

**App integration (`src/ui/overlay.js`)** — a region `<select>` in the panel
populated from `packs/index.json` (current region selected; change navigates
to `?region=<slug>`), and a "+ new region" link to `/generate.html`.

## Error handling

- Middleware: invalid JSON/bbox/slug → 400 + message rendered in the page log;
  generator throw → streamed `{error}` line; concurrent request → 409.
- Page: fetch/stream failures and 404 (no dev server) render as log lines,
  never uncaught.
- Tile images that 404 render as blank tiles (browser default) — acceptable.

## Testing

- `node:test` (offline): retry.mjs (attempts/backoff/give-up),
  pack-index.mjs (create/update/preserve-default), bbox-args.mjs
  (bbox/slug validation), assemblePack onProgress emission order
  (fixture-backed, extends pack.test.mjs).
- Browser gate: draw a bbox on the map, generate a real region end-to-end,
  confirm progress stream, open the region, screenshots. UI has no runtime
  test framework (P0 decision stands).

## Out of scope

Cloud pipeline, zip download, data-availability preview panel (P1);
mobile/touch polish; tile caching.
