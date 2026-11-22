import * as THREE from 'three';

// ---------------------------------------------------------------------------
// High-detail, historically researched 3D shipwreck models for the Öresund.
//
// Uses shared procedural riveted-iron, weathered-timber, and aged-concrete
// PBR texture sets (albedo + bump + roughness) so every wreck shows rust
// streaks, dark porthole cutouts, hollow open decks/bulwarks, sea-green
// verdigris patina, masts with crosstrees/rigging, and scattered seabed rocks
// — matching the sculptural museum-diorama aesthetic.
//
// Bespoke models reflect real Öresund dive-survey conditions:
//   - S/S Robert (1905): upright ~8° list, collapsed superstructure, toppled
//     funnel on deck, caved-in aft cargo holds, fallen starboard aft mast,
//     exposed bronze propeller & rudder
//   - Johannes L (1979): Sietas coaster rolled ~78° onto its port side with
//     exposed bilge, open holds, and bow collision gash
//   - Cimbria (1858): fractured bow/stern sections, exposed spoked iron paddle
//     wheels & transverse shaft, riveted boiler drum & iron engine beams
//   - S.S. Emil R. Retzlaff (1904): split into two angled hull halves exposing
//     the triple-expansion steam engine & cylindrical boilers in the break
//   - S/S Polaris (1924): tall stern & poop deck, flattened midship holds,
//     starboard collision breach
//   - S/S Otto (1892): classic 1867 iron freighter with exposed central boiler,
//     tall raked funnel, recessed wheelhouse windows, winches, masts & rigging
//   - K7 Bevakningsfartyg: exploded steel patrol vessel missing its bow,
//     jagged torn forward bulkhead, armored bridge with portholes, gun ring
//   - Ceylon af Bergkvara (1908) & pre-1910 wooden barques/schooners: hollow
//     ribbed oak hulls, blasted midship decks, coal cargo, leaning masts
//   - Cementbåten (1956) & Anemonvraket: hollow multi-cell concrete caissons
//     with internal concrete bulkheads & protruding rusted rebar
// ---------------------------------------------------------------------------

let sharedTextures = null;

function makePrng(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function getSharedWreckMaterials() {
  if (sharedTextures) return sharedTextures;

  // --- 1. Riveted rusted iron & verdigris patina canvas textures ---
  function createPatinaTextures(mode) {
    const size = 512;
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d');

    const bump = document.createElement('canvas');
    bump.width = size;
    bump.height = size;
    const bctx = bump.getContext('2d');

    const rng = makePrng(mode === 'iron' ? 101 : mode === 'wood' ? 202 : 303);

    // Base coat
    if (mode === 'iron') {
      actx.fillStyle = '#5c3c28';
      actx.fillRect(0, 0, size, size);
    } else if (mode === 'wood') {
      actx.fillStyle = '#594633';
      actx.fillRect(0, 0, size, size);
    } else {
      actx.fillStyle = '#73726a';
      actx.fillRect(0, 0, size, size);
    }
    bctx.fillStyle = '#808080';
    bctx.fillRect(0, 0, size, size);

    // Panel plates / wood planks / concrete formwork
    const rows = mode === 'wood' ? 22 : 8;
    const rowH = size / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const shade = Math.floor((rng() - 0.5) * 26);
      if (mode === 'iron') {
        actx.fillStyle = `rgb(${88 + shade}, ${54 + Math.floor(shade * 0.7)}, ${34 + Math.floor(shade * 0.5)})`;
      } else if (mode === 'wood') {
        actx.fillStyle = `rgb(${84 + shade}, ${66 + Math.floor(shade * 0.8)}, ${48 + Math.floor(shade * 0.6)})`;
      } else {
        actx.fillStyle = `rgb(${114 + shade}, ${112 + shade}, ${104 + shade})`;
      }
      actx.fillRect(0, y, size, rowH - 1);

      // Seam line
      actx.fillStyle = 'rgba(18, 13, 10, 0.55)';
      actx.fillRect(0, y, size, mode === 'wood' ? 1.5 : 2);
      bctx.fillStyle = '#303030';
      bctx.fillRect(0, y, size, 2);

      // Vertical seams & rivets on iron plates
      if (mode === 'iron') {
        const cols = 4;
        const colW = size / cols;
        const offset = (r % 2) * (colW * 0.5);
        for (let c = 0; c <= cols; c++) {
          const x = (c * colW + offset) % size;
          actx.fillStyle = 'rgba(20, 14, 10, 0.45)';
          actx.fillRect(x, y, 2, rowH);
          bctx.fillStyle = '#383838';
          bctx.fillRect(x, y, 2, rowH);
          // Rivets
          bctx.fillStyle = '#d4d4d4';
          for (let rv = 6; rv < rowH - 4; rv += 9) {
            bctx.fillRect(x + 4, y + rv, 2.5, 2.5);
          }
        }
      }
    }

    // Layered rust blooms, drips & verdigris marine algae stains
    for (let i = 0; i < 420; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const rad = 5 + rng() * 34;
      const pickRoll = rng();
      if (pickRoll < 0.44 && mode !== 'concrete') {
        // Warm burnt orange rust
        actx.fillStyle = `rgba(156, 76, 30, ${0.12 + rng() * 0.22})`;
      } else if (pickRoll < 0.76) {
        // Deep oxidized iron / dark damp rot
        actx.fillStyle = `rgba(34, 24, 18, ${0.14 + rng() * 0.24})`;
      } else {
        // Baltic sea-green verdigris / moss patina
        actx.fillStyle = `rgba(58, 104, 92, ${0.12 + rng() * 0.22})`;
      }
      actx.beginPath();
      actx.ellipse(x, y, rad, rad * (0.4 + rng() * 1.4), rng() * Math.PI, 0, Math.PI * 2);
      actx.fill();

      bctx.fillStyle = rng() < 0.5 ? 'rgba(220,220,220,0.16)' : 'rgba(40,40,40,0.18)';
      bctx.beginPath();
      bctx.arc(x, y, rad * 0.55, 0, Math.PI * 2);
      bctx.fill();
    }

    // Vertical rust streaks running down from gunwale/portholes
    for (let i = 0; i < 95; i++) {
      const x = rng() * size;
      const y = rng() * size * 0.7;
      const h = 30 + rng() * 150;
      const grad = actx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, mode === 'concrete' ? 'rgba(54, 72, 62, 0.35)' : 'rgba(138, 60, 22, 0.38)');
      grad.addColorStop(1, 'rgba(30, 20, 14, 0)');
      actx.fillStyle = grad;
      actx.fillRect(x, y, 2 + rng() * 5, h);
    }

    // Lower-keel dark verdigris & silt band
    const keelGrad = actx.createLinearGradient(0, size * 0.62, 0, size);
    keelGrad.addColorStop(0, 'rgba(38, 66, 60, 0)');
    keelGrad.addColorStop(1, 'rgba(26, 48, 45, 0.62)');
    actx.fillStyle = keelGrad;
    actx.fillRect(0, size * 0.62, size, size * 0.38);

    const map = new THREE.CanvasTexture(albedo);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;

    const bumpMap = new THREE.CanvasTexture(bump);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;

    return { map, bumpMap };
  }

  const ironTex = createPatinaTextures('iron');
  const woodTex = createPatinaTextures('wood');
  const concreteTex = createPatinaTextures('concrete');

  sharedTextures = {
    ironHull: new THREE.MeshStandardMaterial({
      map: ironTex.map,
      bumpMap: ironTex.bumpMap,
      bumpScale: 0.45,
      color: '#c9a68b',
      roughness: 0.86,
      metalness: 0.35,
      side: THREE.DoubleSide,
    }),
    ironDark: new THREE.MeshStandardMaterial({
      map: ironTex.map,
      bumpMap: ironTex.bumpMap,
      bumpScale: 0.35,
      color: '#735847',
      roughness: 0.82,
      metalness: 0.48,
      side: THREE.DoubleSide,
    }),
    rustBright: new THREE.MeshStandardMaterial({
      map: ironTex.map,
      bumpMap: ironTex.bumpMap,
      bumpScale: 0.4,
      color: '#b86a3c',
      roughness: 0.88,
      metalness: 0.32,
      side: THREE.DoubleSide,
    }),
    superstructure: new THREE.MeshStandardMaterial({
      map: ironTex.map,
      bumpMap: ironTex.bumpMap,
      bumpScale: 0.3,
      color: '#b8aa94',
      roughness: 0.88,
      metalness: 0.18,
    }),
    patrolSteel: new THREE.MeshStandardMaterial({
      map: ironTex.map,
      bumpMap: ironTex.bumpMap,
      bumpScale: 0.32,
      color: '#7e938a',
      roughness: 0.84,
      metalness: 0.34,
      side: THREE.DoubleSide,
    }),
    woodHull: new THREE.MeshStandardMaterial({
      map: woodTex.map,
      bumpMap: woodTex.bumpMap,
      bumpScale: 0.5,
      color: '#b3997b',
      roughness: 0.93,
      metalness: 0.04,
      side: THREE.DoubleSide,
    }),
    woodDark: new THREE.MeshStandardMaterial({
      map: woodTex.map,
      bumpMap: woodTex.bumpMap,
      bumpScale: 0.4,
      color: '#6b543f',
      roughness: 0.95,
      metalness: 0.04,
    }),
    concrete: new THREE.MeshStandardMaterial({
      map: concreteTex.map,
      bumpMap: concreteTex.bumpMap,
      bumpScale: 0.55,
      color: '#a8a496',
      roughness: 0.94,
      metalness: 0.05,
      side: THREE.DoubleSide,
    }),
    darkInterior: new THREE.MeshStandardMaterial({
      color: '#121110',
      roughness: 0.98,
      metalness: 0.05,
    }),
    bronze: new THREE.MeshStandardMaterial({
      color: '#6e7e68', // oxidized bronze propeller
      roughness: 0.55,
      metalness: 0.62,
    }),
    coal: new THREE.MeshStandardMaterial({
      color: '#1c1d1f',
      roughness: 0.92,
      metalness: 0.12,
      flatShading: true,
    }),
    rigging: new THREE.MeshStandardMaterial({
      color: '#2e2721',
      roughness: 0.9,
      metalness: 0.2,
    }),
    boulder: new THREE.MeshStandardMaterial({
      color: '#52635b',
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    }),
  };

  return sharedTextures;
}

