# /goal template — "Drained Seabed Explorer" for any region on Earth

Fill in the INPUT DATA block, then paste the GOAL text (with your values substituted)
into `/goal`. Everything below is distilled from building the Öresund original,
including the pitfalls that cost real debugging time.

---

## INPUT DATA (provide all of this)

| # | Input | Format / guidance | Öresund example |
|---|-------|-------------------|-----------------|
| 1 | **REGION_NAME** | Human name of the water body | "the Öresund strait" |
| 2 | **BBOX** | WGS84 `lonMin, latMin, lonMax, latMax`. Aim for a near-square window 20–60 km per side — at your latitude 1° of longitude ≈ 111.3 × cos(lat) km. The window maps to a 1200×1200-unit world square. | `12.44, 55.82, 12.94, 56.10` (≈31×31 km) |
| 3 | **PLACES** | 6–12 coastal cities/towns/villages: `name, lat, lon, kind (city/town/village)`. Must be on land. | Helsingborg 56.046/12.694 city; Kyrkbacken 55.9075/12.6795 village; … |
| 4 | **NAMED SHALLOWS** | 3–6 named banks/shoals/reefs with approximate lat/lon, or write "snap markers to the shallowest local crests the depth grid finds". | Disken 56.02/12.66; Grollegrund 56.10/12.63; … |
| 5 | **WRECK / POI SOURCES** | 1–3 URLs of regional wreck databases or dive-site lists. Coordinate databases (bulk JSON/map APIs) beat narrative dive pages. If none exist, write "research historical wrecks; every position without charted coordinates must be flagged approximate". | oresundsdykning.se/vrak2, vragguiden.dk, vrag.dk |
| 6 | **DEPTH SANITY POINTS** | 4–8 checkpoints from a real nautical chart: `lat, lon, expected depth range (m)`. The fetched grid must reproduce these before being accepted. | "neck trench 25–45 m", "Disken bank 4–9 m", … |
| 7 | **VERTICAL EXAGGERATION** | Default: seabed factor = 90 ÷ (max regional depth in m) world-units/m, so the deepest point lands ≈ −90; land factor ≈ half the seabed factor, soft-compressed (tanh) to a +35 ceiling — never hard-clamped. | seabed ×1.8, land ×0.9, ceiling 33.5 |
| 8 | **LOOK & MOOD** | Optional palette/atmosphere override. Default: sun-baked drained mud + salt flats, warm low late-afternoon sun, hazy horizon. | default |
| 9 | **NAME FLAVOR** | Language(s)/culture for site descriptions. | Swedish/Danish |

Data sources the pipeline should use (global coverage):
- **Bathymetry**: GEBCO (global, ~450 m) via an ERDDAP `griddap` JSON query — one HTTP GET returns the grid. Where available, merge a finer regional DTM on top (Europe: EMODnet Bathymetry ~115 m; sea cells from the fine grid, land + gaps from GEBCO). Save as a committed `bathymetry.json` with a re-runnable `scripts/build-bathymetry.mjs`.
- **Satellite imagery**: EOX Sentinel-2 cloudless WMS GetMap (global, keyless) at 4096², Esri World Imagery export as fallback. Committed `satellite-land.jpg` + meta (source, attribution, bbox) via `scripts/build-satellite.mjs`.

---

## GOAL TEXT (substitute {…} and paste into /goal)

Coordinate a team of specialized sub-agents to build a local, interactive 3D web
application visualizing the completely drained seabed of **{REGION_NAME}**
({BBOX}), built ONLY from real data. Act as Lead Orchestrator with disjoint file
ownership per agent and binding interface contracts written down before parallel
work starts (a thin orchestrator-owned `main.js` integrates everything).

**Sub-agents and division:**
1. **Topography & Data Agent** — fetch real bathymetry (GEBCO via ERDDAP JSON;
   merge a finer regional DTM if one covers the region) into a committed
   `bathymetry.json` with a reproducible build script; reject any grid that fails
   the DEPTH SANITY POINTS: {SANITY_POINTS}. Build the heightmap from the grid
   with documented vertical exaggeration ({EXAGGERATION}; tanh-compress land,
   never hard-clamp). Export `geoToWorld(lat, lon)` and author ALL site data in
   real WGS84: PLACES ({PLACES}), named shallows ({SHALLOWS}), and WRECKS.
