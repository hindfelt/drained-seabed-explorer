import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';

const TERRAIN_SIZE = 1200;

export const LIGHTING_PRESETS = {
  archival: {
    id: 'archival',
    label: 'Archival',
    isArchival: true,
    elevation: 28,
    azimuth: 124,
    turbidity: 4.5,
    rayleigh: 1.6,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.8,
    sunColor: 0xffe4bc,
    sunIntensity: 3.65,
    hemiSky: 0xdce7ec,
    hemiGround: 0x2f3b38,
    hemiIntensity: 1.05,
    rimColor: 0x93bcc4,
    rimIntensity: 0.72,
    fogColor: 0xe6e9ea,
    fogDensity: 0,
    exposure: 0.94,
    envIntensity: 0.36,
  },
  golden: {
    id: 'golden',
    label: 'Golden Hour',
    isArchival: false,
    elevation: 13,
    azimuth: 118,
    turbidity: 4.2,
    rayleigh: 2.4,
    mieCoefficient: 0.0045,
    mieDirectionalG: 0.86,
    sunColor: 0xffd08e,
    sunIntensity: 4.4,
    hemiSky: 0xbfd4ea,
    hemiGround: 0x2f3530,
    hemiIntensity: 0.88,
    rimColor: 0x7ea8d8,
    rimIntensity: 0.58,
    fogColor: 0xcabca4,
    fogDensity: 0.00017,
    exposure: 0.74,
    envIntensity: 0.34,
  },
  nordic: {
    id: 'nordic',
    label: 'Nordic Noon',
    isArchival: false,
    elevation: 42,
    azimuth: 165,
    turbidity: 2.4,
    rayleigh: 1.8,
    mieCoefficient: 0.003,
    mieDirectionalG: 0.8,
    sunColor: 0xfff5e4,
    sunIntensity: 3.9,
    hemiSky: 0xbcd8f4,
    hemiGround: 0x3b443e,
    hemiIntensity: 0.96,
    rimColor: 0x9bc0e8,
    rimIntensity: 0.45,
    fogColor: 0xb8cfe2,
    fogDensity: 0.00013,
    exposure: 0.70,
    envIntensity: 0.36,
  },
  dusk: {
    id: 'dusk',
    label: 'Baltic Dusk',
    isArchival: false,
    elevation: 5,
    azimuth: 248,
    turbidity: 7.5,
    rayleigh: 3.2,
    mieCoefficient: 0.007,
    mieDirectionalG: 0.88,
    sunColor: 0xff9254,
    sunIntensity: 4.2,
    hemiSky: 0x6b7fa6,
    hemiGround: 0x1e2625,
    hemiIntensity: 0.86,
    rimColor: 0x5c82c2,
    rimIntensity: 0.7,
    fogColor: 0x7c747b,
    fogDensity: 0.00021,
    exposure: 0.80,
    envIntensity: 0.32,
  },
};

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Builds the transparent-capable WebGLRenderer (for archival drafting grid backdrop),
 * physical Sky + PMREM IBL, 4K soft shadows, cool mineral rim light, OrbitControls,
 * and smooth camera fly-to controller.
 */