// ---------------------------------------------------------------------------
// Parametric Hollow Hull & Ship Architecture Primitives
// ---------------------------------------------------------------------------

function smoothstep01(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hullShapeAt(t, opts = {}) {
  const {
    bowSharpness = 1.45,
    sternStyle = 'counter', // 'counter' | 'transom' | 'pointed'
    taperStart = 0.28,
    sheerBow = 0.36,
    sheerStern = 0.18,
    keelRocker = 0.32,
  } = opts;

  const absT = Math.abs(t);
  let beamScale = 1;
  if (absT > taperStart) {
    const bt = (absT - taperStart) / (1 - taperStart);
    if (t > 0) {
      beamScale = 1 - Math.pow(bt, bowSharpness) * 0.95;
    } else if (sternStyle === 'transom') {
      beamScale = 1 - Math.pow(bt, 2.6) * 0.42;
    } else if (sternStyle === 'pointed') {
      beamScale = 1 - Math.pow(bt, 1.4) * 0.9;
    } else {
      beamScale = 1 - Math.pow(bt, 1.85) * 0.78;
    }
  }
  beamScale = Math.max(beamScale, 0.025);

  const deckRise = t > 0 ? Math.pow(t, 2.1) * sheerBow : Math.pow(-t, 2.0) * sheerStern;
  const keelRise = t > 0.5 ? Math.pow((t - 0.5) / 0.5, 2) * keelRocker : t < -0.65 ? Math.pow((-t - 0.65) / 0.35, 2) * keelRocker * 0.65 : 0;
  return { beamScale, deckRise, keelRise };
}

const HULL_PROFILE = [
  [0.0, 0.0],
  [0.06, 0.38],
  [0.22, 0.85],
  [0.48, 1.0],
  [0.78, 0.98],
  [1.0, 1.03], // slight flare at bulwark gunwale
];

/**
 * Builds a hollow lofted ship hull with recessed main deck, raised bulwark walls,
 * UVs for riveted patina texture, and optional hull breach/missing-bow/caved-side cuts!
 */
function buildHollowHullMesh(length, beam, height, material, opts = {}) {
  const {
    stations = 22,
    tMin = -1,
    tMax = 1,
    deckDrop = 0.24, // recessed deck below gunwale so bulwarks stand proud
    breachSide = 0, // -1 port, 1 starboard, 0 none
    breachRange = [0.1, 0.32],
    openTop = false, // true for blasted/skeletal hulls
    sternStyle = 'counter',
    sheerBow = 0.36,
    sheerStern = 0.18,
  } = opts;

  const halfL = length / 2;
  const halfB = beam / 2;
  const profN = HULL_PROFILE.length;

  const positions = [];
  const uvs = [];
  const indices = [];
  const rings = [];

  for (let s = 0; s < stations; s++) {
    const uFrac = s / (stations - 1);
    const t = tMin + uFrac * (tMax - tMin);
    const { beamScale, deckRise, keelRise } = hullShapeAt(t, { sternStyle, sheerBow, sheerStern });
    const x = t * halfL;
    const st = [[], []];

    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      for (let p = 0; p < profN; p++) {
        const [v, u] = HULL_PROFILE[p];
        const z = sign * u * halfB * beamScale;
        const y = -height / 2 + v * height + THREE.MathUtils.lerp(keelRise, deckRise, v) * height;
        positions.push(x, y, z);
        uvs.push(uFrac * 2.4, v * 1.1);
        st[side].push(positions.length / 3 - 1);
      }
    }
    rings.push({ t, beamScale, deckRise, st });
  }

  for (let s = 0; s < stations - 1; s++) {
    const tMid = (rings[s].t + rings[s + 1].t) * 0.5;
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const isBreach = breachSide === sign && tMid >= breachRange[0] && tMid <= breachRange[1];
      for (let p = 0; p < profN - 1; p++) {
        // On a breach, omit upper hull plates so internal ribs/holds show through
        if (isBreach && p >= 2) continue;
        const a = rings[s].st[side][p];
        const b = rings[s].st[side][p + 1];
        const c = rings[s + 1].st[side][p + 1];
        const d = rings[s + 1].st[side][p];
        if (side === 1) {
          indices.push(a, c, b, a, d, c);
        } else {
          indices.push(a, b, c, a, c, d);
        }
      }
    }
  }

  // Recessed interior deck (sunk slightly below the gunwale so bulwark walls stand out!)
  if (!openTop) {
    const deckStart = positions.length / 3;
    for (let s = 0; s < stations; s++) {
      const { t, beamScale, deckRise } = rings[s];
      const x = t * halfL;
      const y = height / 2 + deckRise * height - height * deckDrop;
      const w = halfB * beamScale * 0.94;
      positions.push(x, y, -w, x, y, w);
      uvs.push((s / (stations - 1)) * 2.0, 0, (s / (stations - 1)) * 2.0, 1);
    }
    for (let s = 0; s < stations - 1; s++) {
      const a = deckStart + s * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, d, a, d, c);
    }
  }

  // Transom stern closure when tMin is at stern and stern is boxy
  if (sternStyle === 'transom' && tMin <= -0.95) {
    const st0 = rings[0].st;
    for (let p = 0; p < profN - 1; p++) {
      const a = st0[0][p];
      const b = st0[1][p];
      const c = st0[1][p + 1];
      const d = st0[0][p + 1];
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Adds a wheelhouse/bridge block with recessed dark windows/portholes & roof overhang
 * (the exact silhouette detail that makes the reference image's ship feel real!).
 */
function addWheelhouse(group, mats, { x, y, z = 0, w, h, d, windows = 3, portholes = 2 }) {
  const house = new THREE.Group();
  house.position.set(x, y, z);

  // Main cabin body
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.superstructure);
  body.position.y = h / 2;
  body.castShadow = true;
  house.add(body);

  // Thin weathered roof overhang
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.12, h * 0.12, d * 1.12), mats.ironDark);
  roof.position.y = h + h * 0.06;
  roof.castShadow = true;
  house.add(roof);

  // Forward recessed dark bridge windows
  const winW = d * 0.18;
  const winH = h * 0.34;
  for (let i = 0; i < windows; i++) {
    const frac = windows === 1 ? 0 : i / (windows - 1) - 0.5;
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.18, winH, winW), mats.darkInterior);
    win.position.set(w / 2 + 0.04, h * 0.62, frac * d * 0.64);
    house.add(win);
  }

  // Side recessed dark portholes on port & starboard
  for (const side of [-1, 1]) {
    for (let i = 0; i < portholes; i++) {
      const frac = portholes === 1 ? 0 : i / (portholes - 1) - 0.5;
      const hole = new THREE.Mesh(
        new THREE.CylinderGeometry(h * 0.14, h * 0.14, 0.22, 10),
        mats.darkInterior
      );
      hole.rotation.x = Math.PI / 2;
      hole.position.set(frac * w * 0.55, h * 0.58, side * (d / 2 + 0.03));
      house.add(hole);
    }
  }

  group.add(house);
  return house;
}

