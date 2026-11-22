import * as THREE from 'three';
import { REEFS, WRECKS, PLACES } from '../data/sites.js';
import { buildRealWreckAssembly } from './wrecks.js';

const REEF_ACCENT = '#35a898';
const WRECK_ACCENT = '#d46b34';
const PLACE_ACCENT = '#c4964f';

const REEF_PALETTE = ['#668077', '#7f9389', '#8a7a5f', '#536862', '#9b8d72'];

export function createMarkers(heightmap, sitesData = null) {
  const reefsList = sitesData ? sitesData.reefs : REEFS;
  const wrecksList = sitesData ? sitesData.wrecks : WRECKS;
  const placesList = sitesData ? sitesData.places : PLACES;

  const group = new THREE.Group();
  group.name = 'markers';

  const reefsGroup = new THREE.Group();
  reefsGroup.name = 'reefs';
  const wrecksGroup = new THREE.Group();
  wrecksGroup.name = 'wrecks';
  const placesGroup = new THREE.Group();
  placesGroup.name = 'places';

  const siteEntries = new Map();
  const labelEntries = [];
  const animatedBeacons = [];
  const interactiveMeshes = [];
  const worldPosTmp = new THREE.Vector3();

  function registerSite(kind, data, siteGroup, baseGroundY, labelEntry, ringMesh) {
    const entry = {
      id: data.id,
      kind,
      data,
      group: siteGroup,
      baseGroundY,
      labelEntry,
      ringMesh,
    };
    siteEntries.set(data.id, entry);

    siteGroup.traverse((obj) => {
      if (obj.isMesh || obj.isSprite) {
        obj.userData.siteId = data.id;
        obj.userData.siteKind = kind;
        interactiveMeshes.push(obj);
      }
    });
  }

  for (const reef of reefsList) {
    const built = buildReef(reef, heightmap, labelEntries, animatedBeacons);
    reefsGroup.add(built.group);
    registerSite('reef', reef, built.group, built.baseGroundY, built.labelEntry, built.ringMesh);
  }
  for (const wreck of wrecksList) {
    const built = buildWreck(wreck, heightmap, labelEntries, animatedBeacons);
    wrecksGroup.add(built.group);
    registerSite('wreck', wreck, built.group, built.baseGroundY, built.labelEntry, built.ringMesh);
  }
  for (const place of placesList) {
    const built = buildPlace(place, heightmap, labelEntries);
    placesGroup.add(built.group);
    registerSite('place', place, built.group, built.baseGroundY, built.labelEntry, null);
  }

  group.add(reefsGroup, wrecksGroup, placesGroup);

  let selectedSiteId = null;
  let hoveredSiteId = null;
  let labelsEnabled = true;
  let reliefScale = 1.0;
  const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function setSelectedSite(siteId) {
    selectedSiteId = siteId || null;
    for (const [id, entry] of siteEntries) {
      if (entry.ringMesh) {
        const isSel = id === selectedSiteId;
        entry.ringMesh.visible = isSel;
        entry.ringMesh.material.opacity = isSel ? 0.58 : 0.0;
      }
    }
  }

  function setHoveredSite(siteId) {
    hoveredSiteId = siteId || null;
  }

  function setLabelsVisible(visible) {
    labelsEnabled = visible;
    for (const item of labelEntries) {
      item.sprite.visible = visible;
    }
  }

  function setVerticalScale(scale) {
    reliefScale = scale;
    for (const entry of siteEntries.values()) {
      if (entry.kind === 'reef') {
        entry.group.traverse((child) => {
          if (child.userData.baseGroundY !== undefined) {
            child.position.y = child.userData.baseGroundY * scale + (child.userData.localYOffset || 0);
          }
        });
      } else {
        entry.group.position.y = entry.baseGroundY * scale;
      }
    }
  }

  function getSiteCameraView(siteId) {
    const entry = siteEntries.get(siteId);
    if (!entry) return null;
    const [x, z] = entry.data.position;
    const y = entry.baseGroundY * reliefScale;

    if (entry.kind === 'wreck') {
      const dist = Math.max(52, (entry.data.length || 30) * 2.05);
      const baseHeading = entry.data.heading || 0;
      // Evaluate 8 azimuths around the wreck and pick the most unobstructed
      // valley-side vantage point (lowest terrain between camera & wreck).
      let bestPos = null;
      let bestScore = Infinity;
      for (let i = 0; i < 8; i++) {
        const angle = baseHeading + 0.65 + (i * Math.PI) / 4;
        const cx = x + Math.cos(angle) * dist;
        const cz = z + Math.sin(angle) * dist;
        const hCam = heightmap.getHeightAt(cx, cz) * reliefScale;
        const hMid = heightmap.getHeightAt((x + cx) * 0.5, (z + cz) * 0.5) * reliefScale;
        const score = Math.max(hCam, hMid);
        if (score < bestScore) {
          bestScore = score;
          const cy = Math.max(y + dist * 0.46, hCam + 22, hMid + 18);
          bestPos = [cx, cy, cz];
        }
      }
      return {
        position: bestPos,
        target: [x, y + 4.5, z],
        duration: 1.35,
      };
    }
    if (entry.kind === 'reef') {
      const dist = Math.max(95, (entry.data.radius || 40) * 2.6);
      const cx = x + dist * 0.78;
      const cz = z + dist * 0.72;
      const hCam = heightmap.getHeightAt(cx, cz) * reliefScale;
      return {
        position: [cx, Math.max(y + dist * 0.55, hCam + 24), cz],
        target: [x, y + 6, z],
        duration: 1.35,
      };
    }
    const cx = x + 115;
    const cz = z + 135;
    const hCam = heightmap.getHeightAt(cx, cz) * reliefScale;
    return {
      position: [cx, Math.max(y + 92, hCam + 28), cz],
      target: [x, y + 6, z],
      duration: 1.35,
    };
  }

  function update(camera, elapsed) {
    const reduceMotion = Boolean(reducedMotionQuery?.matches);

    for (const item of labelEntries) {
      const { sprite, aspect, minHeight, maxHeight, distFactor, siteId, baseY } = item;
      const isHighlighted = siteId === selectedSiteId || siteId === hoveredSiteId;

      if (!labelsEnabled && !isHighlighted) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      if (!sprite.parent || !sprite.parent.visible) continue;

      sprite.getWorldPosition(worldPosTmp);
      const dist = camera.position.distanceTo(worldPosTmp);

      const targetH = THREE.MathUtils.clamp(
        dist * distFactor * (isHighlighted ? 1.15 : 1.0),
        minHeight,
        maxHeight
      );
      sprite.scale.set(targetH * aspect, targetH, 1);

      let alpha = 0.92;
      if (!isHighlighted && dist < 68) {
        alpha = THREE.MathUtils.smoothstep(dist, 30, 68) * 0.92;
      } else if (!isHighlighted && dist > 1500) {
        alpha = (1.0 - THREE.MathUtils.smoothstep(dist, 1500, 2100) * 0.55) * 0.92;
      }
      sprite.material.opacity = isHighlighted ? 1.0 : alpha;
      sprite.position.y = baseY + (isHighlighted ? 2.2 : 0);
    }

    for (const b of animatedBeacons) {
      b.beacon.getWorldPosition(worldPosTmp);
      const dist = camera.position.distanceTo(worldPosTmp);
      // Hide beacon poles cleanly during wreck close-ups so the real ship hull shines unobstructed
      b.beacon.visible = dist > 115;
      if (b.beacon.visible && !reduceMotion) {
        b.head.rotation.y = elapsed * 0.7 + b.phase;
        b.head.position.y = b.baseY + Math.sin(elapsed * 1.8 + b.phase) * 0.45;
      }
    }

    if (selectedSiteId) {
      const sel = siteEntries.get(selectedSiteId);
      if (sel && sel.ringMesh && !reduceMotion) {
        sel.ringMesh.material.opacity = 0.42 + Math.sin(elapsed * 3.0) * 0.22;
      }
    }
  }

  function dispose() {
    for (const item of labelEntries) {
      if (item.sprite.material?.map) item.sprite.material.map.dispose();
      if (item.sprite.material) item.sprite.material.dispose();
    }
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
    });
  }

  return {
    group,
    update,
    setVerticalScale,
    setSelectedSite,
    setHoveredSite,
    setLabelsVisible,
    getSiteCameraView,
    getSiteById: (id) => siteEntries.get(id) || null,
    getInteractiveObjects: () => interactiveMeshes,
    setReefsVisible(v) {
      reefsGroup.visible = v;
    },
    setWrecksVisible(v) {
      wrecksGroup.visible = v;
    },
    setPlacesVisible(v) {
      placesGroup.visible = v;
    },
    dispose,
  };
}

