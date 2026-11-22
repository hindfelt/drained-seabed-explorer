import * as THREE from 'three';
import { SEA_EXAGGERATION } from '../data/heightmap.js';

const MIN_METERS = -52; // fully drained (sunk below deepest trench)
const MAX_METERS = 0; // former sea level
const TWEEN_DURATION = 2.4; // seconds for toggle rise <-> drain

const HEIGHT_ENCODE_MIN = -130;
const HEIGHT_ENCODE_MAX = 55;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Packs the heightmap Float32Array into a 16-bit-per-sample RG DataTexture so
 * the water shader can sample exact terrain depth everywhere with linear filtering
 * on all WebGL2 GPUs (no float-texture linear extension needed).
 */
function createHeightDataTexture(heightmap) {
  const N = heightmap.resolution + 1;
  const data = new Uint8Array(N * N * 4);
  const span = HEIGHT_ENCODE_MAX - HEIGHT_ENCODE_MIN;

  for (let i = 0; i < N * N; i++) {
    const norm = Math.min(1, Math.max(0, (heightmap.heights[i] - HEIGHT_ENCODE_MIN) / span));
    const v16 = Math.round(norm * 65535);
    data[i * 4] = (v16 >> 8) & 0xff;
    data[i * 4 + 1] = v16 & 0xff;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }

  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * GPU shader-driven water plane covering the Öresund block footprint:
 * - Beer-Lambert depth absorption (turquoise over Disken/shoals -> deep Nordic navy in trenches)
 * - Dynamic animated shoreline foam hugging Ven, coasts, and reefs at ANY sea level
 * - Multi-octave GPU swell + fine capillary ripple normal perturbation + Fresnel sky reflections
 * - Supports both smooth Fill/Drain toggle and continuous Sea Level scrubbing (-52m .. 0m)
 */
export function createWater(heightmap, { sunDirection, sunColor } = {}) {
  const size = heightmap.size;
  const seaExag = heightmap.seaExaggeration || SEA_EXAGGERATION;
  const minMeters = Math.min(-15, Math.floor((heightmap.minMeters ?? -50) * 1.06));
  const maxMeters = MAX_METERS;
  const segments = 160;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const heightTex = createHeightDataTexture(heightmap);

  const waterUniforms = {
    uTime: { value: 0 },
    uHeightMap: { value: heightTex },
    uTerrainSize: { value: size },
    uReliefScale: { value: 1.0 },
    uSunDir: { value: sunDirection ? sunDirection.clone() : new THREE.Vector3(0.6, 0.4, -0.5).normalize() },
    uSunColor: { value: sunColor ? sunColor.clone() : new THREE.Color(0xffd194) },
  };

  const material = new THREE.MeshPhysicalMaterial({
    color: '#1b556b',
    transparent: true,
    opacity: 0.9,
    roughness: 0.14,
    metalness: 0.05,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
    reflectivity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.uniforms.uHeightMap = waterUniforms.uHeightMap;
    shader.uniforms.uTerrainSize = waterUniforms.uTerrainSize;
    shader.uniforms.uReliefScale = waterUniforms.uReliefScale;
    shader.uniforms.uSunDir = waterUniforms.uSunDir;
    shader.uniforms.uSunColor = waterUniforms.uSunColor;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec3 vWaterWorldPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          // Multi-directional GPU ocean swell
          float w1 = sin(dot(transformed.xz, vec2(0.068, 0.048)) + uTime * 0.95) * 0.18;
          float w2 = sin(dot(transformed.xz, vec2(-0.036, 0.072)) - uTime * 0.72) * 0.13;
          float w3 = sin(dot(transformed.xz, vec2(0.030, -0.041)) + uTime * 0.55) * 0.08;
          transformed.y += w1 + w2 + w3;
        }`
      )
      .replace(
        '#include <project_vertex>',
        `vWaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #include <project_vertex>`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform sampler2D uHeightMap;
        uniform float uTerrainSize;
        uniform float uReliefScale;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        varying vec3 vWaterWorldPos;

        float wHash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 19.19);
          return fract(p.x * p.y);
        }

        float wNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
            mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        float wRippleHeight(vec2 xz, float t) {
          vec2 p1 = xz * 0.28 + vec2(t * 0.24, t * 0.17);
          vec2 p2 = xz * 0.54 + vec2(-t * 0.19, t * 0.28);
          vec2 p3 = xz * 1.15 + vec2(t * 0.31, -t * 0.22);
          return (wNoise(p1) * 0.55 + wNoise(p2) * 0.30 + wNoise(p3) * 0.15) - 0.5;
        }

        float sampleTerrainWorldY(vec2 xz) {
          vec2 uv = clamp((xz + uTerrainSize * 0.5) / uTerrainSize, 0.0, 1.0);
          vec4 enc = texture2D(uHeightMap, uv);
          float norm = (enc.r * 255.0 * 256.0 + enc.g * 255.0) / 65535.0;
          float baseY = mix(${HEIGHT_ENCODE_MIN.toFixed(1)}, ${HEIGHT_ENCODE_MAX.toFixed(1)}, norm);
          return baseY * uReliefScale;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float waterDepth = 10.0;
        float shorelineFoam = 0.0;
        float rippleH = 0.0;
        {
          float terrainY = sampleTerrainWorldY(vWaterWorldPos.xz);
          waterDepth = vWaterWorldPos.y - terrainY;
          if (waterDepth < -0.35) discard;

          rippleH = wRippleHeight(vWaterWorldPos.xz, uTime);

          // Beer-Lambert depth absorption: shallow shoals glow Baltic turquoise,
          // deep channels sink into dark Nordic marine blue.
          float depthShallow = smoothstep(0.0, 10.0 * uReliefScale, max(waterDepth, 0.0));
          float depthDeep = smoothstep(8.0 * uReliefScale, 52.0 * uReliefScale, max(waterDepth, 0.0));

          vec3 colTurquoise = vec3(0.24, 0.58, 0.58);
          vec3 colMid       = vec3(0.09, 0.31, 0.42);
          vec3 colDeep      = vec3(0.03, 0.11, 0.20);

          vec3 waterCol = mix(colTurquoise, colMid, depthShallow);
          waterCol = mix(waterCol, colDeep, depthDeep);

          // Dynamic animated shoreline foam hugging Ven, shoals & coasts
          float foamZone = 1.0 - smoothstep(0.0, 3.8 * max(0.7, uReliefScale), max(waterDepth, 0.0));
          float waveLap = sin(waterDepth * 2.4 - uTime * 2.1 + rippleH * 5.0) * 0.5 + 0.5;
          float foamNoise = wNoise(vWaterWorldPos.xz * 0.42 + vec2(uTime * 0.12, -uTime * 0.09));
          float foamEdge = smoothstep(0.32, 0.72, foamZone * (0.62 + 0.38 * waveLap) * (0.65 + 0.55 * foamNoise));
          float tightLip = 1.0 - smoothstep(0.0, 0.65, max(waterDepth, 0.0));
          shorelineFoam = clamp(max(foamEdge * 0.85, tightLip * 0.75), 0.0, 1.0);

          // Subtle edge-of-water transparency feathering so shorelines sit seamlessly on sand
          float edgeAlpha = smoothstep(-0.2, 1.1, waterDepth);
          float depthAlpha = mix(0.62, 0.94, depthShallow);
          diffuseColor.rgb = mix(waterCol, vec3(0.92, 0.94, 0.93), shorelineFoam * 0.88);
          diffuseColor.a = clamp(max(depthAlpha * edgeAlpha, shorelineFoam * 0.92), 0.0, 0.96);
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.78, shorelineFoam);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Fine animated capillary ripple normal perturbation
          float bumpStrength = mix(0.52, 0.15, shorelineFoam);
          vec3 dPosX = dFdx(-vViewPosition);
          vec3 dPosY = dFdy(-vViewPosition);
          float dBx = dFdx(rippleH);
          float dBy = dFdy(rippleH);
          vec3 r1 = cross(dPosY, normal);
          vec3 r2 = cross(normal, dPosX);
          float det = dot(dPosX, r1);
          if (abs(det) > 1e-6) {
            vec3 surfGrad = sign(det) * (dBx * r1 + dBy * r2);
            normal = normalize(abs(det) * normal - bumpStrength * surfGrad);
          }
        }`
      );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water';
  mesh.visible = false;
  mesh.position.y = minMeters * seaExag;
  mesh.renderOrder = 1;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  let currentMeters = minMeters;
  let reliefScale = 1.0;
  let lastElapsed = 0;
  let tweening = false;
  let tweenFromM = minMeters;
  let tweenToM = minMeters;
  let tweenStartElapsed = 0;
  let onLevelChangeCb = null;

  function applyHeight() {
    const worldY = currentMeters * seaExag * reliefScale;
    mesh.position.y = worldY;
    mesh.visible = currentMeters > minMeters + Math.max(0.35, Math.abs(minMeters) * 0.008);
    if (onLevelChangeCb) onLevelChangeCb(currentMeters, worldY);
  }

  function setEnabled(visible) {
    tweenFromM = currentMeters;
    tweenToM = visible ? maxMeters : minMeters;
    tweenStartElapsed = lastElapsed;
    tweening = true;
    if (visible) mesh.visible = true;
  }

  function setTargetMeters(meters) {
    tweening = false;
    currentMeters = THREE.MathUtils.clamp(meters, minMeters, maxMeters);
    applyHeight();
  }

  function setVerticalScale(scale) {
    reliefScale = scale;
    waterUniforms.uReliefScale.value = scale;
    applyHeight();
  }

  function onLevelChange(cb) {
    onLevelChangeCb = cb;
  }

  function getWorldY() {
    return currentMeters * seaExag * reliefScale;
  }

  function update(dt, elapsed) {
    lastElapsed = elapsed;
    waterUniforms.uTime.value = elapsed;
    if (sunDirection) waterUniforms.uSunDir.value.copy(sunDirection);
    if (sunColor) waterUniforms.uSunColor.value.copy(sunColor);

    if (tweening) {
      const t = Math.min(1, Math.max(0, (elapsed - tweenStartElapsed) / TWEEN_DURATION));
      currentMeters = THREE.MathUtils.lerp(tweenFromM, tweenToM, easeInOutCubic(t));
      applyHeight();
      if (t >= 1) tweening = false;
    }
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    heightTex.dispose();
  }

  return {
    mesh,
    minMeters,
    maxMeters,
    update,
    setEnabled,
    setTargetMeters,
    setVerticalScale,
    onLevelChange,
    getWorldY,
    getCurrentMeters: () => currentMeters,
    dispose,
  };
}
