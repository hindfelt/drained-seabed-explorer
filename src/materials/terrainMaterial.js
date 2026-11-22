import * as THREE from 'three';

const SATELLITE_ASSET_URL = new URL('../assets/satellite-land.jpg', import.meta.url).href;

function createFallbackSatelliteTexture() {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Editorial cartographic diorama terrain material:
 * - Sculpted mineral palette matching museum bathymetric reliefs:
 *     * Deep eroded valleys & current channels in oxidized verdigris / sea-green & aqua-slate
 *     * Sweeping pale silt flow striations carving down the Öresund strait
 *     * Terraced sedimentary cliff faces & coastal ridges in vivid iron-ochre,
 *       burnt sienna, warm sandstone gold, and dark basalt charcoal
 * - High-frequency world-space micro-relief (stratified rock grain, directional
 *   flow ripples, weathered mineral pitting) via Mikkelsen view-space derivatives
 * - Strong baked cavity ambient occlusion (aCavity) for crisp sculptural crevices
 * - Optional Sentinel-2 satellite drape over land (uSatelliteBlend, toggleable)
 * - Optional subtle anti-aliased bathymetric depth contour lines (uContours)
 */
export function createTerrainMaterial() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.04,
  });

  const terrainUniforms = {
    uSatelliteMap: { value: createFallbackSatelliteTexture() },
    uSatelliteReady: { value: 0 },
    uSatelliteBlend: { value: 0 }, // 0 = unified sculpted mineral diorama, 1 = satellite drape on land
    uContours: { value: 0 }, // subtle optional contour overlay (off by default for pure diorama look)
    uWaterLevel: { value: -125 },
  };
  material.userData.satelliteUniforms = terrainUniforms;
  material.userData.terrainUniforms = terrainUniforms;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSatelliteMap = terrainUniforms.uSatelliteMap;
    shader.uniforms.uSatelliteReady = terrainUniforms.uSatelliteReady;
    shader.uniforms.uSatelliteBlend = terrainUniforms.uSatelliteBlend;
    shader.uniforms.uContours = terrainUniforms.uContours;
    shader.uniforms.uWaterLevel = terrainUniforms.uWaterLevel;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aCavity;
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;
        varying float vTerrainBaseY;
        varying float vCavity;`
      )
      .replace(
        '#include <project_vertex>',
        `vTerrainBaseY = position.y;
        vCavity = aCavity;
        vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        #include <project_vertex>`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;
        varying float vTerrainBaseY;
        varying float vCavity;
        uniform sampler2D uSatelliteMap;
        uniform float uSatelliteReady;
        uniform float uSatelliteBlend;
        uniform float uContours;
        uniform float uWaterLevel;

        float tHash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float tNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = tHash21(i);
          float b = tHash21(i + vec2(1.0, 0.0));
          float c = tHash21(i + vec2(0.0, 1.0));
          float d = tHash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        float tFbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += a * tNoise(p);
            p = m * p * 2.06 + vec2(17.1, 31.7);
            a *= 0.5;
          }
          return v;
        }

        float tRidged(vec2 p) {
          float v = 0.0;
          float a = 0.55;
          mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
          for (int i = 0; i < 3; i++) {
            float n = 1.0 - abs(tNoise(p) * 2.0 - 1.0);
            v += a * n * n;
            p = m * p * 2.15 + vec2(9.2, 23.4);
            a *= 0.48;
          }
          return v;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float microH = 0.0;
        float rockyMask = 0.0;
        float flowStriation = 0.0;
        {
          vec3 wn = normalize(vTerrainWorldNormal);
          float slope = clamp(wn.y, 0.0, 1.0);
          float cliffMask = 1.0 - smoothstep(0.45, 0.86, slope);
          float isLand = smoothstep(-2.0, 4.0, vTerrainBaseY);
          rockyMask = clamp(max(cliffMask * 1.15, isLand * 0.55), 0.0, 1.0);

          vec2 xz = vTerrainWorldPos.xz;

          // Flowing current-swept seabed striations curving down the Öresund valley
          float flowWarp = tFbm(xz * 0.015) * 18.0 + tFbm(xz * 0.045) * 4.5;
          float streamA = sin((xz.x * 0.24 + xz.y * 0.05) + flowWarp * 0.28);
          float streamB = sin((xz.x * 0.52 - xz.y * 0.12) + flowWarp * 0.48) * 0.5;
          flowStriation = (streamA * 0.65 + streamB * 0.35) * (1.0 - rockyMask * 0.78);

          // Organic non-periodic sedimentary rock strata (noise-sampled layers + vertical fractures,
          // avoiding artificial uniform zebra pinstripes on steep cliffs like Ven's Backafall)
          float strataWarp = tFbm(xz * 0.024) * 7.5 + tFbm(xz * 0.085) * 2.2;
          float strataY = vTerrainBaseY * 0.16 + strataWarp * 0.32;
          float layerA = tNoise(vec2(strataY * 1.15, 2.7));
          float layerB = tNoise(vec2(strataY * 2.6 + tNoise(xz * 0.06) * 0.6, 11.4));
          float rockFracture = tRidged(xz * 0.12 + vec2(vTerrainBaseY * 0.04));
          float verticalJoint = tFbm(vec2(xz.x * 0.16 + xz.y * 0.14, vTerrainBaseY * 0.035));

          // Moody sculptural mineral rock palette matching the reference diorama:
          // deep weathered basalt-slate, dark umber ledges, warm iron-ochre veins, muted sandstone
          vec3 darkBasalt    = vec3(0.11, 0.135, 0.14);
          vec3 darkUmber     = vec3(0.24, 0.185, 0.13);
          vec3 ironOchre     = vec3(0.58, 0.37, 0.155);
          vec3 warmSandstone = vec3(0.64, 0.54, 0.36);
          vec3 verdigrisMoss = vec3(0.21, 0.34, 0.31);

          vec3 strataCol = mix(darkBasalt, darkUmber, smoothstep(0.22, 0.78, layerA));
          // Ochre ironstone veins appear in organic patches, modulated by rock fractures
          float ochreVein = smoothstep(0.56, 0.86, layerB) * smoothstep(0.32, 0.78, rockFracture + 0.18);
          strataCol = mix(strataCol, ironOchre, ochreVein * 0.82);
          float paleVein = smoothstep(0.70, 0.94, layerA * layerB * 1.35) * smoothstep(0.35, 0.8, verticalJoint);
          strataCol = mix(strataCol, warmSandstone, paleVein * 0.52);

          // Darken vertical crag crevices & oxidized sea-green moss clinging to rock shelves
          strataCol *= 0.72 + verticalJoint * 0.48;
          float mossNoise = tFbm(xz * 0.038 + vec2(4.2, 11.7));
          strataCol = mix(strataCol, verdigrisMoss, smoothstep(0.46, 0.76, mossNoise) * (1.0 - cliffMask * 0.45) * 0.58);

          // Mineral seabed valley shading: swept pale sea-green sand streaks + dark teal crevices
          vec3 paleSweep = vec3(0.54, 0.67, 0.60);
          vec3 deepVerdigris = vec3(0.13, 0.24, 0.24);
          float sweepMask = smoothstep(-0.15, 0.75, flowStriation) * (1.0 - isLand);
          diffuseColor.rgb = mix(diffuseColor.rgb, paleSweep, sweepMask * 0.28);
          diffuseColor.rgb = mix(diffuseColor.rgb, deepVerdigris, smoothstep(0.2, -0.75, flowStriation) * (1.0 - isLand) * 0.26);

          // Blend stratified ochre/basalt rock onto cliffs, terraced ledges, and craggy land crests
          float strataBlend = clamp(cliffMask * 0.92 + isLand * 0.58 * smoothstep(0.30, 0.75, tFbm(xz * 0.022)), 0.0, 0.96);
          diffuseColor.rgb = mix(diffuseColor.rgb, strataCol, strataBlend);

          // Fine granular rock/silt micro-texture so surfaces feel tactile like stone & clay
          float rockGrit = tRidged(xz * 0.24);
          float fineSpeck = tNoise(xz * 1.15) - 0.5;
          diffuseColor.rgb *= 0.84 + rockGrit * 0.28 + fineSpeck * 0.08;

          // Optional Sentinel-2 satellite drape over flatter land areas
          float landSatMask = smoothstep(1.2, 4.5, vTerrainBaseY) * uSatelliteReady * uSatelliteBlend * (1.0 - cliffMask * 0.78);
          if (landSatMask > 0.005) {
            vec2 satUv = clamp(
              vec2((vTerrainWorldPos.x + 600.0) / 1200.0, (600.0 - vTerrainWorldPos.z) / 1200.0),
              0.0, 1.0
            );
            vec3 satelliteSample = texture2D(uSatelliteMap, satUv).rgb;
            float satLuma = dot(satelliteSample, vec3(0.299, 0.587, 0.114));
            satelliteSample = mix(vec3(satLuma), satelliteSample, 1.05);
            diffuseColor.rgb = mix(diffuseColor.rgb, satelliteSample, landSatMask);
          }

          // Deep sculptural cavity ambient occlusion (dark crevices, crisp lit ridges)
          float ao = mix(0.42, 1.14, clamp(vCavity, 0.0, 1.0));
          diffuseColor.rgb *= ao;

          // Wet darkened band right around the dynamic rising/draining waterline
          float distToWater = vTerrainWorldPos.y - uWaterLevel;
          float wetBand = smoothstep(4.2, -0.5, distToWater) * smoothstep(-105.0, -90.0, uWaterLevel);
          diffuseColor.rgb *= mix(1.0, 0.68, wetBand * 0.85);

          // Optional subtle anti-aliased bathymetric contour hairlines
          if (uContours > 0.5 && vTerrainBaseY < 1.2) {
            float meters = vTerrainBaseY / 2.15;
            float fw = max(fwidth(meters), 0.02);
            float m5 = abs(fract(meters / 5.0 + 0.5) - 0.5) * 5.0;
            float line5 = 1.0 - smoothstep(fw * 0.6, fw * 1.4, m5);
            float m15 = abs(fract(meters / 15.0 + 0.5) - 0.5) * 15.0;
            float line15 = 1.0 - smoothstep(fw * 0.7, fw * 1.6, m15);
            float detailFade = 1.0 - smoothstep(1.2, 3.2, fw);
            float subMask = 1.0 - smoothstep(-0.4, 0.2, meters);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.14, 0.14), line5 * 0.18 * subMask * detailFade);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.75, 0.54), line15 * 0.28 * subMask * detailFade);
          }

          // Micro-heightfield driving crisp view-space normal perturbation
          microH = flowStriation * 0.34 * (1.0 - cliffMask)
                 + (layerB - 0.5) * 0.75 * cliffMask
                 + (rockFracture - 0.5) * 0.92 * cliffMask
                 + (rockGrit - 0.5) * 0.68
                 + fineSpeck * 0.18;
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          // Matte tactile stone/clay diorama finish with slight sheen on damp waterline
          float waterWet = smoothstep(3.5, -0.4, vTerrainWorldPos.y - uWaterLevel) * smoothstep(-105.0, -90.0, uWaterLevel);
          roughnessFactor = mix(0.90, 0.78, rockyMask * 0.5);
          roughnessFactor = mix(roughnessFactor, 0.48, waterWet * 0.8);
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // High-detail view-space surface gradient bump (Mikkelsen)
          float bumpStrength = mix(0.75, 1.35, rockyMask);
          vec3 dPosX = dFdx(-vViewPosition);
          vec3 dPosY = dFdy(-vViewPosition);
          float dBx = dFdx(microH);
          float dBy = dFdy(microH);
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

  loadSatelliteTexture(material);

  return material;
}