// ---------------------------------------------------------------------------
// Deterministic PRNG
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

function hashFloat(a, b, salt) {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep01(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Sleek editorial cartographic label sprites
// ---------------------------------------------------------------------------

const LABEL_FONT_FAMILY = '"JetBrains Mono", ui-monospace, Menlo, monospace';

function createLabelSprite(text, options = {}) {
  const {
    accentColor = '#d46b34',
    textColor = '#eef2f1',
    fontSizePx = 22,
    worldHeight = 11,
  } = options;

  const dpr = 4;
  const fontPx = fontSizePx * dpr;
  const paddingX = fontPx * 0.56;
  const paddingY = fontPx * 0.36;

  const spaced = text.toUpperCase().split('').join(' ');
  const fontSpec = `500 ${fontPx}px ${LABEL_FONT_FAMILY}`;

  const measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = fontSpec;
  const textWidth = measureCtx.measureText(spaced).width;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(textWidth + paddingX * 2);
  canvas.height = Math.ceil(fontPx + paddingY * 2);
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const radius = fontPx * 0.22;

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
  ctx.fillStyle = 'rgba(30, 41, 43, 0.86)';
  ctx.fill();

  // Crisp left accent bar inside the slate tag (matching the ÖRESUND editorial tag)
  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, Math.max(8, fontPx * 0.14), h);

  ctx.font = fontSpec;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(spaced, w / 2 + fontPx * 0.05, h / 2 + fontPx * 0.03);

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
  const aspect = w / h;
  sprite.scale.set(worldHeight * aspect, worldHeight, 1);
  return { sprite, aspect };
}

// ---------------------------------------------------------------------------
// Minimal refined beacon pin + terrain-draped selection ring
// ---------------------------------------------------------------------------

function buildBeacon(groundY, color, { approximate = false, phase = 0 } = {}, animatedBeacons) {
  const beacon = new THREE.Group();
  beacon.name = 'beacon';

  const height = 23;
  const stemGeo = new THREE.CylinderGeometry(0.16, 0.24, height, 6);
  const stemMat = new THREE.MeshStandardMaterial({
    color: '#c2c8c6',
    roughness: 0.55,
    metalness: 0.35,
  });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = groundY + height / 2;

  const headGeo = new THREE.OctahedronGeometry(1.75, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: approximate ? 0.35 : 0.75,
    roughness: 0.3,
    metalness: 0.2,
    wireframe: approximate,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  const headBaseY = groundY + height;
  head.position.y = headBaseY;

  animatedBeacons.push({ beacon, head, baseY: headBaseY, phase });
  beacon.add(stem, head);
  return beacon;
}

function buildSeabedRing(radius, color, heightmap, x, z, yaw = 0) {
  const geo = new THREE.RingGeometry(radius * 0.93, radius, 48);
  geo.rotateX(-Math.PI / 2);

  if (heightmap) {
    const pos = geo.attributes.position;
    const baseGround = heightmap.getHeightAt(x, z);
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = x + lx * cosY + lz * sinY;
      const wz = z - lx * sinY + lz * cosY;
      pos.setY(i, heightmap.getHeightAt(wx, wz) - baseGround + 0.6);
    }
    pos.needsUpdate = true;
  }

  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.visible = false;
  return ring;
}

// ---------------------------------------------------------------------------
// Wrecks — delegates to bespoke historically researched 3D models
// ---------------------------------------------------------------------------

function buildWreck(wreck, heightmap, labelEntries, animatedBeacons) {
  const rng = mulberry32(hashString(wreck.id));
  const [x, z] = wreck.position;
  const groundY = heightmap.getHeightAt(x, z);

  const length = wreck.length;
  const beam = length * (0.2 + rng() * 0.04);
  const height = length * (0.15 + rng() * 0.03);

  const wreckGroup = new THREE.Group();
  wreckGroup.name = `wreck-${wreck.id}`;
  wreckGroup.position.set(x, groundY, z);
  wreckGroup.rotation.y = wreck.heading;

  const { model, scatter, rollRad, sinkFactor } = buildRealWreckAssembly(wreck, rng, length, beam, height);

  const listGroup = new THREE.Group();
  listGroup.rotation.z = rollRad;
  listGroup.position.y = height * (0.52 - sinkFactor);

  model.traverse((o) => {
    if (o.isMesh) o.receiveShadow = false;
  });
  listGroup.add(model);
  wreckGroup.add(listGroup, scatter);

  const ringMesh = buildSeabedRing(Math.max(16, length * 0.68), WRECK_ACCENT, heightmap, x, z, wreck.heading);
  wreckGroup.add(ringMesh);

  const isApproximate = Boolean(wreck.approximate);
  const phase = rng() * Math.PI * 2;
  wreckGroup.add(buildBeacon(0, WRECK_ACCENT, { approximate: isApproximate, phase }, animatedBeacons));

  const labelText = isApproximate ? `≈ ${wreck.name}` : wreck.name;
  const { sprite: label, aspect } = createLabelSprite(labelText, {
    accentColor: WRECK_ACCENT,
    worldHeight: 10,
  });
  const baseY = 29;
  label.position.set(0, baseY, 0);
  wreckGroup.add(label);

  const labelEntry = {
    sprite: label,
    aspect,
    minHeight: 2.8,
    maxHeight: 14,
    distFactor: 0.017,
    siteId: wreck.id,
    baseY,
  };
  labelEntries.push(labelEntry);

  return { group: wreckGroup, baseGroundY: groundY, labelEntry, ringMesh };
}

// ---------------------------------------------------------------------------
// Reefs / Boulder shoals — sculpted mossy moraine outcrops
// ---------------------------------------------------------------------------

function buildSculptedBoulderGeometry(rng, detail = 1) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const topColor = new THREE.Color(pick(rng, REEF_PALETTE));
  const baseColor = new THREE.Color('#2d3e3a');
  const tmp = new THREE.Color();

  const sx = 0.8 + rng() * 0.65;
  const sy = 0.52 + rng() * 0.48;
  const sz = 0.8 + rng() * 0.65;
  const seedA = rng() * 100;

  for (let i = 0; i < pos.count; i++) {
    let vx = pos.getX(i);
    let vy = pos.getY(i);
    let vz = pos.getZ(i);
    const n = hashFloat(Math.round(vx * 7 + seedA), Math.round(vz * 7 - seedA), Math.round(vy * 7));
    const displace = 0.76 + n * 0.44;
    vx *= sx * displace;
    vy *= sy * displace;
    vz *= sz * displace;
    pos.setXYZ(i, vx, vy, vz);

    const topBlend = smoothstep01(-0.25, 0.55, vy);
    tmp.copy(baseColor).lerp(topColor, topBlend);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function buildReef(reef, heightmap, labelEntries, animatedBeacons) {
  const rng = mulberry32(hashString(reef.id));
  const [cx, cz] = reef.position;
  const count = 16 + Math.floor(rng() * 8);

  const reefGroup = new THREE.Group();
  reefGroup.name = `reef-${reef.id}`;

  const boulderMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.04,
    flatShading: true,
  });

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * reef.radius;
    const x = cx + Math.cos(angle) * dist;
    const z = cz + Math.sin(angle) * dist;
    const y = heightmap.getHeightAt(x, z);

    const scale = i < 6 ? 2.8 + rng() * 4.0 : 1.0 + rng() * 2.4;
    const geo = buildSculptedBoulderGeometry(rng, i < 6 ? 1 : 0);
    const shape = new THREE.Mesh(geo, boulderMat);
    const localYOffset = scale * 0.25;
    shape.scale.setScalar(scale);
    shape.position.set(x, y + localYOffset, z);
    shape.userData.baseGroundY = y;
    shape.userData.localYOffset = localYOffset;
    shape.rotation.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5);
    shape.castShadow = true;
    shape.receiveShadow = true;
    reefGroup.add(shape);
  }

  const beaconY = heightmap.getHeightAt(cx, cz);
  const anchorGroup = new THREE.Group();
  anchorGroup.position.set(cx, beaconY, cz);
  anchorGroup.userData.baseGroundY = beaconY;
  anchorGroup.userData.localYOffset = 0;

  const ringMesh = buildSeabedRing(reef.radius * 0.78, REEF_ACCENT, heightmap, cx, cz, 0);
  anchorGroup.add(ringMesh);

  const beacon = buildBeacon(0, REEF_ACCENT, { phase: rng() * Math.PI * 2 }, animatedBeacons);
  anchorGroup.add(beacon);

  const { sprite: label, aspect } = createLabelSprite(reef.name, {
    accentColor: REEF_ACCENT,
    worldHeight: 10,
  });
  const baseY = 29;
  label.position.set(0, baseY, 0);
  anchorGroup.add(label);

  reefGroup.add(anchorGroup);

  const labelEntry = {
    sprite: label,
    aspect,
    minHeight: 3.0,
    maxHeight: 14,
    distFactor: 0.017,
    siteId: reef.id,
    baseY,
  };
  labelEntries.push(labelEntry);

  return { group: reefGroup, baseGroundY: beaconY, labelEntry, ringMesh };
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

