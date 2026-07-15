# Seabed Studio — a generator for drained-seabed explorers

Plan for turning the one-off Öresund build into a product: pick any coastal area
on a map, press Generate, download a self-contained offline app of that seabed,
drained.

---

## 1. What the product is

**Input**: a rectangle drawn on a world map + a handful of options.
**Output**: a downloadable, offline-runnable "region pack" — the existing
Three.js explorer (terrain, satellite land, wrecks, places, shoals, water
toggle) parameterized entirely by data, no per-region code.

Two components, cleanly separated:

- **Generator** (online): area-picker UI + data pipeline. Needs the internet
  once, at generation time.
- **Runtime** (offline): the current app, refactored to boot from a
  `region-pack` instead of hardcoded Öresund files. Never touches the network.

## 2. Honest role of the linked chart services

This is the part that shapes the whole architecture. The four references split
into two categories:

| Service | What it is | Role in the generator |
|---|---|---|
| nauticalfree.free.fr | Index of *genuinely free* official charts (NOAA US, Brazil DHN, and other hydrographic offices that publish freely) — site is HTTP-only and flaky, verify per-source | Source *discovery*: where it points to public-domain/open charts (NOAA raster + ENC are US-government open data), those become optional overlay layers and automated depth-validation sources |
| aquamap.app | Commercial chart viewer (proprietary licensed tiles) | **Not a data source.** Human reference only: a side-by-side viewer link in the UI so the user can eyeball-verify depths in their selected area |
| i-boating web app | Commercial chart viewer (proprietary) | Same — reference viewer link only |
| geokatalog.sjofartsverket.se | Official Swedish chart viewer; Swedish HO data is licensed, not open | Same — reference only (Sweden has some open marine data via SMHI/EMODnet, which we already use via the open route) |

**Principle: build the pipeline exclusively on open data; use chart viewers as
human verification aids, never scraped.** The Öresund build already proved the
open stack suffices: EMODnet + GEBCO agreed with each other and structurally
matched the SE922 chart.

## 3. Data pipeline (generalizing what we built)

Adapter-per-source architecture, each adapter declaring coverage, resolution,
license, and attribution:

1. **Bathymetry** — base: GEBCO (global, ~450 m) via ERDDAP JSON.
   Regional refinement adapters merged on top where the bbox intersects:
   EMODnet DTM (~115 m, Europe), NOAA BlueTopo/CUDEM (US), AusSeabed
   (Australia), LINZ (NZ), … Same sea-from-fine / land-and-gaps-from-GEBCO
   merge we already run. Cross-source disagreement map doubles as automated
   sanity checking (replaces the manual chart checkpoints).
2. **Land imagery** — EOX Sentinel-2 cloudless WMS (global, keyless),
   Esri World Imagery export fallback. Already built.
3. **Places** — OSM Overpass: `place=city|town|village` in bbox, ranked by
   population/coastal proximity. Replaces hand-authored lists.
4. **Wrecks** — the big generalization. Manual per-region research doesn't
   scale; instead: **OpenSeaMap/OSM seamarks** (`seamark:type=wreck`, global,
   coordinates included), **NOAA AWOIS/ENC wreck layers** (US, open), and any
   other open national wreck registers behind adapters. Plus a **user CSV/URL
   import** slot for regional passion-sources (like our oresundsdykning.se) —
   imported entries without charted coordinates automatically get the
   `approximate` treatment (≈ labels, hollow beacons) we built.
5. **Shoals/banks** — named from OSM (`natural=shoal|reef`, seamark
   equivalents); unnamed ones detected as local shallow crests in the grid.
6. **Auto-tuning** — vertical exaggeration derived from the region's real
   depth histogram (deepest ≈ −90 world units, land tanh-compressed);
   material color bands fitted to the actual depth distribution
   (the lesson that cost us a debugging round).

## 4. Area-selection UI

Single-page app, MapLibre GL over OSM tiles:

- **Find**: geocoder search (Nominatim) + click-drag rectangle, constrained to
  10–100 km per side and near-square (the world maps to a fixed square).
  Presets gallery (straits, bays, lakes people will want).