/**
 * Rich, vividly stratified geological cross-section material for the 3D cutaway
 * diorama block edges — burnt sienna, golden iron-ochre, pale Danian chalk,
 * slate clay, and dark charcoal bedrock with undulating natural rock fractures.
 */
export function createGeologicalSkirtMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.04,
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSkirtLocalPos;\nvarying vec3 vSkirtWorldPos;\nvarying vec3 vSkirtNormal;'
      )
      .replace(
        '#include <project_vertex>',
        'vSkirtLocalPos = position;\nvSkirtWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSkirtNormal = normal;\n#include <project_vertex>'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSkirtLocalPos;
        varying vec3 vSkirtWorldPos;
        varying vec3 vSkirtNormal;

        float sHash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }
        float sNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x),
            mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }
        float sFbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * sNoise(p);
            p = p * 2.07 + vec2(13.1, 29.3);
            a *= 0.5;
          }
          return v;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float skirtBump = 0.0;
        {
          if (vSkirtNormal.y < -0.5) {
            diffuseColor.rgb = vec3(0.11, 0.12, 0.125);
          } else {
            float along = abs(vSkirtNormal.x) > 0.5 ? vSkirtLocalPos.z : vSkirtLocalPos.x;
            float foldWave = (sFbm(vec2(along * 0.006, 1.7)) - 0.5) * 28.0
                           + (sFbm(vec2(along * 0.022, 6.3)) - 0.5) * 9.0;
            float y = vSkirtLocalPos.y + foldWave;

            // Vivid geological strata matching the reference cross-section
            vec3 darkBedrock  = vec3(0.12, 0.13, 0.135);
            vec3 burntSienna  = vec3(0.46, 0.24, 0.11);
            vec3 paleChalk    = vec3(0.74, 0.68, 0.54);
            vec3 goldenOchre  = vec3(0.68, 0.44, 0.17);
            vec3 slateTill    = vec3(0.24, 0.28, 0.27);
            vec3 rustCap      = vec3(0.55, 0.32, 0.14);

            vec3 col = darkBedrock;
            col = mix(col, burntSienna, smoothstep(-132.0, -118.0, y));
            col = mix(col, paleChalk,   smoothstep(-105.0, -90.0, y) * (1.0 - smoothstep(-76.0, -64.0, y)));
            col = mix(col, slateTill,   smoothstep(-74.0, -58.0, y));
            col = mix(col, goldenOchre, smoothstep(-46.0, -32.0, y) * (1.0 - smoothstep(-18.0, -8.0, y)));
            col = mix(col, rustCap,     smoothstep(-14.0, 2.0, y));
            col = mix(col, slateTill * 0.85, smoothstep(14.0, 28.0, y));

            // Fine rock bedding striations + vertical joint cracks
            float fineStrata = sin(y * 0.85 + sNoise(vec2(along * 0.04, y * 0.08)) * 2.4) * 0.5 + 0.5;
            float microGrain = sFbm(vec2(along * 0.09, y * 0.18));
            float verticalCrack = smoothstep(0.76, 0.92, sNoise(vec2(along * 0.085, y * 0.018)));

            col *= 0.80 + fineStrata * 0.26 + (microGrain - 0.5) * 0.22;
            col *= 1.0 - verticalCrack * 0.38;

            // Subtle ambient darkening near base & top seam
            float baseFade = smoothstep(-148.0, -124.0, vSkirtLocalPos.y);
            col *= mix(0.62, 1.0, baseFade);

            diffuseColor.rgb = col;
            skirtBump = fineStrata * 0.55 + microGrain * 0.65 - verticalCrack * 0.75;
          }
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (vSkirtNormal.y > -0.5) {
          vec3 dPosX = dFdx(-vViewPosition);
          vec3 dPosY = dFdy(-vViewPosition);
          float dBx = dFdx(skirtBump);
          float dBy = dFdy(skirtBump);
          vec3 r1 = cross(dPosY, normal);
          vec3 r2 = cross(normal, dPosX);
          float det = dot(dPosX, r1);
          if (abs(det) > 1e-6) {
            vec3 surfGrad = sign(det) * (dBx * r1 + dBy * r2);
            normal = normalize(abs(det) * normal - 1.15 * surfGrad);
          }
        }`
      );
  };

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
    () => {}
  );
}

// Sculpted diorama mineral palette (inspired by museum bathymetric reliefs):
// Oxidized verdigris / sea-green valleys & channels, pale aqua-sand shelves,
// warm ochre/umber cliff terraces, dark charcoal-slate mountain crests.
const VALLEY_DEEP = new THREE.Color('#203a3b'); // deepest trench: rich dark teal-slate
const VALLEY_MID = new THREE.Color('#3c6862'); // mid seabed: luminous mineral verdigris
const VALLEY_SHALLOW = new THREE.Color('#6a8f83'); // shallow swept shelf: pale oxidized sea-green
const SALT_SAND = new THREE.Color('#b6a888'); // pale swept mineral sandbar
const CLIFF_OCHRE = new THREE.Color('#8e602e'); // warm iron-ochre sedimentary cliff
const CLIFF_UMBER = new THREE.Color('#473b2c'); // dark umber rock
const LAND_MOSS = new THREE.Color('#4a5f52'); // muted coastal mossy green-slate
const LAND_CREST = new THREE.Color('#2d3735'); // dramatic dark charcoal-slate ridge crest

export function applyTerrainColors(geometry, heightmap) {
  const posAttr = geometry.attributes.position;
  const normalAttr = geometry.attributes.normal;
  const count = posAttr.count;
  const colors = new Float32Array(count * 3);

  const seabed = new THREE.Color();
  const land = new THREE.Color();
  const mixed = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const ny = normalAttr.getY(i);

    // --- Seabed (y < 0): rich oxidized verdigris / sea-green valleys ---
    const shallowFactor = smoothstep(-58, -12, y);
    const deepFactor = smoothstep(-52, -96, y);
    const sandFlatFactor =
      smoothstep(-28, -8, y) * (1 - smoothstep(-4, 1, y)) * smoothstep(0.84, 0.97, ny);
    const rockSlopeFactor = 1 - smoothstep(0.58, 0.88, ny);

    seabed.copy(VALLEY_MID);
    seabed.lerp(VALLEY_SHALLOW, shallowFactor * 0.72);
    seabed.lerp(VALLEY_DEEP, deepFactor * 0.85);
    seabed.lerp(SALT_SAND, sandFlatFactor * 0.55);
    seabed.lerp(CLIFF_UMBER, rockSlopeFactor * 0.65);
    seabed.lerp(CLIFF_OCHRE, rockSlopeFactor * smoothstep(-35, 0, y) * 0.45);

    // --- Land (y >= 0): coastal ochre cliffs rising to dark slate & mossy ridges ---
    const ridgeHeight = smoothstep(4, 34, y);
    const cliffFactor = smoothstep(0.84, 0.50, ny);
    const deepCliff = smoothstep(0.58, 0.28, ny);

    land.copy(SALT_SAND).lerp(LAND_MOSS, smoothstep(0, 8, y));
    land.lerp(LAND_CREST, ridgeHeight * 0.78);
    land.lerp(CLIFF_OCHRE, cliffFactor * 0.82);
    land.lerp(CLIFF_UMBER, deepCliff * 0.75);

    const shoreFactor = smoothstep(-2.5, 2.5, y);
    mixed.copy(seabed).lerp(land, shoreFactor);

    const d = (hash2(x, z) - 0.5) * 0.04;
    colors[i * 3] = clamp01(mixed.r + d);
    colors[i * 3 + 1] = clamp01(mixed.g + d);
    colors[i * 3 + 2] = clamp01(mixed.b + d);
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

function hash2(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
