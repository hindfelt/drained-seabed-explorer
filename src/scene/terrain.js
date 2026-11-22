import * as THREE from 'three';
import {
  createTerrainMaterial,
  createGeologicalSkirtMaterial,
  applyTerrainColors,
} from '../materials/terrainMaterial.js';

const SKIRT_BASE_Y = -148;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Multi-scale cavity ambient occlusion baked per vertex from the heightmap so
 * sculpted canyon hollows, cliff ledges, and rock crevices have museum-grade depth.
 */
function computeCavityAttribute(heightmap) {
  const { resolution, heights } = heightmap;
  const N = resolution + 1;
  const cavity = new Float32Array(N * N);

  const sample = (ix, iz) => {
    const cx = ix < 0 ? 0 : ix >= N ? N - 1 : ix;
    const cz = iz < 0 ? 0 : iz >= N ? N - 1 : iz;
    return heights[cz * N + cx];
  };

  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const h = heights[iz * N + ix];

      const avgSmall =
        (sample(ix - 2, iz) +
          sample(ix + 2, iz) +
          sample(ix, iz - 2) +
          sample(ix, iz + 2)) *
        0.25;

      const avgMed =
        (sample(ix - 6, iz) +
          sample(ix + 6, iz) +
          sample(ix, iz - 6) +
          sample(ix, iz + 6) +
          sample(ix - 4, iz - 4) +
          sample(ix + 4, iz - 4) +
          sample(ix - 4, iz + 4) +
          sample(ix + 4, iz + 4)) *
        0.125;

      const avgWide =
        (sample(ix - 14, iz) +
          sample(ix + 14, iz) +
          sample(ix, iz - 14) +
          sample(ix, iz + 14)) *
        0.25;

      const occlusion =
        0.68 +
        Math.tanh((h - avgSmall) * 0.25) * 0.2 +
        Math.tanh((h - avgMed) * 0.11) * 0.24 +
        Math.tanh((h - avgWide) * 0.045) * 0.14;

      cavity[iz * N + ix] = Math.min(1, Math.max(0, occlusion));
    }
  }

  return new THREE.BufferAttribute(cavity, 1);
}

/**
 * Builds the 4 stratified rock-cut geological walls + solid bottom cap.
 * Subdivides vertically into 8 strata rows with slight organic rock fracture
 * relief so the cross-section reads like a hand-cut geological core block.
 */
function buildGeologicalSkirt(heightmap) {
  const { size, resolution, heights } = heightmap;
  const N = resolution + 1;
  const half = size / 2;
  const vRows = 8;

  const positions = [];
  const normals = [];
  const indices = [];

  function pushWall(edgePoints, nx, ny, nz, flipWinding) {
    const baseIndex = positions.length / 3;
    const cols = edgePoints.length;

    for (let i = 0; i < cols; i++) {
      const [x, topY, z] = edgePoints[i];
      for (let r = 0; r <= vRows; r++) {
        const t = r / vRows; // 0 = top rim (exact match), 1 = flat base
        const y = topY + (SKIRT_BASE_Y - topY) * t;
        // Subtle organic rock-fracture protrusion on middle strata rows (0 at rim & corners)
        const edgeFade = Math.sin(t * Math.PI) * Math.min(1, i / 6) * Math.min(1, (cols - 1 - i) / 6);
        const along = Math.abs(nx) > 0.5 ? z : x;
        const relief =
          (Math.sin(along * 0.045 + y * 0.12) * 1.4 + Math.cos(along * 0.13 - y * 0.22) * 0.7) *
          edgeFade;

        positions.push(x + nx * relief, y, z + nz * relief);
        normals.push(nx, ny, nz);
      }
    }

    const stride = vRows + 1;
    for (let i = 0; i < cols - 1; i++) {
      for (let r = 0; r < vRows; r++) {
        const a = baseIndex + i * stride + r;
        const b = a + 1;
        const c = baseIndex + (i + 1) * stride + r;
        const d = c + 1;
        if (flipWinding) {
          indices.push(a, c, b, c, d, b);
        } else {
          indices.push(a, b, c, c, b, d);
        }
      }
    }
  }

  const north = [];
  for (let ix = 0; ix < N; ix++) {
    north.push([-half + (ix / resolution) * size, heights[ix], -half]);
  }
  pushWall(north, 0, 0, -1, true);

  const south = [];
  for (let ix = 0; ix < N; ix++) {
    south.push([-half + (ix / resolution) * size, heights[resolution * N + ix], half]);
  }
  pushWall(south, 0, 0, 1, false);

  const west = [];
  for (let iz = 0; iz < N; iz++) {
    west.push([-half, heights[iz * N], -half + (iz / resolution) * size]);
  }
  pushWall(west, -1, 0, 0, false);

  const east = [];
  for (let iz = 0; iz < N; iz++) {
    east.push([half, heights[iz * N + resolution], -half + (iz / resolution) * size]);
  }
  pushWall(east, 1, 0, 0, true);

  // Solid bottom cap
  const capStart = positions.length / 3;
  positions.push(
    -half, SKIRT_BASE_Y, -half,
    half, SKIRT_BASE_Y, -half,
    half, SKIRT_BASE_Y, half,
    -half, SKIRT_BASE_Y, half
  );
  for (let i = 0; i < 4; i++) normals.push(0, -1, 0);
  indices.push(capStart, capStart + 1, capStart + 2, capStart, capStart + 2, capStart + 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);

  const mesh = new THREE.Mesh(geo, createGeologicalSkirtMaterial());
  mesh.name = 'terrain-skirt';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Single-draw-call instanced seabed boulders & talus cobbles scattered across
 * valley floors, canyon bases, and coastal cliff skirts — giving the close-up
 * and mid-range seabed that rich tactile diorama stone scatter.
 */
function buildInstancedSeabedRocks(heightmap) {
  const rng = mulberry32(424242);
  const count = 720;

  // Sculpt a jagged rock prototype geometry
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  const pos = rockGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 0.76 + (Math.sin(x * 7.3 + y * 5.1) * Math.cos(z * 6.7) * 0.5 + 0.5) * 0.42;
    pos.setXYZ(i, x * n * 1.15, y * n * 0.68, z * n * 1.05);
  }
  pos.needsUpdate = true;
  rockGeo.computeVertexNormals();

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.05,
    flatShading: true,
  });

  const instanced = new THREE.InstancedMesh(rockGeo, rockMat, count);
  instanced.name = 'seabed-boulders';
  instanced.castShadow = true;
  instanced.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const rockSwatches = [
    '#445a54', // oxidized sea-green boulder
    '#576961', // mossy teal stone
    '#6d5438', // warm iron-ochre rock
    '#4b4236', // dark umber cobble
    '#7c6e58', // weathered limestone
    '#343f3e', // deep slate stone
  ];

  const half = heightmap.size * 0.47;
  let placed = 0;
  let attempts = 0;

  while (placed < count && attempts < count * 8) {
    attempts++;
    const x = (rng() * 2 - 1) * half;
    const z = (rng() * 2 - 1) * half;
    const y = heightmap.getHeightAt(x, z);

    // Concentrate boulders on the drained seabed & cliff bases (y < 6)
    if (y > 6 && rng() > 0.14) continue;

    // Slight clustering around slopes & shoal flanks
    const s1 = heightmap.getHeightAt(x + 4, z);
    const s2 = heightmap.getHeightAt(x, z + 4);
    const slope = Math.hypot(s1 - y, s2 - y) / 4;
    if (slope < 0.06 && rng() > 0.45) continue;

    const scale = rng() < 0.16 ? 2.4 + rng() * 3.8 : 0.9 + rng() * 1.9;
    dummy.position.set(x, y + scale * 0.18, z);
    dummy.rotation.set((rng() - 0.5) * 0.6, rng() * Math.PI * 2, (rng() - 0.5) * 0.6);
    dummy.scale.set(
      scale * (0.85 + rng() * 0.45),
      scale * (0.65 + rng() * 0.55),
      scale * (0.85 + rng() * 0.45)
    );
    dummy.updateMatrix();
    instanced.setMatrixAt(placed, dummy.matrix);

    const swatch = rockSwatches[Math.floor(rng() * rockSwatches.length)];
    color.set(swatch).multiplyScalar(0.82 + rng() * 0.34);
    instanced.setColorAt(placed, color);
    placed++;
  }

  instanced.count = placed;
  instanced.instanceMatrix.needsUpdate = true;
  if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  return instanced;
}