/**
 * Adds a row of dark riveted porthole recesses along the upper hull sides.
 */
function addHullPortholes(group, mats, length, beam, height, count = 5, tRange = [-0.55, 0.55]) {
  const r = Math.max(0.22, height * 0.09);
  for (let i = 0; i < count; i++) {
    const t = tRange[0] + (i / Math.max(1, count - 1)) * (tRange[1] - tRange[0]);
    const { beamScale, deckRise } = hullShapeAt(t);
    const x = t * (length / 2);
    const y = height * 0.14 + deckRise * height;
    const zOff = (beam / 2) * beamScale * 0.99;
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 8), mats.darkInterior);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, y, side * zOff);
      group.add(p);
    }
  }
}

/**
 * Detailed ship mast with crosstrees, optional crow's nest, boom, and wire stays.
 */
function addDetailedMast(group, mats, { x, y, h, rBase, tiltZ = 0, tiltX = 0, yard = true, riggingSpan = 0 }) {
  const mastGrp = new THREE.Group();
  mastGrp.position.set(x, y, 0);
  mastGrp.rotation.set(tiltX, 0, tiltZ);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(rBase * 0.55, rBase, h, 8), mats.ironDark);
  pole.position.y = h / 2;
  pole.castShadow = true;
  mastGrp.add(pole);

  // Crosstrees / yardarm
  if (yard) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(rBase * 0.45, rBase * 0.45, h * 0.42, 6), mats.ironDark);
    bar.rotation.x = Math.PI / 2;
    bar.position.y = h * 0.68;
    bar.castShadow = true;
    mastGrp.add(bar);

    const upperBar = new THREE.Mesh(new THREE.CylinderGeometry(rBase * 0.35, rBase * 0.35, h * 0.24, 6), mats.ironDark);
    upperBar.rotation.x = Math.PI / 2;
    upperBar.position.y = h * 0.85;
    mastGrp.add(upperBar);
  }

  // Slack wire shrouds/stays anchored down to hull sides
  if (riggingSpan > 0) {
    const stayAnchors = [
      [0, h * 0.72, 0, riggingSpan * 0.55, 0, 0],
      [0, h * 0.66, 0, -riggingSpan * 0.45, 0, 0],
      [0, h * 0.68, 0, 0, 0, riggingSpan * 0.26],
      [0, h * 0.68, 0, 0, 0, -riggingSpan * 0.26],
    ];
    for (const [x0, y0, z0, x1, y1, z1] of stayAnchors) {
      const a = new THREE.Vector3(x0, y0, z0);
      const b = new THREE.Vector3(x1, y1, z1);
      const len = a.distanceTo(b);
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(rBase * 0.16, rBase * 0.16, len, 4), mats.rigging);
      cable.position.copy(a).add(b).multiplyScalar(0.5);
      cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      mastGrp.add(cable);
    }
  }

  group.add(mastGrp);
  return mastGrp;
}

