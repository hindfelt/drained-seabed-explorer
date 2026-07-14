# Drained Seabed Explorer — Öresund, drained

An interactive 3D visualization of the Öresund strait with all its water removed.
Orbit between the Swedish and Danish coasts, past Helsingborg and Helsingør at the
narrows, over the tilted cliff-edged island of Ven, down the old shipping channel,
and among the real shipwrecks of the sound — stranded on a seabed of cracked mud,
salt flats and boulder shoals.

![Demo tour — orbit, wreck close-ups, marker toggles, and the water refilling to its former sea level](media/demo.gif)

*Higher quality: [media/demo.mp4](media/demo.mp4) (the UI panel is DOM, so the
scripted canvas capture shows the 3D scene only — markers blink and the water
rises exactly when the toggles are clicked).*

## Run it

```sh
npm install && npm run dev
```

Then open the URL Vite prints (default: http://localhost:5173).

## Controls

- **Drag** — orbit the camera 360°
- **Scroll / pinch** — zoom in and out
- **Right-drag** — pan across the map
- **Overlay panel** — toggle shoal markers, shipwrecks, place names, and the
  water itself: "Water" animates the sound refilling to its former sea level,
  and drains it away again when switched off

## What's in the scene

- **Real bathymetry**: EMODnet Bathymetry DTM 2024 (~115 m) merged with GEBCO
  2020 for land, covering lat 55.82–56.10 / lon 12.44–12.94 (≈31×31 km of the
  northern sound). Vertical exaggeration: seabed ×1.8 world-units/m, land ×0.9
  with smooth tanh compression. Everything is authored in real WGS84
  coordinates and projected via `geoToWorld`. Rebuild the grid with
  `node scripts/build-bathymetry.mjs`.
- **Real shoals** straight out of the depth grid — Disken, Lappegrund,
  Grollegrund (the boulder-reef reserve north of Helsingborg), Lundåkragrund.
- **Satellite imagery on land**: Sentinel-2 cloudless (EOX, 4096²) draped over
  everything above the waterline via a shader blend, while the seabed keeps its
  drained-mud look. Refetch with `node scripts/build-satellite.mjs`.
- **Type-specific wreck models**: curved-hull steamers with funnels and derricks,
  Cimbria's paddle boxes, skeletal pre-1910 wooden sailing ships with exposed rib
  frames, trawlers, a patrol boat, a landing craft, and the Cementbåten concrete
  caisson — all rust-streaked via deterministic vertex weathering.
- **23 real wrecks** of the sound, cross-referenced from
  [oresundsdykning.se](https://www.oresundsdykning.se/vrak2/),
  [vragguiden.dk](https://www.vragguiden.dk/) (verified WGS84 positions), and
  [vrag.dk](https://www.vrag.dk/vrag-i-oeresund/) — from the 1858 paddle steamer
  Cimbria to S/S Robert north of Ven — 17 at charted coordinates, 2 clamped to
  the map edge, 4 placed from historical location descriptions (marked
  approximate in `sites.js`). Each has a name label, beacon, and low-poly
  stranded hull. Full harvested dataset: `docs/wrecks-oresundsdykning.json`.
- **Labeled places**: Helsingborg, Helsingør, Landskrona, Råå, Snekkersten,
  Borstahusen, and Ven's villages Kyrkbacken and Sankt Ibb.

## Tech

- [Three.js](https://threejs.org/) — WebGL, PCF soft shadow maps, ACES tone mapping
- [Vite](https://vite.dev/) — dev server and bundling
- Procedural seeded bathymetry at 512×512 grid resolution (~75 ms generation),
  fully deterministic, no binary assets

## Project layout

```
drained-seabed/
├── index.html                     canvas + UI overlay root
├── package.json                   three + vite only
└── src/
    ├── main.js                    integration glue
    ├── data/
    │   ├── heightmap.js           procedural Öresund bathymetry + coasts + Ven
    │   └── sites.js               REEFS (shoals), WRECKS (real), PLACES data
    ├── scene/
    │   ├── setup.js               renderer, sun/sky, shadows, OrbitControls
    │   ├── terrain.js             displaced terrain mesh
    │   └── markers.js             wrecks, shoals, beacons, name labels, places
    ├── materials/
    │   └── terrainMaterial.js     seabed + land + cliff vertex-color material
    └── ui/
        ├── overlay.js             toggle panel (shoals / wrecks / place names)
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
