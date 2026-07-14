import * as THREE from 'three';

// y = 0 is the former waterline (see the terrain/heightmap coordinate
// convention); this is how deep the plane sinks when fully drained.
const WATER_HIDDEN_Y = -95;
const WATER_VISIBLE_Y = 0;
const TWEEN_DURATION = 2.5; // seconds, rise <-> drain

// Gentle animated swell: a few low-amplitude sines summed with different
// wavelengths/directions/speeds so the surface doesn't read as perfectly
// periodic. dirX/dirZ are unit vectors (propagation direction); amplitudes
// sum to ~0.35 world units.
const WAVES = [
  { amp: 0.16, wavelength: 70, dirX: 0.8, dirZ: 0.6, speed: 0.28 },
  { amp: 0.12, wavelength: 115, dirX: -0.45, dirZ: 0.893, speed: -0.19 },
  { amp: 0.07, wavelength: 165, dirX: 0.6, dirZ: -0.8, speed: 0.14 },
];

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * A rise/drain water plane covering the former sound. Starts hidden and
 * sunk below the terrain; setEnabled(true) tweens it up to the old
 * waterline, setEnabled(false) tweens it back down and hides it.
 * @param {number} size terrain size (world units per side)
 */
export function createWater(size = 1200) {
  const planeSize = size * 1.02; // slightly larger so the edge clears the terrain bounds
  const segments = 96;
  const geometry = new THREE.PlaneGeometry(planeSize, planeSize, segments, segments);
  geometry.rotateX(-Math.PI / 2); // lie flat in the XZ plane, matching terrain.js

  const material = new THREE.MeshPhysicalMaterial({
    color: '#215870', // Öresund blue-teal
    transparent: true,
    opacity: 0.8,
    roughness: 0.12,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water';
  mesh.visible = false;
  mesh.position.y = WATER_HIDDEN_Y;
  mesh.renderOrder = 1; // draw after the (opaque, renderOrder 0) terrain so alpha blending sorts correctly
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  let enabled = false;
  let lastElapsed = 0;
  let tweenFromY = WATER_HIDDEN_Y;
  let tweenToY = WATER_HIDDEN_Y;
  let tweenStartElapsed = 0;

  function setEnabled(visible) {
    enabled = visible;
    tweenFromY = mesh.position.y; // current (possibly mid-tween) height, so toggling reverses smoothly
    tweenToY = visible ? WATER_VISIBLE_Y : WATER_HIDDEN_Y;
    tweenStartElapsed = lastElapsed;
    if (visible) mesh.visible = true; // show immediately so the rise animates; hidden only once the drain finishes
  }

  function update(dt, elapsed) {
    lastElapsed = elapsed;

    const t = Math.min(1, Math.max(0, (elapsed - tweenStartElapsed) / TWEEN_DURATION));
    mesh.position.y = THREE.MathUtils.lerp(tweenFromY, tweenToY, easeInOutCubic(t));
    if (t >= 1 && !enabled) {
      mesh.visible = false;
    }

    if (!mesh.visible) return; // fully drained and settled — skip the wave pass

    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      let h = 0;
      let dhdx = 0;
      let dhdz = 0;
      for (const w of WAVES) {
        const k = (Math.PI * 2) / w.wavelength;
        const phase = (x * w.dirX + z * w.dirZ) * k + elapsed * w.speed;
        const s = Math.sin(phase);
        const c = Math.cos(phase);
        h += w.amp * s;
        dhdx += w.amp * c * k * w.dirX;
        dhdz += w.amp * c * k * w.dirZ;
      }
      position.setY(i, h);
      // Heightfield normal from the analytic gradient — cheaper and smoother
      // than computeVertexNormals() every frame at this vertex count.
      const nx = -dhdx;
      const nz = -dhdz;
      const len = Math.sqrt(nx * nx + 1 + nz * nz) || 1;
      normal.setXYZ(i, nx / len, 1 / len, nz / len);
    }
    position.needsUpdate = true;
    normal.needsUpdate = true;
  }

  return { mesh, update, setEnabled };
}
