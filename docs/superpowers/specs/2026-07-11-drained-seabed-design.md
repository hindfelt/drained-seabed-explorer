# Drained Seabed Explorer — Design

Date: 2026-07-11
Status: Approved via /goal directive (autonomous session — the goal text is the spec)

## Goal

A local, interactive 3D web app visualizing a completely drained seabed (conceptually
similar to the Aral Sea): uneven bathymetric terrain with deep canyons, salt flats,
exposed coral reefs, and stranded shipwrecks. Users orbit/zoom/pan freely and can
toggle reef and wreck markers from an HTML overlay.

## Approach

**Chosen: vanilla Vite + Three.js (ES modules, no framework).**
Two dependencies, one install+run command, no framework overhead for a single overlay
panel. Alternatives considered: React Three Fiber (better for complex stateful UI —
overkill here), CDN import-maps (zero install, but the spec asks for an installable
local project with a dev server).

Terrain is a **procedural seeded heightmap** (fBm value noise + basin falloff + carved
meandering canyons + flattened salt pans + reef mounds) rather than a shipped data
file: deterministic, self-contained, no binary assets.

## Architecture

```
drained-seabed/
├── index.html                     orchestrator-owned: canvas + #overlay-root
├── package.json                   three + vite only
└── src/
    ├── main.js                    orchestrator-owned integration glue
    ├── data/                      ── Topography & Data Agent ──
    │   ├── heightmap.js           procedural bathymetry generator
    │   └── sites.js               reef + wreck coordinate data (pure data, no imports)
    ├── scene/
    │   ├── setup.js               ── 3D Rendering Agent ── renderer/camera/lights/controls
    │   ├── terrain.js             ── 3D Rendering Agent ── displaced mesh from heightmap
    │   └── markers.js             ── Textures & UI Agent ── low-poly wrecks/reefs + toggles
    ├── materials/
    │   └── terrainMaterial.js     ── Textures & UI Agent ── drained-seabed look
    └── ui/
        ├── overlay.js             ── Textures & UI Agent ── toggle panel
        └── overlay.css
```

## Interface contracts (binding for all agents)

### Coordinate system
- Terrain: square, `size × size` world units in the XZ plane, centered at the origin.
  Y is elevation. `y = 0` is the former waterline (old shoreline rim).
- Elevation semantics: rim edges ≈ −5..0; open basin floor ≈ −60..−90; salt-flat pans
  flattened near −70; canyon bottoms reach ≈ −130; reef mounds rise 25–45 above their
  surrounding floor.

### `src/data/heightmap.js` (no dependencies except `./sites.js`)
```js
export const TERRAIN_SIZE = 1200;       // world units per side
export const TERRAIN_RESOLUTION = 256;  // grid cells per side → (257)² samples
export function generateHeightmap(seed = 1337): {
  size: number,
  resolution: number,
  heights: Float32Array,   // (resolution+1)² samples, row-major: idx = iz*(resolution+1)+ix
                           // world x = -size/2 + (ix/resolution)*size (same for z with iz)
  min: number, max: number,
  getHeightAt(x, z): number  // bilinear interpolation, clamped at bounds
}
```
Deterministic (seeded PRNG, no `Math.random()`). Must import `REEFS` from
`./sites.js` and raise reef mounds at those coordinates so data and terrain agree.

### `src/data/sites.js` (pure data, zero imports)
```js
export const REEFS = [
  { id, name, position: [x, z], radius, description }, ...  // ≥4 sites
];
export const WRECKS = [
  { id, name, position: [x, z], heading /* radians */, length, type, sunkYear, description }, ...  // ≥6 sites
];
```

### `src/scene/setup.js`
```js
export function createScene(canvas): { scene, camera, renderer, controls, onFrame(cb), start() }
```
Shadow-mapped directional sun (low warm angle, shadow camera covering the terrain),
hemisphere fill, fog matched to background haze, OrbitControls with damping —
full 360° azimuth, polar clamped just above the horizon, zoom + pan enabled,
window resize handled, `start()` runs the render loop (calls `controls.update()`
and any `onFrame` callbacks with dt seconds).

### `src/scene/terrain.js`
```js
export function createTerrain(heightmap): THREE.Mesh
```
Order matters: displace vertices via `heightmap.getHeightAt(x, z)` →
`computeVertexNormals()` → `applyTerrainColors(geometry, heightmap)` → material from
`createTerrainMaterial()`. Mesh both casts and receives shadows (self-shadowing
emphasizes canyon depth).

### `src/materials/terrainMaterial.js`
```js
export function createTerrainMaterial(): THREE.Material          // vertexColors: true
export function applyTerrainColors(geometry, heightmap): void    // writes 'color' attribute
```
Color bands by elevation + slope: near-white salt crust in the pans, cracked dried mud
across the basin, darker sediment in canyons, grey-brown rock on steep slopes; subtle
noise dithering so bands don't read as hard stripes.

### `src/scene/markers.js`
```js
export function createMarkers(heightmap): { group, setReefsVisible(v), setWrecksVisible(v) }
```
Reads `REEFS`/`WRECKS` from `../data/sites.js`, resolves Y via
`heightmap.getHeightAt`. Low-poly stranded hulls (listing, half-buried, rust tones) and
bleached coral clusters, all casting shadows, plus a small floating beacon pin per site
(teal = reef, rust-orange = wreck) so sites read when zoomed out.

### `src/ui/overlay.js` + `overlay.css`
```js
export function initOverlay({ onToggleReefs, onToggleWrecks }): void
```
Builds a glass panel inside `#overlay-root`: title, checkbox toggles with site counts,
color legend, control hints. Both toggles start checked.

## Error handling & testing

- No network, no user input beyond checkboxes and camera → main risk is integration
  drift; the binding contracts above prevent it.
- Verification: `npm install && npm run dev`, then automated browser check
  (page loads, zero console errors, terrain + panel visible, toggles actually
  hide/show markers) before declaring done.
