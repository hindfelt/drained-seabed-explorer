import * as THREE from 'three';

const SATELLITE_ASSET_URL = new URL('../assets/satellite-land.jpg', import.meta.url).href;

// 1x1 opaque black placeholder so the sampler2D uniform is always bound to a
// valid texture (avoids WebGL "no texture bound" warnings) before/unless the
// real satellite image finishes loading. uSatelliteReady gates the blend to
// 0 while this is in use, so it's never actually sampled into the output.
function createFallbackSatelliteTexture() {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Base material for the drained-seabed terrain mesh. Vertex colors (written
 * by applyTerrainColors) drive the look everywhere by default. If the real
 * satellite image finishes loading, onBeforeCompile blends it in over LAND
 * only, leaving the seabed/beach/tide bands exactly as painted. Missing or
 * failed asset -> stays on the procedural vertex-color look (mandatory
 * fallback; nothing swaps until the async load actually succeeds).
 */
export function createTerrainMaterial() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });

  const satelliteUniforms = {
    uSatelliteMap: { value: createFallbackSatelliteTexture() },
    uSatelliteReady: { value: 0 },
  };
  material.userData.satelliteUniforms = satelliteUniforms;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSatelliteMap = satelliteUniforms.uSatelliteMap;
    shader.uniforms.uSatelliteReady = satelliteUniforms.uSatelliteReady;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorldPos;')
      .replace(
        '#include <project_vertex>',
        'vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTerrainWorldPos;\nuniform sampler2D uSatelliteMap;\nuniform float uSatelliteReady;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Satellite imagery over LAND only -- seabed/beach/tide keep the
          // procedural palette. World x -600..+600 maps left->right; world
          // z -600..+600 maps top->bottom (north = -z), matching a north-up
          // source image under THREE's default flipY.
          float landFactor = smoothstep(0.5, 2.5, vTerrainWorldPos.y) * uSatelliteReady;
          vec2 satUv = clamp(
            vec2((vTerrainWorldPos.x + 600.0) / 1200.0, (600.0 - vTerrainWorldPos.z) / 1200.0),
            0.0, 1.0
          );
          vec3 satelliteSample = texture2D(uSatelliteMap, satUv).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, satelliteSample, landFactor);
        }`
      );
  };

  loadSatelliteTexture(material);

  return material;
}

function loadSatelliteTexture(material) {
  const loader = new THREE.TextureLoader();
  loader.load(
    SATELLITE_ASSET_URL,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      material.userData.satelliteUniforms.uSatelliteMap.value = texture;
      material.userData.satelliteUniforms.uSatelliteReady.value = 1;
    },
    undefined,
    () => {
      // Missing/failed asset: uSatelliteReady stays 0, procedural look stands.
    }
  );
}

// Seabed palette (y < 0, roughly -95..0): cool grey-brown across the wide
// shallow shelf (now the majority of the seabed area — real bathymetry),
// warming into the familiar mud tone at mid-depths, dark sediment in the
// channel trench, pale salt pans on genuinely flat shallow ground, bare
// rock on steep underwater faces.
const SHELF = new THREE.Color('#6c685a'); // shallow shelf, 0..-30 — clearly seabed, not land
const MUD = new THREE.Color('#8c7a5c');
const CANYON = new THREE.Color('#332c25');
const SALT = new THREE.Color('#ece2cf');
const ROCK = new THREE.Color('#5c5245');
const TIDE = new THREE.Color('#4a4237'); // former shoreline, just below y=0

// Land palette (y >= 0, roughly 0..+35): Öresund coast rising out of the
// drained strait — wet sand, Scanian farmland, drier grass, layered cliff.
const BEACH = new THREE.Color('#cabb95');
const FARMLAND = new THREE.Color('#9c9451'); // muted late-summer green-gold
const DRY_GRASS = new THREE.Color('#b8a468');
const CLIFF = new THREE.Color('#7a6a55'); // Ven-style glacial till/clay cliff
const CLIFF_DARK = new THREE.Color('#5f5244'); // deepest tone, steepest faces

/**
 * Writes a 'color' BufferAttribute onto geometry using elevation (world y)
 * and slope (normal.y) already baked into the displaced, normal-computed
 * geometry. Call AFTER displacement + computeVertexNormals().
 */
export function applyTerrainColors(geometry, heightmap) {
  const posAttr = geometry.attributes.position;
  const normalAttr = geometry.attributes.normal;
  const count = posAttr.count;
  const colors = new Float32Array(count * 3);

  const underwater = new THREE.Color();
  const land = new THREE.Color();
  const mixed = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const ny = normalAttr.getY(i);

    // --- Underwater chain: shallow shelf (~0..-30, the majority of the
    // seabed area under real bathymetry) reads as cool grey-brown, deepening
    // into the familiar mud tone through mid-depths (~-30..-60), channel
    // trench darkest toward -80..-95, tidal-flat salt pans on genuinely
    // flat shallow ground, steep rock.
    const shelfFactor = 1 - smoothstep(-22, -32, y); // shelf dominant through ~-30, handing off to mud
    const canyonFactor = smoothstep(-55, -80, y);
    const saltRiseFactor = smoothstep(-4, -9, y);
    const saltFallFactor = 1 - smoothstep(-21, -27, y);
    const saltElevFactor = saltRiseFactor * saltFallFactor; // ~-5..-25 shallow-flat band
    const saltFlatFactor = smoothstep(0.72, 0.94, ny);
    const saltFactor = saltElevFactor * saltFlatFactor;
    const seaSlopeFactor = (1 - smoothstep(0.62, 0.86, ny)) * 0.9;
    const tideFactor = 1 - smoothstep(0, 2, Math.abs(y + 1)); // marks old shoreline

    underwater.copy(MUD);
    underwater.lerp(SHELF, shelfFactor);
    underwater.lerp(CANYON, canyonFactor);
    underwater.lerp(SALT, saltFactor);
    underwater.lerp(ROCK, seaSlopeFactor);
    underwater.lerp(TIDE, tideFactor * 0.55);

    // --- Land chain: beach -> farmland -> drier grass -> layered cliff,
    // with steep faces (Ven's Backafall cliffs) pulled toward the darker
    // sediment tone regardless of absolute elevation. Full-strength ramps
    // (not partial lerps) so the cliff band actually saturates instead of
    // reading as a wash over the pale colors beneath.
    const farmFactor = smoothstep(2, 6, y);
    const dryFactor = smoothstep(16, 22, y);
    const highRockFactor = smoothstep(26, 34, y);
    const cliffFactor = smoothstep(0.85, 0.55, ny);
    const cliffDeepFactor = smoothstep(0.6, 0.3, ny); // steepest faces deepen further

    land.copy(BEACH);
    land.lerp(FARMLAND, farmFactor);
    land.lerp(DRY_GRASS, dryFactor);
    land.lerp(CLIFF, highRockFactor);
    land.lerp(CLIFF, cliffFactor);
    land.lerp(CLIFF_DARK, cliffDeepFactor);

    // Faint horizontal sediment strata on cliff faces: a low-frequency hash
    // of quantized elevation (not x/z) so bands run level across the face
    // like real glacial-till layers, gated to only show where it's cliffy.
    if (cliffFactor > 0.01) {
      const strataLayer = Math.floor(y / 2.4);
      const strataNoise = (hash2(strataLayer, 91.7) - 0.5) * 0.05 * cliffFactor;
      land.r = clamp01(land.r * (1 + strataNoise));
      land.g = clamp01(land.g * (1 + strataNoise));
      land.b = clamp01(land.b * (1 + strataNoise));
    }

    // Cross the old shoreline smoothly — this transition band is what
    // actually reads as "beach" between the tide mark and the farmland.
    const shoreFactor = smoothstep(-2, 1, y);
    mixed.copy(underwater);
    mixed.lerp(land, shoreFactor);

    // Deterministic per-vertex dithering (hash of position, no Math.random)
    // so elevation/slope bands never read as hard stripes.
    const d = (hash2(x, z) - 0.5) * 0.05;
    const warm = (hash2(z, x) - 0.5) * 0.02;

    colors[i * 3] = clamp01(mixed.r + d + warm);
    colors[i * 3 + 1] = clamp01(mixed.g + d);
    colors[i * 3 + 2] = clamp01(mixed.b + d - warm * 0.5);
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Deterministic 2D hash -> [0, 1). No Math.random anywhere.
function hash2(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
