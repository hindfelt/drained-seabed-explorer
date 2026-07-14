import { generateHeightmap } from './data/heightmap.js';
import { createScene } from './scene/setup.js';
import { createTerrain } from './scene/terrain.js';
import { createMarkers } from './scene/markers.js';
import { createWater } from './scene/water.js';
import { initOverlay } from './ui/overlay.js';

const canvas = document.getElementById('scene');

const heightmap = generateHeightmap();
const { scene, camera, controls, onFrame, start } = createScene(canvas);

scene.add(createTerrain(heightmap));

const markers = createMarkers(heightmap);
scene.add(markers.group);

const water = createWater(heightmap.size);
scene.add(water.mesh);
onFrame((dt, elapsed) => water.update(dt, elapsed));

initOverlay({
  onToggleReefs: (visible) => markers.setReefsVisible(visible),
  onToggleWrecks: (visible) => markers.setWrecksVisible(visible),
  onTogglePlaces: (visible) => markers.setPlacesVisible(visible),
  onToggleWater: (visible) => water.setEnabled(visible),
});

start();

// Dev/debug handle for scripted camera moves and state inspection.
window.__viz = { camera, controls, markers, heightmap, water };