export function createScene(canvas) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    44,
    window.innerWidth / window.innerHeight,
    2,
    9000
  );
  camera.position.set(820, 440, 860);
  camera.lookAt(0, -45, 0);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHTING_PRESETS.archival.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Physical Sky dome (hidden in Archival mode so the crisp drafting paper grid shows through)
  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  const skyEnvScene = new THREE.Scene();
  const skyEnv = new Sky();
  skyEnv.scale.setScalar(100);
  skyEnvScene.add(skyEnv);
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  let currentEnvRT = null;

  // Primary directional sun with 4K PCF soft shadows
  const sun = new THREE.DirectionalLight(
    LIGHTING_PRESETS.archival.sunColor,
    LIGHTING_PRESETS.archival.sunIntensity
  );
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const shadowCam = sun.shadow.camera;
  const margin = TERRAIN_SIZE / 2 + 520;
  shadowCam.left = -margin;
  shadowCam.right = margin;
  shadowCam.top = margin;
  shadowCam.bottom = -margin;
  shadowCam.near = 100;
  shadowCam.far = 3600;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 1.4;
  scene.add(sun);
  scene.add(sun.target);

  // Opposite mineral-cool rim light to carve out stratified cliffs & rusted hulls
  const rimLight = new THREE.DirectionalLight(
    LIGHTING_PRESETS.archival.rimColor,
    LIGHTING_PRESETS.archival.rimIntensity
  );
  scene.add(rimLight);

  const hemi = new THREE.HemisphereLight(
    LIGHTING_PRESETS.archival.hemiSky,
    LIGHTING_PRESETS.archival.hemiGround,
    LIGHTING_PRESETS.archival.hemiIntensity
  );
  scene.add(hemi);

  const sunDirection = new THREE.Vector3();
  const sunColorObj = new THREE.Color(LIGHTING_PRESETS.archival.sunColor);

  let activePreset = { ...LIGHTING_PRESETS.archival };
  let envDirty = true;
  let lastEnvUpdate = -10;
  let onBackdropModeChangeCb = null;

  function rebuildEnvironment() {
    const nextRT = pmremGenerator.fromScene(skyEnvScene, 0.04);
    scene.environment = nextRT.texture;
    scene.environmentIntensity = activePreset.envIntensity;
    if (currentEnvRT) currentEnvRT.dispose();
    currentEnvRT = nextRT;
    envDirty = false;
  }

  function applySkyAndLights(updateEnvNow = false) {
    const phi = THREE.MathUtils.degToRad(90 - activePreset.elevation);
    const theta = THREE.MathUtils.degToRad(activePreset.azimuth);
    sunDirection.setFromSphericalCoords(1, phi, theta).normalize();

    const sunDist = 1400;
    sun.position.copy(sunDirection).multiplyScalar(sunDist);
    sun.color.setHex(activePreset.sunColor);
    sun.intensity = activePreset.sunIntensity;
    sunColorObj.copy(sun.color);

    rimLight.position.set(
      -sun.position.x * 0.72,
      Math.max(300, sun.position.y * 0.55),
      -sun.position.z * 0.72
    );
    rimLight.color.setHex(activePreset.rimColor);
    rimLight.intensity = activePreset.rimIntensity;

    hemi.color.setHex(activePreset.hemiSky);
    hemi.groundColor.setHex(activePreset.hemiGround);
    hemi.intensity = activePreset.hemiIntensity;

    renderer.toneMappingExposure = activePreset.exposure;

    for (const s of [sky, skyEnv]) {
      const u = s.material.uniforms;
      u.turbidity.value = activePreset.turbidity;
      u.rayleigh.value = activePreset.rayleigh;
      u.mieCoefficient.value = activePreset.mieCoefficient;
      u.mieDirectionalG.value = activePreset.mieDirectionalG;
      u.sunPosition.value.copy(sunDirection);
    }

    // Archival studio mode uses transparent clear over the crisp CSS drafting grid;
    // atmospheric sky presets enable the Sky dome + horizon fog.
    if (activePreset.isArchival) {
      sky.visible = false;
      scene.background = null;
      scene.fog = null;
    } else {
      sky.visible = true;
      scene.background = null;
      scene.fog = new THREE.FogExp2(activePreset.fogColor, activePreset.fogDensity);
    }

    if (onBackdropModeChangeCb) {
      onBackdropModeChangeCb(activePreset.isArchival ? 'archival' : 'sky');
    }

    if (updateEnvNow) {
      rebuildEnvironment();
    } else {
      envDirty = true;
    }
  }

  applySkyAndLights(true);

  function setLightingPreset(presetId) {
    const preset = LIGHTING_PRESETS[presetId];
    if (!preset) return;
    activePreset = { ...preset };
    applySkyAndLights(true);
  }

  function setSunAzimuth(azimuthDeg) {
    activePreset.azimuth = azimuthDeg;
    applySkyAndLights(false);
  }

  function onBackdropModeChange(cb) {
    onBackdropModeChangeCb = cb;
    cb(activePreset.isArchival ? 'archival' : 'sky');
  }

  // OrbitControls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.target.set(0, -45, 0);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(86.5);
  controls.minDistance = 24;
  controls.maxDistance = 2300;
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.update();

  // Hold Space + left-drag to pan (Figma/Photoshop-style hand tool)
  let spacePanActive = false;

  function isInteractiveTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return true;
    const btn = target.closest('button');
    return Boolean(btn && btn.matches(':focus-visible'));
  }

  function setSpacePan(active) {
    if (spacePanActive === active) return;
    spacePanActive = active;
    controls.mouseButtons.LEFT = active ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    canvas.classList.toggle('is-pan-mode', active);
    if (!active) canvas.classList.remove('is-panning');
  }

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    if (isInteractiveTarget(e.target)) return;
    e.preventDefault();
    if (!e.repeat) setSpacePan(true);
  });

  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    setSpacePan(false);
  });

  window.addEventListener('blur', () => setSpacePan(false));

  canvas.addEventListener('pointerdown', (e) => {
    if (spacePanActive && e.button === 0) {
      canvas.classList.add('is-panning');
    }
  });

  window.addEventListener('pointerup', () => {
    canvas.classList.remove('is-panning');
  });

  window.addEventListener('pointercancel', () => {
    canvas.classList.remove('is-panning');
  });

  // Smooth camera fly-to transitions
  let flight = null;
  const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  controls.addEventListener('start', () => {
    flight = null;
  });

  function flyTo({ position, target, duration = 1.35 }) {
    const endPos = new THREE.Vector3(...position);
    const endTarget = new THREE.Vector3(...target);
    if (reducedMotionQuery?.matches || duration <= 0) {
      flight = null;
      camera.position.copy(endPos);
      controls.target.copy(endTarget);
      controls.update();
      return;
    }
    flight = {
      startPos: camera.position.clone(),
      endPos,
      startTarget: controls.target.clone(),
      endTarget,
      elapsed: 0,
      duration,
    };
  }

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  const frameCallbacks = [];
  function onFrame(cb) {
    frameCallbacks.push(cb);
  }

  const clock = new THREE.Clock();
  function start() {
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();

      if (flight) {
        flight.elapsed += dt;
        const t = Math.min(1, flight.elapsed / flight.duration);
        const k = easeInOutCubic(t);
        camera.position.lerpVectors(flight.startPos, flight.endPos, k);
        controls.target.lerpVectors(flight.startTarget, flight.endTarget, k);
        if (t >= 1) flight = null;
      }

      if (envDirty && elapsed - lastEnvUpdate > 0.12) {
        rebuildEnvironment();
        lastEnvUpdate = elapsed;
      }

      controls.update();
      for (const cb of frameCallbacks) cb(dt, elapsed);
      renderer.render(scene, camera);
    });
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    sunDirection,
    sunColor: sunColorObj,
    setLightingPreset,
    setSunAzimuth,
    onBackdropModeChange,
    isSpacePanning: () => spacePanActive,
    flyTo,
    onFrame,
    start,
  };
}