/**
 * Adds stern bronze propeller + rudder assembly (iconic dive feature on S/S Robert, Otto, Polaris).
 */
function addSternGear(group, mats, length, beam, height) {
  const sternX = -length * 0.47;
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(length * 0.045, height * 0.58, beam * 0.04), mats.ironDark);
  rudder.position.set(sternX - length * 0.018, -height * 0.14, 0);
  rudder.rotation.y = 0.22;
  group.add(rudder);

  const propGroup = new THREE.Group();
  propGroup.position.set(sternX + length * 0.015, -height * 0.22, 0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.08, height * 0.08, height * 0.16, 8), mats.bronze);
  hub.rotation.z = Math.PI / 2;
  propGroup.add(hub);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(height * 0.04, height * 0.26, height * 0.11), mats.bronze);
    const ang = (i / 4) * Math.PI * 2;
    blade.position.set(0, Math.cos(ang) * height * 0.16, Math.sin(ang) * height * 0.16);
    blade.rotation.x = ang;
    blade.rotation.y = 0.35;
    propGroup.add(blade);
  }
  group.add(propGroup);
}

/**
 * Adds open rectangular cargo hold coamings (recessed dark interior inside).
 */
function addCargoHold(group, mats, { x, y, w, d, h }) {
  const hold = new THREE.Group();
  hold.position.set(x, y, 0);
  const wallT = Math.max(0.25, d * 0.08);
  const pit = new THREE.Mesh(new THREE.BoxGeometry(w - wallT, h * 0.5, d - wallT), mats.darkInterior);
  pit.position.y = h * 0.15;
  hold.add(pit);

  const walls = [
    [w, h, wallT, 0, h / 2, d / 2],
    [w, h, wallT, 0, h / 2, -d / 2],
    [wallT, h, d, w / 2, h / 2, 0],
    [wallT, h, d, -w / 2, h / 2, 0],
  ];
  for (const [bw, bh, bd, bx, by, bz] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mats.rustBright);
    m.position.set(bx, by, bz);
    m.castShadow = true;
    hold.add(m);
  }
  group.add(hold);
}

/**
 * Adds exposed Victorian cylindrical Scotch boiler + vertical engine cylinders.
 */
function addSteamMachinery(group, mats, x, y, beam, height) {
  const boiler = new THREE.Mesh(
    new THREE.CylinderGeometry(beam * 0.24, beam * 0.24, beam * 0.52, 12),
    mats.rustBright
  );
  boiler.rotation.z = Math.PI / 2;
  boiler.position.set(x, y + beam * 0.18, 0);
  boiler.castShadow = true;
  group.add(boiler);

  // Triple-expansion vertical steam cylinders right aft of boiler
  for (let i = 0; i < 3; i++) {
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(beam * 0.08, beam * 0.095, height * 0.55, 8),
      mats.ironDark
    );
    cyl.position.set(x - beam * 0.34 - i * beam * 0.14, y + height * 0.22, 0);
    cyl.castShadow = true;
    group.add(cyl);
  }
}

/**
 * Adds internal curved rib frames (spantes) for skeletal / ruined / broken hulls.
 */
function addHullRibs(group, mats, length, beam, height, tStart, tEnd, count, mat) {
  for (let i = 0; i < count; i++) {
    const t = tStart + (i / Math.max(1, count - 1)) * (tEnd - tStart);
    const { beamScale, deckRise } = hullShapeAt(t);
    const radius = (beam / 2) * beamScale * 0.94;
    if (radius < 0.3) continue;
    const tube = Math.max(0.14, beam * 0.025);
    const geo = new THREE.TorusGeometry(radius, tube, 5, 12, Math.PI);
    geo.rotateZ(-Math.PI / 2);
    geo.rotateY(Math.PI / 2);
    const rib = new THREE.Mesh(geo, mat || mats.woodDark);
    rib.position.set(t * (length / 2), -height * 0.04 + deckRise * height, 0);
    rib.castShadow = true;
    group.add(rib);
  }
}

// ---------------------------------------------------------------------------
// Bespoke Real-Wreck Builders (historically grounded in Öresund dive reports)
// ---------------------------------------------------------------------------

// 1. S/S Robert (1905, ex-SS Hawarden, 86 m) — upright ~8° list, collapsed bridge,
// toppled funnel lying aft, caved-in aft hold, fallen starboard aft mast, stern propeller.
function buildSSRobert(rng, length, beam, height, mats) {
  const g = new THREE.Group();
  const hull = buildHollowHullMesh(length, beam, height, mats.ironHull, {
    breachSide: 1,
    breachRange: [-0.55, -0.15],
    deckDrop: 0.28,
    sheerBow: 0.4,
  });
  g.add(hull);
  addHullPortholes(g, mats, length, beam, height, 7, [-0.62, 0.58]);
  addSternGear(g, mats, length, beam, height);
  addHullRibs(g, mats, length, beam, height, -0.55, -0.15, 7, mats.ironDark);

  // Raised forecastle & poop deck
  const deckY = height * 0.24;
  addCargoHold(g, mats, { x: length * 0.22, y: deckY, w: length * 0.16, d: beam * 0.58, h: height * 0.18 });
  addCargoHold(g, mats, { x: -length * 0.26, y: deckY, w: length * 0.16, d: beam * 0.54, h: height * 0.16 });

  // Partially collapsed midship bridge
  const bridge = addWheelhouse(g, mats, {
    x: -length * 0.02,
    y: deckY,
    w: length * 0.13,
    h: height * 0.72,
    d: beam * 0.68,
    windows: 3,
    portholes: 2,
  });
  bridge.rotation.z = -0.09;

  // Distinctive toppled funnel fallen backward onto the deck
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(beam * 0.14, beam * 0.16, height * 1.35, 12),
    mats.rustBright
  );
  funnel.position.set(-length * 0.15, deckY + height * 0.24, beam * 0.06);
  funnel.rotation.z = THREE.MathUtils.degToRad(74);
  funnel.rotation.y = 0.18;
  funnel.castShadow = true;
  g.add(funnel);

  // Standing foremast with crosstrees & rigging
  addDetailedMast(g, mats, {
    x: length * 0.32,
    y: deckY,
    h: height * 2.1,
    rBase: beam * 0.04,
    tiltZ: -0.08,
    yard: true,
    riggingSpan: length * 0.24,
  });

  // Fallen aft mast resting perpendicular across starboard side
  const fallenMast = addDetailedMast(g, mats, {
    x: -length * 0.34,
    y: deckY + height * 0.1,
    h: height * 1.9,
    rBase: beam * 0.036,
    tiltX: THREE.MathUtils.degToRad(84),
    tiltZ: 0.12,
    yard: true,
  });
  fallenMast.position.z = beam * 0.05;

  return g;
}

