import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TERRAIN_SIZE = 1200;
const SKY_COLOR = 0xd8c9a8; // pale dusty haze
const GROUND_COLOR = 0x4a3c2e; // dark dried mud
const SUN_COLOR = 0xffd9a0; // warm late-afternoon light

/**
 * Builds the renderer, camera, lights and controls for the drained seabed scene.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, controls: OrbitControls, onFrame(cb: (dt: number, elapsed: number) => void): void, start(): void }}
 */
export function createScene(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 900, 3200);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    2,
    6000
  );
  camera.position.set(480, 420, 480);
  camera.lookAt(0, -60, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  // Sun: low warm directional light, positioned high and far so shadows rake
  // long across the terrain and emphasize canyon depth / reef height.
  const sun = new THREE.DirectionalLight(SUN_COLOR, 3);
  sun.position.set(700, 550, -350);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const shadowCam = sun.shadow.camera;
  const margin = TERRAIN_SIZE / 2 + 800;
  shadowCam.left = -margin;
  shadowCam.right = margin;
  shadowCam.top = margin;
  shadowCam.bottom = -margin;
  const sunDistance = sun.position.length();
  shadowCam.near = sunDistance - 1200;
  shadowCam.far = sunDistance + 1200;
  // Negative bias + normalBias avoid shadow acne on the terrain's large, low-poly triangles.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 1.5;
  scene.add(sun);
  scene.add(sun.target);

  // 0.95 keeps shadow pools (scour hole, cliff bases) readable instead of pitch black.
  const hemi = new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, 0.95);
  scene.add(hemi);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, -50, 0);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
  controls.minDistance = 30;
  controls.maxDistance = 2000;
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.update();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const frameCallbacks = [];
  function onFrame(cb) {
    frameCallbacks.push(cb);
  }

  const clock = new THREE.Clock();
  function start() {
    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta();
      const elapsed = clock.getElapsedTime();
      controls.update();
      for (const cb of frameCallbacks) cb(dt, elapsed);
      renderer.render(scene, camera);
    });
  }

  return { scene, camera, renderer, controls, onFrame, start };
}
