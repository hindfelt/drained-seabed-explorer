# Drained Seabed Explorer

An interactive 3D visualization of real seabeds with all their water removed —
an engine that renders any "region pack", plus a zero-dependency generator that
builds packs for any bounding box on Earth from open data. The first region is
the Öresund strait: orbit between the Swedish and Danish coasts, past
Helsingborg and Helsingør at the narrows, over the tilted cliff-edged island of
Ven, down the old shipping channel, and among the real shipwrecks of the sound
— stranded on a seabed of cracked mud, salt flats and boulder shoals.

![Demo tour — orbit, wreck close-ups, marker toggles, and the water refilling to its former sea level](media/demo.gif)

*Higher quality: [media/demo.mp4](media/demo.mp4) (the UI panel is DOM, so the
scripted canvas capture shows the 3D scene only — markers blink and the water
rises exactly when the toggles are clicked).*

## Run it

```sh
npm install && npm run dev
```

Then open the URL Vite prints (default: http://localhost:5173). The app boots
the default region from `public/packs/index.json`; switch regions with the
`?region=<slug>` query parameter, e.g. `http://localhost:5173/?region=oresund`.

## Generate a new region

Any bounding box on Earth, straight from open data (GEBCO + EMODnet bathymetry,
UKHO wrecks via EMODnet WFS, OpenStreetMap places, Sentinel-2 imagery):

```sh
npm run generate -- --bbox <lonMin,latMin,lonMax,latMax> --name "<Name>" --slug <slug>
# the Öresund pack was generated with:
npm run generate -- --bbox 12.44,55.82,12.94,56.10 --name "Öresund" --slug oresund
```

The generator writes `public/packs/<slug>/` (bathymetry grid, satellite image,
normalized wrecks/places/shoals, and auto-tuned exaggeration + color bands in
`meta.json`), validates the pack, updates `public/packs/index.json`, and prints
a report. Data-quality caveats (e.g. GEBCO-only bathymetry outside Europe) are
written into the pack and surfaced in the app's credits line. Keep bboxes
roughly square and modest (≈0.2–0.5°) — the world maps onto a fixed 1200×1200
scene. Generator tests never hit the network: `npm test`.

## Controls

- **Drag** — orbit the camera 360°
- **Scroll / pinch** — zoom in and out
- **Right-drag** — pan across the map
- **Overlay panel** — toggle shoal markers, shipwrecks, place names, and the
  water itself: "Water" animates the sound refilling to its former sea level,
  and drains it away again when switched off

## What's in the scene

- **Real bathymetry**: EMODnet Bathymetry DTM 2024 (~115 m, Europe) merged with
  GEBCO 2020 (global, land + gap fill), resampled onto a 256×256 pack grid and
  stored as little-endian Int16 decimeters. Per-region vertical exaggeration
  and color bands are auto-tuned by the generator from the depth distribution
  (`meta.json`), with smooth tanh land compression.
- **Real shoals** detected straight out of the depth grid — local crests that
  stand proud of their surroundings, shallowest first.
- **Satellite imagery on land**: Sentinel-2 cloudless (EOX, 4096², Esri
  fallback) draped over everything above the waterline via a shader blend,
  while the seabed keeps its drained-mud look.
- **Type-specific wreck models**: curved-hull steamers with funnels and derricks,
  paddle-steamer boxes, skeletal pre-1910 wooden sailing ships with exposed rib
  frames, trawlers, patrol boats, landing craft, and concrete caissons — all
  rust-streaked via deterministic vertex weathering.
- **Real charted wrecks** from the UK Hydrographic Office global dataset (via
  EMODnet Human Activities WFS) — 39 in the Öresund window, each with a name
  label (where known), beacon, and low-poly stranded hull. Estimated positions
  (whole-minute fixes) are honestly flagged with ≈.
- **Labeled places** from OpenStreetMap — cities, towns, and villages inside
  the window, prioritized city > town > village.

## Tech

- [Three.js](https://threejs.org/) — WebGL, PCF soft shadow maps, ACES tone mapping
- [Vite](https://vite.dev/) — dev server and bundling
- Generator: Node ≥ 20 built-ins only, zero npm dependencies, adapters per
  source, offline `node:test` suite with recorded fixtures
- Runtime terrain at 512×512 world resolution, seeded fBm detail, fully
  deterministic

## Project layout

```
drained-seabed/
├── index.html                     canvas + UI overlay root
├── package.json                   three + vite only (runtime deps)
├── generator/
│   ├── cli.mjs                    npm run generate — pack assembler CLI
│   ├── adapters/                  bathy (GEBCO/EMODnet), wrecks, places, imagery
│   ├── lib/                       codec, grids, shoals, meta, pack assembly
│   └── fixtures/                  recorded API responses (tests run offline)
├── public/packs/<slug>/           generated region packs (meta, bathymetry,
│                                  satellite, sites) + index.json
└── src/
    ├── main.js                    async boot from ?region= pack
    ├── pack-loader.js             pack fetch/validate/decode + site conversion
    ├── data/heightmap.js          pack grid → world heightmap (tanh land)
    ├── scene/
    │   ├── setup.js               renderer, sun/sky, shadows, OrbitControls
    │   ├── terrain.js             displaced terrain mesh
    │   └── markers.js             wrecks, shoals, beacons, name labels, places
    ├── materials/
    │   └── terrainMaterial.js     seabed + land + cliff vertex-color material
    └── ui/
        ├── overlay.js             toggle panel, pack credits + warnings
        └── overlay.css            overlay + base page styles
```

Design doc: `docs/superpowers/specs/2026-07-11-drained-seabed-design.md`

## Recreate this for any region on Earth

This app was built by a team of AI sub-agents from a single `/goal` prompt in
[Claude Code](https://claude.com/claude-code). The full reusable prompt — with the
exact input data you need to provide (bounding box, places, wreck sources, depth
sanity checkpoints…) and the hard-won pitfalls to avoid — lives in
[`docs/GOAL-TEMPLATE.md`](docs/GOAL-TEMPLATE.md). Fill in the blanks for any
strait, bay or lake, paste it into `/goal`, and you get a drained replica of
your own waters.