// 2. Johannes L (1979, J. J. Sietas 1951 steel coaster) — intact coaster hull
// resting on its PORT SIDE (~76° roll!), port-bow breach, open holds, aft bridge.
function buildJohannesL(rng, length, beam, height, mats) {
  const g = new THREE.Group();
  const hull = buildHollowHullMesh(length, beam, height, mats.ironHull, {
    sternStyle: 'counter',
    breachSide: -1,
    breachRange: [0.48, 0.72],
    deckDrop: 0.26,
  });
  g.add(hull);
  addHullPortholes(g, mats, length, beam, height, 6, [-0.55, 0.42]);
  addSternGear(g, mats, length, beam, height);

  const deckY = height * 0.25;
  // Long open coaster cargo hatchways
  addCargoHold(g, mats, { x: length * 0.14, y: deckY, w: length * 0.38, d: beam * 0.66, h: height * 0.22 });

  // Classic 1950s Sietas aft wheelhouse & accommodation block
  addWheelhouse(g, mats, {
    x: -length * 0.27,
    y: deckY,
    w: length * 0.2,
    h: height * 0.88,
    d: beam * 0.72,
    windows: 4,
    portholes: 3,
  });

  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(beam * 0.11, beam * 0.14, height * 0.78, 10),
    mats.rustBright
  );
  funnel.position.set(-length * 0.33, deckY + height * 1.15, 0);
  funnel.rotation.z = 0.14;
  funnel.castShadow = true;
  g.add(funnel);

  addDetailedMast(g, mats, {
    x: length * 0.36,
    y: deckY,
    h: height * 1.85,
    rBase: beam * 0.038,
    tiltZ: -0.05,
    yard: true,
    riggingSpan: length * 0.2,
  });

  return g;
}

// 3. Cimbria (1858 Scottish paddle steamer) — angled bow & stern sections,
// exposed circular spoked iron paddle wheels, drive shaft, boiler & iron frames!
function buildCimbria(rng, length, beam, height, mats) {
  const g = new THREE.Group();
  const slimBeam = beam * 0.86;

  // Bow & midship section (slightly angled relative to stern)
  const bowGrp = new THREE.Group();
  bowGrp.add(
    buildHollowHullMesh(length, slimBeam, height, mats.ironHull, {
      tMin: -0.18,
      tMax: 1.0,
      openTop: true,
      sheerBow: 0.42,
    })
  );
  addHullRibs(bowGrp, mats, length, slimBeam, height, -0.14, 0.78, 10, mats.ironDark);
  g.add(bowGrp);

  // Stern section fractured at a 14° angle (true to Cimbria's seabed layout!)
  const sternGrp = new THREE.Group();
  sternGrp.position.set(-length * 0.08, -height * 0.06, slimBeam * 0.14);
  sternGrp.rotation.y = THREE.MathUtils.degToRad(14);
  sternGrp.add(
    buildHollowHullMesh(length, slimBeam, height, mats.ironHull, {
      tMin: -1.0,
      tMax: -0.16,
      openTop: true,
      sternStyle: 'counter',
    })
  );
  addHullRibs(sternGrp, mats, length, slimBeam, height, -0.82, -0.2, 8, mats.ironDark);
  g.add(sternGrp);

  // Prominent iron boiler & engine beams rising amidships
  addSteamMachinery(g, mats, length * 0.04, -height * 0.15, slimBeam, height);

  // Iconic transverse iron paddle shaft + spoked circular paddle wheels on both flanks!
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(height * 0.07, height * 0.07, slimBeam * 1.68, 10),
    mats.ironDark
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(length * 0.02, height * 0.22, 0);
  shaft.castShadow = true;
  g.add(shaft);

  const wheelR = height * 0.76;
  for (const side of [-1, 1]) {
    const wheel = new THREE.Group();
    wheel.position.set(length * 0.02, height * 0.22, side * (slimBeam * 0.62));

    // Outer & inner iron paddle rings
    const rim = new THREE.Mesh(new THREE.TorusGeometry(wheelR, height * 0.055, 6, 18), mats.rustBright);
    rim.castShadow = true;
    wheel.add(rim);
    const innerRim = new THREE.Mesh(new THREE.TorusGeometry(wheelR * 0.62, height * 0.04, 5, 14), mats.ironDark);
    wheel.add(innerRim);

    // 10 radial spokes + paddle float boards
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(wheelR * 1.95, height * 0.045, height * 0.05), mats.ironDark);
      spoke.rotation.z = ang;
      wheel.add(spoke);

      const floatBoard = new THREE.Mesh(
        new THREE.BoxGeometry(height * 0.12, height * 0.06, slimBeam * 0.26),
        mats.woodDark
      );
      floatBoard.position.set(Math.cos(ang) * wheelR, Math.sin(ang) * wheelR, 0);
      floatBoard.rotation.z = ang;
      wheel.add(floatBoard);
    }

    // Broken partial paddle-box arch over top
    const arch = new THREE.Mesh(
      new THREE.CylinderGeometry(wheelR * 1.15, wheelR * 1.15, slimBeam * 0.34, 12, 1, true, -Math.PI * 0.35, Math.PI * 0.7),
      mats.ironHull
    );
    arch.rotation.x = Math.PI / 2;
    wheel.add(arch);
    g.add(wheel);
  }

  // Tall thin 1850s Victorian funnel (tilted)
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(slimBeam * 0.1, slimBeam * 0.12, height * 1.55, 10),
    mats.rustBright
  );
  funnel.position.set(length * 0.12, height * 0.72, 0);
  funnel.rotation.z = 0.22;
  funnel.castShadow = true;
  g.add(funnel);

  return g;
}