function buildPlace(place, heightmap, labelEntries) {
  const [x, z] = place.position;
  const groundY = heightmap.getHeightAt(x, z);

  const placeGroup = new THREE.Group();
  placeGroup.name = `place-${place.id}`;
  placeGroup.position.set(x, groundY, z);

  const isCity = place.kind === 'city';
  const isTown = place.kind === 'town';
  const discRadius = isCity ? 2.8 : isTown ? 2.0 : 1.4;
  const pinHeight = isCity ? 6.5 : isTown ? 4.5 : 3.5;

  const discMat = new THREE.MeshStandardMaterial({
    color: PLACE_ACCENT,
    roughness: 0.5,
    metalness: 0.45,
  });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(discRadius, discRadius, 0.4, 14), discMat);
  disc.position.y = 0.2;
  placeGroup.add(disc);

  const pinMat = new THREE.MeshStandardMaterial({
    color: '#e0dcd0',
    roughness: 0.55,
    metalness: 0.25,
  });
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, pinHeight, 6), pinMat);
  pin.position.y = pinHeight / 2 + 0.4;
  placeGroup.add(pin);

  const { sprite: label, aspect } = createLabelSprite(place.name, {
    accentColor: PLACE_ACCENT,
    textColor: isCity ? '#ffffff' : '#e4eae8',
    fontSizePx: isCity ? 24 : 20,
    worldHeight: isCity ? 11 : isTown ? 9 : 7.5,
  });
  const baseY = 20;
  label.position.set(0, baseY, 0);
  placeGroup.add(label);

  const labelEntry = {
    sprite: label,
    aspect,
    minHeight: isCity ? 3.8 : 2.6,
    maxHeight: isCity ? 15 : isTown ? 11.5 : 9.5,
    distFactor: isCity ? 0.019 : isTown ? 0.015 : 0.013,
    siteId: place.id,
    baseY,
  };
  labelEntries.push(labelEntry);

  return { group: placeGroup, baseGroundY: groundY, labelEntry };
}
