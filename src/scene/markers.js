import * as THREE from 'three';

// Shared with src/ui/overlay.css — keep these three hexes in sync.
const REEF_ACCENT = '#2fb8a6';
const WRECK_ACCENT = '#e0703a';
const PLACE_ACCENT = '#c99a53';

// HULL_PALETTE feeds applyHullWeathering() (small-boat hulls) and needs real
// lightness for the same reason as the palettes below — the weathering pass
// only ever darkens further on top of the base, so a base that's already
// dark clamps flat instead of showing tonal variation.
const HULL_PALETTE = ['#b3735e', '#a46b5c', '#c07b5e', '#a87965'];
const DECK_PALETTE = ['#c9c2b0', '#9aa3a0', '#b6ad98', '#8c9490'];
const RUST_TRIM = ['#c96a35', '#8a4a26', '#d4823f'];
const REEF_PALETTE = ['#e8e2d4', '#cfc7b8', '#d9b8ad', '#bfb6a4', '#e2cabf'];

// Additional hull palettes for type-specific wreck weathering. Steel hulls
// read as faded rust-red/oxide (same family as the old HULL_PALETTE boxes);
// wooden hulls as mid grey-brown weathered timber; patrol as cool grey-green.
// These are deliberately brighter than a flat, unweathered material color
// would need to be, since applyHullWeathering() only ever darkens further.
const WOOD_HULL_PALETTE = ['#ae9b80', '#a1917c', '#b9a585', '#a59482'];
const STEEL_HULL_PALETTE = ['#b68a67', '#ad7e5b', '#bd8e73', '#9f8266'];
const CONCRETE_PALETTE = ['#8c8a83', '#78766f', '#96938a'];
const PATROL_PALETTE = ['#81958e', '#7a8881', '#8b9e9a'];

/**
 * Builds the marker layers from loader-provided site records (see
 * src/pack-loader.js convertSites for the record shapes — positions are
 * already world [x, z]).
 * @param heightmap pack-scaled heightmap (for ground heights)
 * @param sites `{ reefs, wrecks, places }` marker records
 */