// 4. S.S. Emil R. Retzlaff (1904) — split into two distinct angled hull halves
// exposing the triple-expansion engine & boiler right in the breach!
function buildEmilRetzlaff(rng, length, beam, height, mats) {
  const g = new THREE.Group();
  const deckY = height * 0.24;

  // Bow half
  const bowHalf = new THREE.Group();
  bowHalf.position.set(length * 0.05, 0, -beam * 0.12);
  bowHalf.rotation.y = -0.16;
  bowHalf.add(
    buildHollowHullMesh(length, beam, height, mats.ironHull, {
      tMin: 0.06,
      tMax: 1.0,
      deckDrop: 0.26,
    })
  );
  addCargoHold(bowHalf, mats, { x: length * 0.28, y: deckY, w: length * 0.16, d: beam * 0.56, h: height * 0.18 });
  addDetailedMast(bowHalf, mats, { x: length * 0.38, y: deckY, h: height * 1.7, rBase: beam * 0.036, tiltZ: -0.18, yard: true });
  g.add(bowHalf);

  // Aft half angled away with exposed steam engine & boiler in the split!
  const aftHalf = new THREE.Group();
  aftHalf.position.set(-length * 0.06, -height * 0.05, beam * 0.14);
  aftHalf.rotation.y = 0.19;
  aftHalf.add(
    buildHollowHullMesh(length, beam, height, mats.ironHull, {
      tMin: -1.0,
      tMax: -0.04,
      deckDrop: 0.28,
    })
  );
  addSteamMachinery(aftHalf, mats, -length * 0.08, -height * 0.05, beam, height);
  addWheelhouse(aftHalf, mats, {
    x: -length * 0.24,
    y: deckY,
    w: length * 0.14,
    h: height * 0.68,
    d: beam * 0.62,
    windows: 3,
    portholes: 2,
  });
  addSternGear(aftHalf, mats, length, beam, height);
  g.add(aftHalf);

  return g;
}

// 5. S/S Polaris (1924, 78 m iron steamer) — tall intact stern/poop, flattened
// collapsed midship holds, starboard collision breach.
function buildSSPolaris(rng, length, beam, height, mats) {
  const g = new THREE.Group();
  const hull = buildHollowHullMesh(length, beam, height, mats.ironHull, {
    breachSide: 1,
    breachRange: [-0.2, 0.35],
    deckDrop: 0.34,
    sheerStern: 0.38, // tall stern per dive reports
  });
  g.add(hull);
  addHullPortholes(g, mats, length, beam, height, 6, [-0.72, 0.52]);
  addSternGear(g, mats, length, beam, height);
  addHullRibs(g, mats, length, beam, height, -0.2, 0.35, 9, mats.ironDark);

  const deckY = height * 0.22;
  // Tall aft poop deckhouse
  addWheelhouse(g, mats, {
    x: -length * 0.32,
    y: deckY + height * 0.14,
    w: length * 0.18,
    h: height * 0.82,
    d: beam * 0.68,
    windows: 3,
    portholes: 3,
  });
  addSteamMachinery(g, mats, -length * 0.06, -height * 0.08, beam, height);
  addDetailedMast(g, mats, { x: length * 0.34, y: deckY, h: height * 1.9, rBase: beam * 0.036, tiltZ: 0.12, yard: true, riggingSpan: length * 0.2 });
  return g;
}

// 6. K7 Bevakningsfartyg (30 m) — exploded steel patrol boat MISSING ITS BOW!
function buildK7Patrol(rng, length, beam, height, mats) {
  const g = new THREE.Group();
  // Hull truncated at tMax = 0.42 (bow blown completely away)
  const hull = buildHollowHullMesh(length, beam, height, mats.patrolSteel, {
    tMin: -1.0,
    tMax: 0.42,
    sternStyle: 'transom',
    deckDrop: 0.22,
  });
  g.add(hull);
  addHullPortholes(g, mats, length, beam, height, 5, [-0.68, 0.28]);
  addSternGear(g, mats, length, beam, height);
  addHullRibs(g, mats, length, beam, height, 0.22, 0.48, 5, mats.ironDark);

  // Jagged torn forward steel plates poking out of the missing bow end
  for (let i = 0; i < 6; i++) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(length * (0.06 + rng() * 0.08), height * (0.22 + rng() * 0.32), 0.22),
      mats.rustBright
    );
    plate.position.set(
      length * 0.22 + rng() * length * 0.06,
      (rng() - 0.4) * height * 0.45,
      (rng() - 0.5) * beam * 0.72
    );
    plate.rotation.set((rng() - 0.5) * 0.7, (rng() - 0.5) * 0.8, (rng() - 0.5) * 0.5);
    plate.castShadow = true;
    g.add(plate);
  }

  const deckY = height * 0.28;
  // Low armored naval wheelhouse
  addWheelhouse(g, mats, {
    x: -length * 0.1,
    y: deckY,
    w: length * 0.24,
    h: height * 0.62,
    d: beam * 0.68,
    windows: 3,
    portholes: 3,
  });

  // Naval signal mast & aft gun-mount ring
  addDetailedMast(g, mats, {
    x: -length * 0.14,
    y: deckY + height * 0.62,
    h: height * 1.45,
    rBase: beam * 0.032,
    tiltZ: 0.1,
    yard: true,
  });
  const gunRing = new THREE.Mesh(
    new THREE.CylinderGeometry(beam * 0.2, beam * 0.24, height * 0.24, 12),
    mats.ironDark
  );
  gunRing.position.set(-length * 0.36, deckY + height * 0.12, 0);
  g.add(gunRing);

  return g;
}

// 7. Standard Detailed Steel Steamer (S/S Otto, S.S. Birgit, S.S. Union, Franz)
// Matches the rich weathered shipwreck silhouette from the user's reference image!
function buildDetailedSteamer(rng, length, beam, height, mats) {
  const g = new THREE.Group();
  const hull = buildHollowHullMesh(length, beam, height, mats.ironHull, {
    deckDrop: 0.26,
    sheerBow: 0.4,
    sheerStern: 0.2,
  });
  g.add(hull);
  addHullPortholes(g, mats, length, beam, height, 6, [-0.58, 0.52]);
  addSternGear(g, mats, length, beam, height);

  const deckY = height * 0.24;
  addWheelhouse(g, mats, {
    x: -length * 0.12,
    y: deckY,
    w: length * 0.18,
    h: height * 0.86,
    d: beam * 0.66,
    windows: 3,
    portholes: 2,
  });

  // Raked rusted funnel with collar band
  const funnelH = height * (1.15 + rng() * 0.28);
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(beam * 0.11, beam * 0.135, funnelH, 12),
    mats.rustBright
  );
  funnel.position.set(-length * 0.22, deckY + height * 0.55 + funnelH / 2, 0);
  funnel.rotation.z = THREE.MathUtils.degToRad(9);
  funnel.castShadow = true;
  g.add(funnel);

  // Open cargo holds + deck anchor windlass
  addCargoHold(g, mats, { x: length * 0.16, y: deckY, w: length * 0.19, d: beam * 0.56, h: height * 0.18 });
  const windlass = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.12, height * 0.12, beam * 0.4, 8), mats.ironDark);
  windlass.rotation.x = Math.PI / 2;
  windlass.position.set(length * 0.36, deckY + height * 0.16, 0);
  g.add(windlass);

  // Prominent tilted foremast with crosstrees & wire stays (hero silhouette!)
  addDetailedMast(g, mats, {
    x: length * 0.28,
    y: deckY,
    h: height * (2.05 + rng() * 0.35),
    rBase: beam * 0.038,
    tiltZ: THREE.MathUtils.degToRad(-12 + rng() * 6),
    yard: true,
    riggingSpan: length * 0.26,
  });

  if (rng() < 0.7) {
    addDetailedMast(g, mats, {
      x: -length * 0.34,
      y: deckY,
      h: height * (1.35 + rng() * 0.35),
      rBase: beam * 0.032,
      tiltZ: THREE.MathUtils.degToRad(8 + rng() * 10),
      yard: false,
      riggingSpan: length * 0.16,
    });
  }

  return g;
}