- **See what you'll get, before generating**: live overlays while dragging —
  GEBCO shaded-relief WMS (is there interesting relief?), OpenSeaMap seamark
  layer (how many wrecks?), and a data-availability panel: which refinement
  adapter covers this bbox, effective grid resolution, wreck/place counts from
  a fast Overpass count query, estimated pack size.
- **Configure**: region name, exaggeration override, layer toggles, mood
  preset, label language, optional wreck-source CSV/URL.
- **Verify**: one-click side-by-side links opening aquamap / i-boating /
  national viewers at the same bbox for human depth comparison.
- **Preview**: low-res (64²) heightmap rendered as an actual mini 3D preview
  in the picker (the runtime renderer reused at thumbnail scale) before
  committing to full generation.

## 5. Generation & packaging

- **Pipeline execution**: server-side worker (not in-browser) — avoids CORS
  variance, enables caching and rate-limit citizenship. Job flow: enqueue →
  fetch/merge (cached per-tile) → validate → bake pack → store → download link.
  Given the existing toolchain, Cloudflare fits: Pages (UI), Worker + Queues
  (jobs), R2 (source-tile cache + finished packs), Durable Object (job status).
  A local CLI (`npx seabed-studio --bbox …`) shares the same pipeline code for
  power users and CI.
- **Region pack** (the only per-region artifact):
  `meta.json` (bbox, name, exaggeration, attributions), `bathymetry.bin`
  (Int16 quantized — ~4× smaller than our JSON), `satellite.jpg`,
  `sites.json` (wrecks/places/shoals incl. approximate flags).
- **Offline product** — primary: **one self-contained HTML file** (runtime JS
  inlined, assets base64) — double-click, works from file://, no server, no ES
  module/CORS issues, ~15–25 MB. Secondary: zip of a static folder + PWA
  (installable from the generator site, service-worker cached) for
  in-browser offline use. Fonts self-hosted subset or system stack — the
  current Google Fonts import is the one online dependency to remove.
- **Baked-in legal**: every pack embeds a data-credits panel (already built)
  plus LICENSE-DATA.md assembled from the adapters actually used; generation
  refuses sources whose license forbids redistribution.

## 6. Runtime refactor (from Öresund app to engine)

Small, mostly done already: replace imports of `bathymetry.json` /
`sites.js` constants with a `loadRegionPack(url)`; move Öresund-specific
prose (title, subtitle) into `meta.json`; keep every hard-won behavior as
engine defaults (tanh land compression, depth-histogram color fitting,
wrecks-don't-receive-shadows, world-position satellite UVs, graceful asset
fallbacks, deterministic seeding).

## 7. Phased roadmap

- **P0 — Engine split (1 session)**: extract pipeline → `generator/` CLI +
  runtime that boots from a region pack. Prove with 3 diverse regions
  (a Norwegian fjord, a tropical atoll, one of the Great Lakes) — this smokes
  out Öresund assumptions (depth ranges, land ratios, wreck sparsity).
- **P1 — Web generator (1–2 sessions)**: map picker UI, server pipeline with
  caching, zip download, attribution assembly.
- **P2 — Offline polish**: single-file HTML packaging, PWA install, OSM/NOAA
  wreck adapters, automated visual QA (headless screenshot checks of every
  generated pack — the browser-verification loop we did by hand, scripted).
- **P3 — Product touches**: preset/gallery of generated regions, shareable
  links, optional free-chart overlay layer (NOAA raster where public domain),
  fly-to-site interactions.

## 8. Risks & mitigations

- **GEBCO too coarse for small areas** (450 m): enforce minimum bbox where no
  fine adapter covers, or blend disclosed synthetic detail.
- **Open endpoints under automated load**: aggressive R2 caching keyed by
  tile, backoff, contact info in UA string; adapters make sources swappable
  when one goes away (nauticalfree's own flakiness is the cautionary tale).
- **Wreck sparsity outside popular waters**: the honest-≈ pattern + user
  import slot; never fabricate positions (established policy).
- **file:// quirks across browsers**: single-file build uses a classic IIFE
  bundle, not ES modules; tested on Chrome/Safari/Firefox as part of P2 QA.
- **License drift**: adapter registry carries license metadata; packs are
  reproducible (same inputs → same pack) so re-generation after a source
  change is cheap.