2. **Wreck/POI Researcher Agent** — harvest EVERY wreck from {WRECK_SOURCES}
   into a JSON dataset (name, type, years, depth, position, story, source URL);
   cross-reference all sources; prefer coordinate databases over narrative pages;
   compute a bestPosition and an insideWindow flag per wreck. NEVER fabricate
   coordinates: entries placeable only from location text are marked
   `approximate: true`; entries with irreconcilable source conflicts are excluded
   with a note. Borderline wrecks (just outside the bbox) are included clamped to
   the map edge, honestly labeled.
3. **3D Rendering Agent** — Three.js scene: warm low sun with PCF soft shadow
   maps sized to the terrain, hemisphere fill strong enough that shadow pools
   stay readable, haze-matched fog, ACES tone mapping, OrbitControls (full 360°
   orbit, zoom, map-plane pan). Terrain mesh at 512² from the heightmap, casting
   AND receiving shadows. Type-specific low-poly-but-realistic wreck models
   driven by each vessel's real type (steamers with funnels/derricks, skeletal
   pre-1910 wooden ships with exposed ribs, trawlers, barges…), deterministic
   per-id seeding, ≤1500 triangles each — models cast shadows but must NOT
   receive them (terrain-scale shadow maps self-shadow small geometry black).
   An animated water plane: a "Water" toggle refills the sea to y=0 over ~2.5 s
   (interruptible ease-in-out tween, gentle sine swell, transparent teal) and
   drains it away when switched off.
4. **Textures & UI Agent** — terrain material: vertex-color bands tuned to the
   REAL depth histogram of the fetched grid (shallow shelf ≠ land tones, salt
   crust on flat shallows, darkest wet sediment in the deeps, tide-line mark at
   the former waterline, cliff tones on steep faces); satellite imagery draped
   ONLY above the waterline via a shader blend with world-position-derived UVs
   and a mandatory graceful fallback if the asset is missing. UI overlay: glass
   "expedition instrument panel" with toggles for each marker layer + place
   names + Water (default: drained), name-label sprites on every wreck (with a
   "≈" prefix and hollow beacon for approximate positions), site counts, control
   hints, and a data-credits line attributing every source.

**Technical constraints & output:**
- Vanilla Vite + Three.js, exactly two dependencies, plain ES modules, fully
  runnable locally: `npm install && npm run dev`. No Math.random anywhere —
  everything seeded and deterministic. Heightmap generation < 1 s.
- Verification is part of the goal, not optional: (a) node assertions — every
  PLACE on land, every wreck below sea level and flat-footed (or honestly noted
  on a real slope), shallows are local highs, determinism, sanity points pass;
  (b) in-browser checks — zero console errors, every toggle tested through the
  real DOM, the water rise/drain cycle observed, and the satellite orientation
  proven by a recognizable landmark rendering over its own real shape;
  (c) screenshots of the verified result delivered.
- Deliver the complete code layout and the single terminal command to install
  and run.

**Hard-won pitfalls — avoid these explicitly:**
1. Never hard-clamp land elevation (creates plateau slabs); tanh-compress.
2. Tune color bands to the real depth distribution, not assumed ranges.
3. Small models must not receive terrain-scale shadows (self-shadow → black).
4. Vertex-colored materials: keep material color white and palettes light
   enough (linear lightness ≳ 0.2) to survive weathering; a too-high luminance
   floor flattens everything instead.
5. Synthetic cliffs need ≥4–6 grid cells of horizontal run-out or they smear;
   a "gentle" slope needs ~10× a cliff's run-out to read as gentle.
6. Derive satellite UVs from world position and verify against a landmark —
   don't trust mesh UV orientation.
7. Missing-asset loads (satellite jpg, meta JSON) need graceful fallbacks so
   the app never blanks.
8. When agent messages cross mid-flight, re-state the full policy delta rather
   than assuming the last instruction landed; keep one owner per file per round.