// 8. Historic Wooden Barque / Schooner (Ceylon af Bergkvara, Activ, Ane Kirstine, Frednäs, Carolina Sophia)
function buildWoodenSailingWreck(rng, length, beam, height, wreck, mats) {
  const g = new THREE.Group();
  const isCeylon = wreck.id === 'wreck-ceylon-af-bergkvara';
  const isRuin = isCeylon || (Boolean(wreck.sunkYear) && wreck.sunkYear < 1910);

  const hull = buildHollowHullMesh(length, beam, height, mats.woodHull, {
    sternStyle: rng() < 0.5 ? 'transom' : 'pointed',
    openTop: isRuin,
    breachSide: isRuin ? (rng() < 0.5 ? -1 : 1) : 0,
    breachRange: [-0.22, 0.28],
    sheerBow: 0.38,
    sheerStern: 0.26,
  });
  g.add(hull);

  // Exposed curved oak rib frames (spantes) & deck cross-beams
  addHullRibs(g, mats, length, beam, height, -0.78, 0.78, isRuin ? 13 : 7, mats.woodDark);

  // For Ceylon af Bergkvara: dark spilled coal cargo inside her dynamited hold!
  if (isCeylon) {
    for (let i = 0; i < 6; i++) {
      const mound = new THREE.Mesh(new THREE.DodecahedronGeometry(beam * (0.22 + rng() * 0.16), 1), mats.coal);
      mound.scale.set(1.3, 0.55, 0.9);
      mound.position.set((rng() - 0.5) * length * 0.45, -height * 0.06, (rng() - 0.5) * beam * 0.25);
      g.add(mound);
    }
  }

  // Bowsprit spar projecting from bow
  const bowspritLen = length * 0.28;
  const bowsprit = new THREE.Mesh(
    new THREE.CylinderGeometry(beam * 0.024, beam * 0.036, bowspritLen, 6),
    mats.woodDark
  );
  bowsprit.position.set(length * 0.48, height * 0.44, 0);
  bowsprit.rotation.z = THREE.MathUtils.degToRad(-72);
  bowsprit.castShadow = true;
  g.add(bowsprit);

  // 2-3 wooden masts (survivor leaning with yardarms & stays; others snapped stubs)
  const mastCount = isCeylon ? 3 : 2 + Math.floor(rng() * 2);
  const survivorIdx = isCeylon ? 0 : Math.floor(rng() * mastCount);
  for (let i = 0; i < mastCount; i++) {
    const mx = length * (0.28 - i * (0.56 / Math.max(1, mastCount - 1)));
    const isStub = isRuin && i !== survivorIdx;
    const mastH = isStub ? height * (0.45 + rng() * 0.4) : height * (2.35 + rng() * 0.5);
    addDetailedMast(g, mats, {
      x: mx,
      y: height * 0.12,
      h: mastH,
      rBase: beam * 0.04,
      tiltZ: isStub ? (rng() - 0.5) * 0.3 : THREE.MathUtils.degToRad(-14 + rng() * 8),
      yard: !isStub,
      riggingSpan: isStub ? 0 : length * 0.26,
    });
  }

  return g;
}

// 9. Concrete Harbour Caisson (Cementbåten 1956, Anemonvraket) — hollow multi-cell
// reinforced concrete hull with internal compartment walls & protruding rebar!
function buildConcreteCaisson(rng, length, beam, height, mats) {
  const g = new THREE.Group();
  const wallT = beam * 0.12;

  // Hollow rectangular caisson outer walls (slightly eroded top edge)
  const parts = [
    [length, height * 0.22, beam, 0, -height * 0.39, 0], // floor slab
    [length, height, wallT, 0, 0, beam / 2 - wallT / 2], // starboard wall
    [length, height, wallT, 0, 0, -beam / 2 + wallT / 2], // port wall
    [wallT, height, beam, length / 2 - wallT / 2, 0, 0], // front bulkhead
    [wallT, height, beam, -length / 2 + wallT / 2, 0, 0], // rear bulkhead
    // Internal cellular concrete partition walls
    [wallT * 0.8, height * 0.88, beam - wallT * 2, -length * 0.18, -height * 0.04, 0],
    [wallT * 0.8, height * 0.88, beam - wallT * 2, length * 0.18, -height * 0.04, 0],
    [length - wallT * 2, height * 0.84, wallT * 0.75, 0, -height * 0.06, 0],
  ];
  for (const [w, h, d, x, y, z] of parts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.concrete);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }

  // Protruding rusty steel rebar & iron mooring bollards along the concrete rim
  for (let i = 0; i < 10; i++) {
    const rebar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, height * 0.35, 5), mats.rustBright);
    rebar.position.set((rng() - 0.5) * length * 0.9, height * 0.56, (rng() < 0.5 ? 1 : -1) * (beam / 2 - wallT * 0.5));
    rebar.rotation.set((rng() - 0.5) * 0.7, 0, (rng() - 0.5) * 0.7);
    g.add(rebar);
  }
  for (const sx of [-0.42, 0.42]) {
    for (const sz of [-0.42, 0.42]) {
      const bollard = new THREE.Mesh(new THREE.CylinderGeometry(beam * 0.045, beam * 0.055, height * 0.22, 8), mats.ironDark);
      bollard.position.set(sx * length, height * 0.56, sz * beam);
      g.add(bollard);
    }
  }

  return g;
}