export function createMarkers(heightmap, sites) {
  const { reefs = [], wrecks = [], places = [] } = sites;
  const group = new THREE.Group();
  group.name = 'markers';

  const reefsGroup = new THREE.Group();
  reefsGroup.name = 'reefs';
  const wrecksGroup = new THREE.Group();
  wrecksGroup.name = 'wrecks';
  const placesGroup = new THREE.Group();
  placesGroup.name = 'places';

  for (const reef of reefs) {
    reefsGroup.add(buildReef(reef, heightmap));
  }
  for (const wreck of wrecks) {
    wrecksGroup.add(buildWreck(wreck, heightmap));
  }
  for (const place of places) {
    placesGroup.add(buildPlace(place, heightmap));
  }

  group.add(reefsGroup, wrecksGroup, placesGroup);

  return {
    group,
    setReefsVisible(v) {
      reefsGroup.visible = v;
    },
    setWrecksVisible(v) {
      wrecksGroup.visible = v;
    },
    setPlacesVisible(v) {
      placesGroup.visible = v;
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic PRNG — seeded from site id, no Math.random anywhere.
// ---------------------------------------------------------------------------

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// ---------------------------------------------------------------------------
// Name label sprites — canvas-rendered pill with a translucent dark fill,
// thin accent border, and ivory text. Rendered at 4x and billboarded via
// THREE.Sprite so mipmaps keep it crisp while staying legible from afar.
// ---------------------------------------------------------------------------

const LABEL_FONT_FAMILY = '"Fraunces", Georgia, "Times New Roman", serif';

function createLabelSprite(text, options = {}) {
  const {
    accentColor = '#e0703a',
    textColor = '#f1ead9',
    fontSizePx = 30,
    worldHeight = 14,
  } = options;

  const dpr = 4;
  const fontPx = fontSizePx * dpr;
  const paddingX = fontPx * 0.55;
  const paddingY = fontPx * 0.4;

  // Canvas has no reliable cross-browser letter-spacing API for fillText,
  // so thin spaces between uppercase letters stand in for a small-caps,
  // letter-spaced look.
  const spaced = text.toUpperCase().split('').join(' ');
  const fontSpec = `600 ${fontPx}px ${LABEL_FONT_FAMILY}`;

  const measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = fontSpec;
  const textWidth = measureCtx.measureText(spaced).width;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(textWidth + paddingX * 2);
  canvas.height = Math.ceil(fontPx + paddingY * 2);
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const radius = h / 2;

  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(w - radius, 0);
  ctx.arcTo(w, 0, w, radius, radius);
  ctx.lineTo(w, h - radius);
  ctx.arcTo(w, h, w - radius, h, radius);
  ctx.lineTo(radius, h);
  ctx.arcTo(0, h, 0, h - radius, radius);
  ctx.lineTo(0, radius);
  ctx.arcTo(0, 0, radius, 0, radius);
  ctx.closePath();
  ctx.fillStyle = 'rgba(14, 16, 14, 0.72)';
  ctx.fill();
  ctx.lineWidth = Math.max(2, fontPx * 0.045);
  ctx.strokeStyle = accentColor;
  ctx.stroke();

  ctx.font = fontSpec;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(spaced, w / 2, h / 2 + fontPx * 0.04);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldHeight * (w / h), worldHeight, 1);
  return sprite;
}

// ---------------------------------------------------------------------------
// Beacon pins
// ---------------------------------------------------------------------------

function buildBeacon(x, z, groundY, color, { approximate = false } = {}) {
  const beacon = new THREE.Group();
  beacon.name = 'beacon';

  const height = 30;
  const stemGeo = new THREE.CylinderGeometry(0.35, 0.35, height, 6);
  const stemMat = new THREE.MeshStandardMaterial({
    color: '#cfc6b4',
    roughness: 0.8,
    metalness: 0.1,
  });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = groundY + height / 2;
  stem.castShadow = true;

  // Approximate-position sites render hollow/wireframe with dimmer emissive,
  // so an estimated location reads as tentative at a glance.
  const headGeo = new THREE.OctahedronGeometry(2.4, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: approximate ? 0.45 : 0.85,
    roughness: 0.35,
    metalness: 0.1,
    wireframe: approximate,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = groundY + height;
  head.castShadow = !approximate;

  beacon.add(stem, head);
  return beacon;
}

// ---------------------------------------------------------------------------
// Wrecks — type-specific hull builders
// ---------------------------------------------------------------------------

function smoothstep01(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Deterministic hash of two ints -> [0,1). Used for per-vertex weathering so
// the pattern is stable regardless of vertex iteration order (a sequential
// rng() call per vertex would depend on traversal order instead).
function hashFloat(a, b, salt) {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Longitudinal hull envelope: how the cross-section scales/rises along the
// ship's length. t: -1 (stern) .. 0 (midship) .. 1 (bow).
function hullEnvelope(t, opts = {}) {
  const {
    bowRake = 0.9,
    sternStyle = 'counter', // 'counter' | 'transom' | 'pointed'
    taperStart = 0.32,
    rocker = 0.5,
    sheer = 0.4,
  } = opts;
  const absT = Math.abs(t);
  let beamScale = 1;
  if (absT > taperStart) {
    const bt = (absT - taperStart) / (1 - taperStart);
    if (t > 0) {
      beamScale = 1 - Math.pow(bt, 1.5) * bowRake; // raked bow
    } else if (sternStyle === 'transom') {
      beamScale = 1 - Math.pow(bt, 3) * 0.5;
    } else if (sternStyle === 'pointed') {
      beamScale = 1 - Math.pow(bt, 1.4) * 0.88;
    } else {
      beamScale = 1 - Math.pow(bt, 1.9) * 0.78; // rounded counter stern
    }
  }
  beamScale = Math.max(beamScale, 0.03);
  const deckRise = (t > 0 ? Math.pow(t, 2) : Math.pow(-t, 2) * 0.35) * sheer;
  const keelRise = t > 0.45 ? Math.pow((t - 0.45) / 0.55, 2) * rocker : 0;
  return { beamScale, deckRise, keelRise };
}

// Half cross-section width multiplier from keel (v=0) to deck (v=1).
// roundness 0 = boxy/rectangular hull, 1 = fully rounded bilge + tumblehome.
function hullCrossSectionWidth(v, roundness) {
  const bilge = smoothstep01(0, 0.25, v);
  const tumble = 1 - smoothstep01(0.72, 1, v) * 0.14;
  const rounded = bilge * tumble;
  return 1 * (1 - roundness) + rounded * roundness;
}

// Deforms a BoxGeometry into a raked/tapered hull silhouette. Used for hull
// types that don't need a hole cut in them (steel hulls, small boats, patrol
// boats, landing craft).
function buildDeformedHull(length, beam, height, opts = {}) {
  const { lengthSegs = 14, heightSegs = 4, beamSegs = 6, roundness = 1 } = opts;
  const geo = new THREE.BoxGeometry(length, height, beam, lengthSegs, heightSegs, beamSegs);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = x / (length / 2);
    const { beamScale, deckRise, keelRise } = hullEnvelope(t, opts);
    const v = (y + height / 2) / height;
    const widthMul = hullCrossSectionWidth(v, roundness);

    let newY = y + THREE.MathUtils.lerp(keelRise, deckRise, v) * height;
    if (roundness > 0 && v < 0.12) {
      newY += ((0.12 - v) / 0.12) * height * 0.05 * roundness; // rounds the keel edge
    }
    pos.setY(i, newY);
    pos.setZ(i, z * beamScale * widthMul);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Half cross-section profile (v = height fraction 0..1 keel->deck, u = width
// fraction 0..1) for wooden hulls — rounder bilge, modest tumblehome.
const WOOD_PROFILE = [
  [0.0, 0.0],
  [0.05, 0.32],
  [0.2, 0.78],
  [0.42, 1.0],
  [0.75, 0.9],
  [1.0, 0.78],
];

// Custom lofted hull (built directly from station cross-sections rather than
// deforming a box) so a hull-side gap can be cut cleanly for storm-wrecked
// ruins, with rib frames exposed behind it.
function buildLoftedWoodenHull(length, beam, height, opts = {}) {
  const {
    stations = 16,
    bowRake = 0.85,
    sternStyle = 'pointed',
    rocker = 0.45,
    sheer = 0.35,
    breakSide = null, // -1 port, 1 starboard, or null for an intact hull
    breakRange = [0.06, 0.24], // station-t window where the side skin is omitted
  } = opts;

  const halfLength = length / 2;
  const halfBeam = beam / 2;
  const profCount = WOOD_PROFILE.length;
  const positions = [];
  const ring = [];

  for (let s = 0; s < stations; s++) {
    const t = (s / (stations - 1)) * 2 - 1;
    const { beamScale, deckRise, keelRise } = hullEnvelope(t, { bowRake, sternStyle, rocker, sheer });
    const x = t * halfLength;
    const stationRing = [[], []];
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      for (let p = 0; p < profCount; p++) {
        const [v, u] = WOOD_PROFILE[p];
        const z = sign * u * halfBeam * beamScale;
        const y = -height / 2 + v * height + THREE.MathUtils.lerp(keelRise, deckRise, v) * height;
        positions.push(x, y, z);
        stationRing[side].push(positions.length / 3 - 1);
      }
    }
    ring.push(stationRing);
  }

  // Triangle winding: port (side 0) and starboard (side 1) need opposite
  // winding for both to face outward, since mirroring z does not by itself
  // flip the triangle orientation relative to the camera.
  const indices = [];
  for (let s = 0; s < stations - 1; s++) {
    const tMid = ((s + 0.5) / (stations - 1)) * 2 - 1;
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const broken = breakSide === sign && tMid >= breakRange[0] && tMid <= breakRange[1];
      if (broken) continue;
      for (let p = 0; p < profCount - 1; p++) {
        const a = ring[s][side][p];
        const b = ring[s][side][p + 1];
        const c = ring[s + 1][side][p + 1];
        const d = ring[s + 1][side][p];
        if (side === 1) {
          indices.push(a, c, b, a, d, c);
        } else {
          indices.push(a, b, c, a, c, d);
        }
      }
    }
    const topP = profCount - 1;
    const a = ring[s][0][topP];
    const b = ring[s][1][topP];
    const c = ring[s + 1][1][topP];
    const d = ring[s + 1][0][topP];
    indices.push(a, b, c, a, c, d); // deck cap between the port/starboard rails
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// A curved rib frame (half-ring) for exposed-skeleton ruin wrecks.
function buildRibFrame(halfBeam, height) {
  const radius = halfBeam * 0.95;
  const tube = Math.max(0.12, halfBeam * 0.045);
  const geo = new THREE.TorusGeometry(radius, tube, 5, 10, Math.PI);
  geo.rotateZ(-Math.PI / 2); // start the half-ring at the bottom so it opens upward
  geo.rotateY(Math.PI / 2); // stand it up to sweep across the beam (Y-Z plane)
  geo.translate(0, -height * 0.05, 0);
  return geo;
}

// Writes rust-streaked vertex colors onto a hull geometry: darker toward the
// old waterline/keel, with vertical streak bands (seeded hash, no textures)
// fading down from the deck line.
//
// Minimum HSL lightness any weathered vertex color is allowed to fall to.
// Set well below the base palettes' own lightness so it only backstops the
// rare worst-case (bottom + streak stacking on an already-dark swatch)
// instead of clamping the whole hull to one flat tone.
const HULL_LUMINANCE_FLOOR = 0.12;

function applyHullWeathering(geometry, baseColorHex) {
  const pos = geometry.attributes.position;
  const base = new THREE.Color(baseColorHex);
  const rustDark = new THREE.Color('#6c533f');
  const streakDark = new THREE.Color('#625244');

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanY = maxY - minY || 1;
  const streakSpacing = spanY * 0.18 + 0.6;

  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = (y - minY) / spanY;

    tmp.copy(base);
    const bottomFactor = 1 - smoothstep01(0.15, 0.55, t);
    tmp.lerp(rustDark, bottomFactor * 0.4);

    const band = Math.round(x / streakSpacing);
    const streakSeed = hashFloat(band, Math.round(pos.getZ(i) * 3), 71);
    if (streakSeed > 0.45) {
      const strength = (streakSeed - 0.45) / 0.55;
      const topFade = smoothstep01(0.4, 1.0, t); // streak is strongest at the deck line, fading down
      tmp.lerp(streakDark, strength * topFade * 0.35);
    }

    tmp.getHSL(hsl);
    if (hsl.l < HULL_LUMINANCE_FLOOR) {
      tmp.setHSL(hsl.h, hsl.s, HULL_LUMINANCE_FLOOR);
    }

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function makeHullMaterial(smooth) {
  return new THREE.MeshStandardMaterial({
    // Vertex colors carry the actual hull tone; keep the material color at
    // white (the default) so it doesn't multiply against and darken them.
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.92,
    metalness: smooth ? 0.25 : 0.1,
    flatShading: !smooth,
  });
}

function addBox(target, { w, h, d, x, y, z, rotY = 0, material }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  if (rotY) mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  target.add(mesh);
  return mesh;
}

function addCylinder(target, { rTop, rBottom, h, x, y, z, radialSegments = 8, material }) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, radialSegments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  target.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// Per-type model builders. Each returns a Group sized to (length, beam,
// height) and centered on the hull's local origin, ready to drop into the
// wreck's listGroup (which already carries the seeded roll + burial sink).
// ---------------------------------------------------------------------------

// Smooth-hulled steel steamer/coaster/cargo ship: raked bow, counter stern,
// bridge deckhouse, one raked funnel, 1-2 masts with derrick booms, hatch
// coamings. Also the base shape for the paddle steamer and the fallback.
function buildSteelSteamerModel(rng, length, beam, height, opts = {}) {
  const { funnelHeightMul = 1, funnelRadiusMul = 1 } = opts;
  const group = new THREE.Group();

  const hullColor = pick(rng, STEEL_HULL_PALETTE);
  const hullGeo = buildDeformedHull(length, beam, height, {
    lengthSegs: 16, heightSegs: 4, beamSegs: 6, roundness: 1,
    bowRake: 0.88, sternStyle: 'counter', rocker: 0.4, sheer: 0.32,
  });
  applyHullWeathering(hullGeo, hullColor);
  const hull = new THREE.Mesh(hullGeo, makeHullMaterial(true));
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  const deckMat = new THREE.MeshStandardMaterial({ color: pick(rng, DECK_PALETTE), roughness: 0.85, metalness: 0.15 });
  const rustMat = new THREE.MeshStandardMaterial({ color: pick(rng, RUST_TRIM), roughness: 0.7, metalness: 0.35 });

  // Bridge deckhouse, set aft of amidships (typical of the era's freighters),
  // with a darker inset band suggesting a row of portholes.
  const bridgeW = length * 0.15;
  const bridgeH = height * 0.85;
  const bridgeD = beam * 0.62;
  const bridgeX = -length * 0.08;
  addBox(group, { w: bridgeW, h: bridgeH, d: bridgeD, x: bridgeX, y: height / 2 + bridgeH / 2, z: 0, material: deckMat });
  addBox(group, {
    w: bridgeW * 0.92, h: bridgeH * 0.18, d: bridgeD * 1.01,
    x: bridgeX, y: height / 2 + bridgeH * 0.4, z: 0,
    material: rustMat,
  });

  // One raked funnel just aft of the bridge.
  const funnelH = height * (1.1 + rng() * 0.3) * funnelHeightMul;
  const funnel = addCylinder(group, {
    rTop: beam * 0.05 * funnelRadiusMul, rBottom: beam * 0.065 * funnelRadiusMul, h: funnelH, radialSegments: 10,
    x: bridgeX - length * 0.05, y: height / 2 + bridgeH + funnelH / 2, z: 0,
    material: rustMat,
  });
  funnel.rotation.z = THREE.MathUtils.degToRad(6);

  // 1-2 masts with derrick booms, fore and aft of the bridge.
  const mastCount = rng() < 0.5 ? 1 : 2;
  const mastXs = mastCount === 1 ? [length * 0.22] : [length * 0.28, -length * 0.32];
  for (const mx of mastXs) {
    const mastH = height * (1.5 + rng() * 0.4);
    addCylinder(group, {
      rTop: beam * 0.018, rBottom: beam * 0.022, h: mastH, radialSegments: 6,
      x: mx, y: height / 2 + mastH / 2, z: 0, material: rustMat,
    });
    const boomLen = length * (0.12 + rng() * 0.05);
    const boom = addCylinder(group, {
      rTop: beam * 0.012, rBottom: beam * 0.012, h: boomLen, radialSegments: 5,
      x: mx + Math.sign(mx) * boomLen * 0.4,
      y: height / 2 + mastH * 0.35, z: beam * 0.15 * (rng() < 0.5 ? 1 : -1),
      material: rustMat,
    });
    boom.rotation.z = THREE.MathUtils.degToRad(55 + rng() * 20) * Math.sign(mx);
  }

  // 1-2 raised cargo hatch coamings on the open deck.
  const hatchCount = 1 + Math.floor(rng() * 2);
  const hatchXs = hatchCount === 1 ? [length * 0.15] : [length * 0.24, -length * 0.02];
  for (const hx of hatchXs) {
    addBox(group, { w: length * 0.13, h: height * 0.12, d: beam * 0.5, x: hx, y: height / 2 + height * 0.06, z: 0, material: deckMat });
  }

  return group;
}

// Cimbria (1858 paddle steamer): slimmer hull, taller thin funnel, and a
// half-cylinder paddle box housing on each side amidships.
function buildPaddleSteamerModel(rng, length, beam, height) {
  const slimBeam = beam * 0.82;
  const group = buildSteelSteamerModel(rng, length, slimBeam, height, {
    funnelHeightMul: 1.35, funnelRadiusMul: 0.75,
  });

  const boxMat = new THREE.MeshStandardMaterial({ color: pick(rng, RUST_TRIM), roughness: 0.75, metalness: 0.3 });
  const boxRadius = height * 0.55;
  const boxWidth = length * 0.16;
  for (const side of [-1, 1]) {
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(boxRadius, boxRadius, boxWidth, 10, 1, false, -Math.PI / 2, Math.PI),
      boxMat
    );
    housing.rotation.x = Math.PI / 2; // stand the drum's axis across the beam
    housing.position.set(0, height * 0.15, side * (slimBeam / 2 + boxRadius * 0.55));
    housing.castShadow = true;
    housing.receiveShadow = true;
    group.add(housing);
  }
  return group;
}

// Wooden sailing ships (schooner/galeas/barque/sailing ship). Wrecks that
// sank before 1910 render as storm ruins: one seeded mast survives
// (standing or leaning), the rest are stubs, and a hull-side gap exposes
// curved rib frames.
function buildWoodenSailingShipModel(rng, length, beam, height, wreck) {
  const group = new THREE.Group();
  const isRuin = Boolean(wreck.sunkYear) && wreck.sunkYear < 1910;
  const breakSide = isRuin ? (rng() < 0.5 ? -1 : 1) : null;
  const breakCenter = -0.15 + rng() * 0.3;
  const breakRange = [breakCenter - 0.09, breakCenter + 0.09];

  const hullColor = pick(rng, WOOD_HULL_PALETTE);
  const hullGeo = buildLoftedWoodenHull(length, beam, height, {
    stations: 16, bowRake: 0.82, sternStyle: pick(rng, ['pointed', 'transom']),
    rocker: 0.42, sheer: 0.3,
    breakSide, breakRange,
  });
  applyHullWeathering(hullGeo, hullColor);
  const hull = new THREE.Mesh(hullGeo, makeHullMaterial(true));
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  if (isRuin) {
    const ribMat = new THREE.MeshStandardMaterial({ color: '#372a1d', roughness: 0.95, metalness: 0, flatShading: true });
    const ribCount = 4 + Math.floor(rng() * 3); // 4..6
    const halfBeam = beam / 2;
    for (let i = 0; i < ribCount; i++) {
      const rib = new THREE.Mesh(buildRibFrame(halfBeam, height), ribMat);
      const rt = breakRange[0] + ((i + 0.5) / ribCount) * (breakRange[1] - breakRange[0]);
      rib.position.x = rt * (length / 2);
      rib.castShadow = true;
      rib.receiveShadow = true;
      group.add(rib);
    }
  }

  // Bowsprit: thin spar angled up and forward from the bow.
  const bowspritMat = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.9, metalness: 0 });
  const bowspritLen = length * 0.22;
  const bowsprit = addCylinder(group, {
    rTop: beam * 0.015, rBottom: beam * 0.02, h: bowspritLen, radialSegments: 5,
    x: length / 2 - bowspritLen * 0.3, y: height / 2 + height * 0.1, z: 0,
    material: bowspritMat,
  });
  bowsprit.rotation.z = THREE.MathUtils.degToRad(-78);

  // Masts: 2-3, with one seeded survivor when ruined (standing/leaning) and
  // the rest reduced to broken stubs.
  const mastCount = 2 + Math.floor(rng() * 2);
  const survivorIdx = Math.floor(rng() * mastCount);
  const mastMat = new THREE.MeshStandardMaterial({ color: '#332720', roughness: 0.9, metalness: 0 });
  for (let i = 0; i < mastCount; i++) {
    const mx = length * (0.28 - i * ((0.5 / Math.max(1, mastCount - 1)) * 1.1));
    const fullHeight = height * (2.4 + rng() * 0.6);
    const stub = isRuin && i !== survivorIdx;
    const mastH = stub ? fullHeight * (0.08 + rng() * 0.08) : fullHeight;
    const mast = addCylinder(group, {
      rTop: beam * 0.02, rBottom: beam * 0.028, h: mastH, radialSegments: 6,
      x: mx, y: height / 2 + mastH / 2, z: 0, material: mastMat,
    });
    if (isRuin && i === survivorIdx) {
      mast.rotation.z = THREE.MathUtils.degToRad(8 + rng() * 10) * (rng() < 0.5 ? -1 : 1);
    }
  }

  return group;
}

// Small modern boats (fishing vessel/motorboat/vessel): trawler shape with a
// wheelhouse aft and either an A-frame gantry or a boom over the deck.
function buildSmallBoatModel(rng, length, beam, height) {
  const group = new THREE.Group();
  const hullColor = pick(rng, HULL_PALETTE);
  const hullGeo = buildDeformedHull(length, beam, height, {
    lengthSegs: 10, heightSegs: 3, beamSegs: 5, roundness: 1,
    bowRake: 0.8, sternStyle: 'transom', rocker: 0.3, sheer: 0.28,
  });
  applyHullWeathering(hullGeo, hullColor);
  const hull = new THREE.Mesh(hullGeo, makeHullMaterial(false));
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  const cabinMat = new THREE.MeshStandardMaterial({ color: pick(rng, DECK_PALETTE), roughness: 0.8, metalness: 0.1, flatShading: true });
  const cabinW = length * 0.22;
  const cabinH = height * 0.9;
  addBox(group, { w: cabinW, h: cabinH, d: beam * 0.7, x: -length * 0.28, y: height / 2 + cabinH / 2, z: 0, material: cabinMat });

  const rustMat = new THREE.MeshStandardMaterial({ color: pick(rng, RUST_TRIM), roughness: 0.75, metalness: 0.3 });
  if (rng() < 0.5) {
    const legH = height * 1.3;
    for (const side of [-1, 1]) {
      const leg = addCylinder(group, {
        rTop: beam * 0.02, rBottom: beam * 0.02, h: legH, radialSegments: 5,
        x: length * 0.08, y: height / 2 + (legH / 2) * 0.9, z: side * beam * 0.28,
        material: rustMat,
      });
      leg.rotation.x = side * THREE.MathUtils.degToRad(12);
    }
  } else {
    const boomLen = length * 0.3;
    const boom = addCylinder(group, {
      rTop: beam * 0.02, rBottom: beam * 0.02, h: boomLen, radialSegments: 5,
      x: length * 0.05, y: height / 2 + cabinH + boomLen * 0.3, z: 0,
      material: rustMat,
    });
    boom.rotation.z = THREE.MathUtils.degToRad(60);
  }

  return group;
}

// K7 Bevakningsfartyg: grey patrol boat, low superstructure, small mast.
function buildPatrolBoatModel(rng, length, beam, height) {
  const group = new THREE.Group();
  const hullColor = pick(rng, PATROL_PALETTE);
  const hullGeo = buildDeformedHull(length, beam, height, {
    lengthSegs: 12, heightSegs: 3, beamSegs: 5, roundness: 0.85,
    bowRake: 0.85, sternStyle: 'transom', rocker: 0.35, sheer: 0.3,
  });
  applyHullWeathering(hullGeo, hullColor);
  const hull = new THREE.Mesh(hullGeo, makeHullMaterial(true));
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  const superMat = new THREE.MeshStandardMaterial({ color: pick(rng, PATROL_PALETTE), roughness: 0.8, metalness: 0.2 });
  const superH = height * 0.55; // deliberately low profile
  addBox(group, { w: length * 0.3, h: superH, d: beam * 0.66, x: -length * 0.02, y: height / 2 + superH / 2, z: 0, material: superMat });

  const mastH = height * 1.6;
  addCylinder(group, {
    rTop: beam * 0.015, rBottom: beam * 0.02, h: mastH, radialSegments: 5,
    x: -length * 0.05, y: height / 2 + superH + mastH / 2, z: 0, material: superMat,
  });

  return group;
}

// Landstigningsbåten: boxy landing craft with a flat bow ramp angled open
// into the mud.
function buildLandingCraftModel(rng, length, beam, height) {
  const group = new THREE.Group();
  const hullColor = pick(rng, STEEL_HULL_PALETTE);
  const hullGeo = buildDeformedHull(length, beam, height, {
    lengthSegs: 10, heightSegs: 2, beamSegs: 4, roundness: 0.15,
    bowRake: 0.15, sternStyle: 'transom', rocker: 0.05, sheer: 0.05,
  });
  applyHullWeathering(hullGeo, hullColor);
  const hull = new THREE.Mesh(hullGeo, makeHullMaterial(false));
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  const rampMat = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.9, metalness: 0.15, flatShading: true });
  const ramp = addBox(group, { w: length * 0.16, h: height * 0.08, d: beam * 0.94, x: length / 2 - length * 0.04, y: -height * 0.05, z: 0, material: rampMat });
  ramp.rotation.z = THREE.MathUtils.degToRad(-24);

  const railMat = new THREE.MeshStandardMaterial({ color: pick(rng, RUST_TRIM), roughness: 0.8, metalness: 0.3 });
  for (const side of [-1, 1]) {
    addBox(group, { w: length * 0.7, h: height * 0.14, d: beam * 0.03, x: -length * 0.05, y: height / 2 + height * 0.07, z: side * beam * 0.48, material: railMat });
  }

  return group;
}

// Cementbåten / Anemonvraket: a plain weathered concrete caisson block with
// cracked, jittered edges — no masts, no superstructure.
function buildConcreteCaissonModel(rng, length, beam, height) {
  const geo = new THREE.BoxGeometry(length, height, beam, 6, 3, 4);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const jitter = hashFloat(Math.round(x * 3), Math.round(y * 3) ^ Math.round(z * 3), 19) - 0.5;
    const edgeFactor = Math.min(1, Math.pow(Math.abs(x) / (length / 2), 3) + Math.pow(Math.abs(z) / (beam / 2), 3));
    const amt = edgeFactor * height * 0.05;
    pos.setX(i, x + jitter * amt);
    pos.setY(i, y + jitter * amt * 0.6);
    pos.setZ(i, z + jitter * amt);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  applyHullWeathering(geo, pick(rng, CONCRETE_PALETTE));
  const mesh = new THREE.Mesh(geo, makeHullMaterial(false));
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

// ---------------------------------------------------------------------------
// Wreck type -> builder dispatch. Every `type` string in sites.js resolves
// here (see the mapping in the team report); unmatched types fall back to
// the generic steel-steamer builder rather than throwing.
// ---------------------------------------------------------------------------

function classifyWreckType(type) {
  const t = (type || '').toLowerCase();
  if (t === 'paddle steamer') return 'paddle-steamer';
  if (t.includes('concrete')) return 'concrete';
  if (t === 'landing craft') return 'landing-craft';
  if (t.includes('patrol') || t.includes('guard')) return 'patrol';
  if (t.includes('steam') || t === 'cargo ship') return 'steel-steamer';
  if (t.includes('sailing') || t.includes('schooner') || t.includes('barque') || t.includes('galeas')) return 'wooden';
  if (t.includes('vessel') || t.includes('boat')) return 'small-boat';
  console.warn(`[markers] unrecognized wreck type "${type}", using steel steamer fallback`);
  return 'steel-steamer';
}

function buildWreckModel(wreck, rng, length, beam, height) {
  switch (classifyWreckType(wreck.type)) {
    case 'paddle-steamer':
      return buildPaddleSteamerModel(rng, length, beam, height);
    case 'concrete':
      return buildConcreteCaissonModel(rng, length, beam, height);
    case 'landing-craft':
      return buildLandingCraftModel(rng, length, beam, height);
    case 'patrol':
      return buildPatrolBoatModel(rng, length, beam, height);
    case 'wooden':
      return buildWoodenSailingShipModel(rng, length, beam, height, wreck);
    case 'small-boat':
      return buildSmallBoatModel(rng, length, beam, height);
    default:
      return buildSteelSteamerModel(rng, length, beam, height);
  }
}

function buildWreck(wreck, heightmap) {
  const rng = mulberry32(hashString(wreck.id));
  const [x, z] = wreck.position;
  const groundY = heightmap.getHeightAt(x, z);

  const length = wreck.length;
  const beam = length * (0.18 + rng() * 0.05);
  const height = length * (0.14 + rng() * 0.03);

  const wreckGroup = new THREE.Group();
  wreckGroup.name = `wreck-${wreck.id}`;
  wreckGroup.position.set(x, groundY, z);
  wreckGroup.rotation.y = wreck.heading;

  // Half-buried: sink the hull down into the mud.
  const sinkDepth = height * (0.3 + rng() * 0.18);

  const listGroup = new THREE.Group();
  const rollDeg = 4 + rng() * 16; // few degrees .. ~20 degrees
  listGroup.rotation.z = THREE.MathUtils.degToRad(rollDeg) * (rng() < 0.5 ? -1 : 1);
  listGroup.position.y = height / 2 - sinkDepth;

  const model = buildWreckModel(wreck, rng, length, beam, height);
  // The shadow map is tuned for terrain scale (~0.7 units/texel, normalBias 1.5);
  // at ship scale those settings self-shadow thin hulls into black. Wrecks cast
  // shadows but never receive them.
  model.traverse((o) => {
    if (o.isMesh) o.receiveShadow = false;
  });
  listGroup.add(model);

  wreckGroup.add(listGroup);

  const isApproximate = Boolean(wreck.approximate);
  wreckGroup.add(buildBeacon(0, 0, 0, WRECK_ACCENT, { approximate: isApproximate }));

  // "≈" flags an estimated position (historical-text or unverified source)
  // so it reads honestly next to the charted wrecks.
  const labelText = isApproximate ? `≈ ${wreck.name}` : wreck.name;
  const label = createLabelSprite(labelText, { accentColor: WRECK_ACCENT, worldHeight: 15 });
  label.position.set(0, 37, 0); // near the beacon head, upright regardless of heading/list
  wreckGroup.add(label);

  return wreckGroup;
}

// ---------------------------------------------------------------------------
// Reefs
// ---------------------------------------------------------------------------

function buildReef(reef, heightmap) {
  const rng = mulberry32(hashString(reef.id));
  const [cx, cz] = reef.position;
  const count = 8 + Math.floor(rng() * 7); // 8..14

  const reefGroup = new THREE.Group();
  reefGroup.name = `reef-${reef.id}`;

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * reef.radius;
    const x = cx + Math.cos(angle) * dist;
    const z = cz + Math.sin(angle) * dist;
    const y = heightmap.getHeightAt(x, z);

    const shapeMat = new THREE.MeshStandardMaterial({
      color: pick(rng, REEF_PALETTE),
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
    });

    let geo;
    const scale = 1.5 + rng() * 3.5;
    if (rng() < 0.5) {
      geo = new THREE.IcosahedronGeometry(1, 0);
    } else {
      const radialSegments = 5 + Math.floor(rng() * 2); // 5 or 6
      geo = new THREE.ConeGeometry(0.7, 1.6, radialSegments);
    }

    const shape = new THREE.Mesh(geo, shapeMat);
    shape.scale.setScalar(scale);
    shape.position.set(x, y + scale * 0.35, z);
    shape.rotation.set(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI);
    shape.castShadow = true;
    shape.receiveShadow = true;
    reefGroup.add(shape);
  }

  const beaconY = heightmap.getHeightAt(cx, cz);
  const beacon = buildBeacon(0, 0, 0, REEF_ACCENT);
  beacon.position.set(cx, beaconY, cz);
  reefGroup.add(beacon);

  const label = createLabelSprite(reef.name, { accentColor: REEF_ACCENT, worldHeight: 13 });
  label.position.set(cx, beaconY + 36, cz);
  reefGroup.add(label);

  return reefGroup;
}

// ---------------------------------------------------------------------------
// Places — coastal cities/towns/villages on land, a grounded brass marker
// plus a floating name label.
// ---------------------------------------------------------------------------

function buildPlace(place, heightmap) {
  const [x, z] = place.position;
  const groundY = heightmap.getHeightAt(x, z);

  const placeGroup = new THREE.Group();
  placeGroup.name = `place-${place.id}`;
  placeGroup.position.set(x, groundY, z);

  const isCity = place.kind === 'city';
  const isTown = place.kind === 'town';
  const discRadius = isCity ? 3.2 : isTown ? 2.2 : 1.5;
  const pinHeight = isCity ? 6 : isTown ? 4.5 : 3.5;

  const discMat = new THREE.MeshStandardMaterial({
    color: PLACE_ACCENT,
    emissive: PLACE_ACCENT,
    emissiveIntensity: 0.18,
    roughness: 0.55,
    metalness: 0.35,
  });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(discRadius, discRadius, 0.4, 10), discMat);
  disc.position.y = 0.2;
  disc.castShadow = true;
  disc.receiveShadow = true;
  placeGroup.add(disc);

  const pinMat = new THREE.MeshStandardMaterial({
    color: '#e7dcc4',
    roughness: 0.6,
    metalness: 0.2,
  });
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, pinHeight, 6), pinMat);
  pin.position.y = pinHeight / 2 + 0.4;
  pin.castShadow = true;
  placeGroup.add(pin);

  const label = createLabelSprite(place.name, {
    accentColor: PLACE_ACCENT,
    textColor: isCity ? '#fff8ea' : '#e9dfc9',
    fontSizePx: isCity ? 32 : 24,
    worldHeight: isCity ? 15 : isTown ? 11 : 9,
  });
  label.position.set(0, 25, 0);
  placeGroup.add(label);

  return placeGroup;
}