/**
 * Soft studio contact shadow underneath the 3D geological block so it floats
 * cleanly over the archival drafting paper backdrop.
 */
function buildStudioShadowPlane(size) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  // Soft square radial falloff
  const pad = 34;
  ctx.filter = 'blur(18px)';
  ctx.fillStyle = 'rgba(20, 28, 30, 0.32)';
  ctx.fillRect(pad, pad, 256 - pad * 2, 256 - pad * 2);

  const tex = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(size * 1.24, size * 1.24);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.72,
  });
  const plane = new THREE.Mesh(geo, mat);
  plane.position.y = SKIRT_BASE_Y - 12;
  plane.name = 'studio-contact-shadow';
  return plane;
}

/**
 * Builds the displaced, cavity-shaded, boulder-scattered 3D diorama terrain block.
 */
export function createTerrain(heightmap) {
  const group = new THREE.Group();
  group.name = 'terrain-block';

  const geometry = new THREE.PlaneGeometry(
    heightmap.size,
    heightmap.size,
    heightmap.resolution,
    heightmap.resolution
  );
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, heightmap.getHeightAt(x, z));
  }
  position.needsUpdate = true;

  geometry.computeVertexNormals();
  geometry.setAttribute('aCavity', computeCavityAttribute(heightmap));
  applyTerrainColors(geometry, heightmap);

  const material = createTerrainMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const skirt = buildGeologicalSkirt(heightmap);
  const boulders = buildInstancedSeabedRocks(heightmap);
  const studioShadow = buildStudioShadowPlane(heightmap.size);

  group.add(mesh, skirt, boulders, studioShadow);

  function setVerticalScale(scale) {
    group.scale.y = scale;
  }

  function setContoursVisible(visible) {
    material.userData.terrainUniforms.uContours.value = visible ? 1 : 0;
  }

  function setSatelliteVisible(visible) {
    material.userData.terrainUniforms.uSatelliteBlend.value = visible ? 1 : 0;
  }

  function setWaterLevel(worldY) {
    material.userData.terrainUniforms.uWaterLevel.value = worldY;
  }

  function setStudioShadowVisible(visible) {
    studioShadow.visible = visible;
  }

  return {
    group,
    mesh,
    skirt,
    material,
    setVerticalScale,
    setContoursVisible,
    setSatelliteVisible,
    setWaterLevel,
    setStudioShadowVisible,
  };
}