// 10. Detailed Trawler / Fishing Vessel / Landing Craft (Kalle, Bella Maria, Leda, Livlig, Landstigningsbåten)
function buildTrawlerOrLandingCraft(rng, length, beam, height, isLandingCraft, mats) {
  const g = new THREE.Group();
  const hull = buildHollowHullMesh(length, beam, height, mats.ironHull, {
    sternStyle: 'transom',
    sheerBow: isLandingCraft ? 0.08 : 0.34,
    sheerStern: isLandingCraft ? 0.06 : 0.16,
    deckDrop: 0.26,
  });
  g.add(hull);
  addHullPortholes(g, mats, length, beam, height, 4, [-0.5, 0.4]);

  const deckY = height * 0.24;
  if (isLandingCraft) {
    // Open flat bow ramp dropped onto the seabed mud
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(length * 0.22, height * 0.12, beam * 0.9), mats.ironDark);
    ramp.position.set(length * 0.54, -height * 0.12, 0);
    ramp.rotation.z = THREE.MathUtils.degToRad(-24);
    ramp.castShadow = true;
    g.add(ramp);
    addWheelhouse(g, mats, {
      x: -length * 0.32,
      y: deckY,
      w: length * 0.18,
      h: height * 0.65,
      d: beam * 0.52,
      windows: 2,
      portholes: 1,
    });
  } else {
    // Classic weathered trawler/coaster matching the reference image ship!
    addWheelhouse(g, mats, {
      x: -length * 0.22,
      y: deckY,
      w: length * 0.25,
      h: height * 0.92,
      d: beam * 0.68,
      windows: 3,
      portholes: 2,
    });
    addCargoHold(g, mats, { x: length * 0.12, y: deckY, w: length * 0.24, d: beam * 0.56, h: height * 0.16 });
    addDetailedMast(g, mats, {
      x: length * 0.22,
      y: deckY,
      h: height * 2.05,
      rBase: beam * 0.04,
      tiltZ: THREE.MathUtils.degToRad(-14),
      yard: true,
      riggingSpan: length * 0.28,
    });
  }

  return g;
}

/**
 * Adds weathered hull debris planks, rusted plates, and mossy seabed boulders
 * nestled around every wreck's resting spot (just like the reference image!).
 */
function buildWreckSiteScatter(rng, length, beam, mats) {
  const scatter = new THREE.Group();

  // Scattered weathered timber planks & rusted steel plates
  const debrisCount = 7 + Math.floor(rng() * 5);
  for (let i = 0; i < debrisCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = length * (0.34 + rng() * 0.38);
    const w = 1.6 + rng() * 4.2;
    const h = 0.22 + rng() * 0.45;
    const d = 0.45 + rng() * 1.2;
    const piece = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), i % 2 === 0 ? mats.woodDark : mats.rustBright);
    piece.position.set(Math.cos(angle) * dist, h * 0.3, Math.sin(angle) * Math.min(dist, beam * 2.3));
    piece.rotation.set((rng() - 0.5) * 0.35, rng() * Math.PI * 2, (rng() - 0.5) * 0.35);
    piece.castShadow = true;
    scatter.add(piece);
  }

  // Mossy seabed rocks & cobbles resting alongside the hull
  const rockCount = 6 + Math.floor(rng() * 5);
  for (let i = 0; i < rockCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = length * (0.28 + rng() * 0.42);
    const r = 0.9 + rng() * 2.1;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mats.boulder);
    rock.scale.set(1.1 + rng() * 0.4, 0.55 + rng() * 0.35, 0.9 + rng() * 0.4);
    rock.position.set(Math.cos(angle) * dist, r * 0.22, Math.sin(angle) * Math.min(dist, beam * 2.4));
    rock.rotation.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5);
    rock.castShadow = true;
    scatter.add(rock);
  }

  return scatter;
}

/**
 * Public entry point: returns `{ model, scatter, rollRad, sinkFactor }` for any
 * wreck in `src/data/sites.js`, dispatching to bespoke real-wreck geometries first.
 */
export function buildRealWreckAssembly(wreck, rng, length, beam, height) {
  const mats = getSharedWreckMaterials();
  let model;
  let rollRad = THREE.MathUtils.degToRad(6 + rng() * 14) * (rng() < 0.5 ? -1 : 1);
  let sinkFactor = 0.26 + rng() * 0.14;

  // Bespoke models for the historically researched Öresund wrecks
  switch (wreck.id) {
    case 'wreck-s-s-robert':
      model = buildSSRobert(rng, length * 1.35, beam * 1.25, height * 1.22, mats);
      rollRad = THREE.MathUtils.degToRad(8); // sits upright with documented 8° list
      sinkFactor = 0.22;
      break;
    case 'wreck-johannes-l':
      model = buildJohannesL(rng, length * 1.15, beam * 1.15, height * 1.15, mats);
      rollRad = THREE.MathUtils.degToRad(-76); // documented resting on her port side!
      sinkFactor = 0.32;
      break;
    case 'wreck-cimbria':
      model = buildCimbria(rng, length * 1.28, beam * 1.2, height * 1.2, mats);
      rollRad = THREE.MathUtils.degToRad(11);
      sinkFactor = 0.28;
      break;
    case 'wreck-s-s-emil-r-retzlaff':
      model = buildEmilRetzlaff(rng, length * 1.3, beam * 1.2, height * 1.18, mats);
      rollRad = THREE.MathUtils.degToRad(-9);
      sinkFactor = 0.26;
      break;
    case 'wreck-s-s-polaris':
      model = buildSSPolaris(rng, length * 1.2, beam * 1.15, height * 1.15, mats);
      rollRad = THREE.MathUtils.degToRad(10);
      sinkFactor = 0.24;
      break;
    case 'wreck-k7-bevakningsfartyg':
      model = buildK7Patrol(rng, length * 1.2, beam * 1.18, height * 1.18, mats);
      rollRad = THREE.MathUtils.degToRad(7);
      sinkFactor = 0.24;
      break;
    default: {
      const t = (wreck.type || '').toLowerCase();
      if (t.includes('concrete')) {
        model = buildConcreteCaisson(rng, length * 1.1, beam * 1.25, height * 1.1, mats);
        rollRad = THREE.MathUtils.degToRad(4 + rng() * 7) * (rng() < 0.5 ? -1 : 1);
      } else if (t === 'landing craft') {
        model = buildTrawlerOrLandingCraft(rng, length * 1.15, beam * 1.3, height * 1.05, true, mats);
        rollRad = THREE.MathUtils.degToRad(6);
      } else if (t.includes('sailing') || t.includes('schooner') || t.includes('barque') || t.includes('galeas')) {
        model = buildWoodenSailingWreck(rng, length * 1.18, beam * 1.15, height * 1.18, wreck, mats);
        if (wreck.id === 'wreck-ceylon-af-bergkvara') rollRad = THREE.MathUtils.degToRad(4); // upright on keel
      } else if (t.includes('steam') || t === 'cargo ship') {
        model = buildDetailedSteamer(rng, length * 1.22, beam * 1.18, height * 1.18, mats);
      } else {
        model = buildTrawlerOrLandingCraft(rng, length * 1.18, beam * 1.18, height * 1.18, false, mats);
      }
      break;
    }
  }

  const scatter = buildWreckSiteScatter(rng, length * 1.15, beam * 1.15, mats);
  return { model, scatter, rollRad, sinkFactor };
}
