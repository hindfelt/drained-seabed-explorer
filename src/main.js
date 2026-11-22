import * as THREE from 'three';
import { generateHeightmap, worldToGeo } from './data/heightmap.js';
import { createScene } from './scene/setup.js';
import { createTerrain } from './scene/terrain.js';
import { createMarkers } from './scene/markers.js';
import { createWater } from './scene/water.js';
import { initOverlay } from './ui/overlay.js';

const canvas = document.getElementById('scene');

const heightmap = generateHeightmap();
const {
  scene,
  camera,
  controls,
  sunDirection,
  sunColor,
  setLightingPreset,
  setSunAzimuth,
  onBackdropModeChange,
  isSpacePanning,
  flyTo,
  onFrame,
  start,
} = createScene(canvas);

const terrain = createTerrain(heightmap);
scene.add(terrain.group);

const markers = createMarkers(heightmap);
scene.add(markers.group);

const water = createWater(heightmap, { sunDirection, sunColor });
scene.add(water.mesh);

onBackdropModeChange((mode) => {
  document.body.dataset.backdrop = mode;
  terrain.setStudioShadowVisible(mode === 'archival');
});

let overlay = null;

water.onLevelChange((meters, worldY) => {
  terrain.setWaterLevel(worldY);
  if (overlay) overlay.syncSeaLevelDisplay(meters);
});

onFrame((dt, elapsed) => {
  water.update(dt, elapsed);
  markers.update(camera, elapsed);
});

function selectAndFocusSite(siteId, shouldFly = true) {
  const entry = markers.getSiteById(siteId);
  if (!entry) return;
  markers.setSelectedSite(siteId);
  const [x, z] = entry.data.position;
  const depthMeters = heightmap.getMetersAt(x, z);
  if (overlay) overlay.showSiteCard(entry, depthMeters);
  if (shouldFly) {
    const view = markers.getSiteCameraView(siteId);
    if (view) flyTo(view);
  }
}

overlay = initOverlay({
  onToggleReefs: (visible) => markers.setReefsVisible(visible),
  onToggleWrecks: (visible) => markers.setWrecksVisible(visible),
  onTogglePlaces: (visible) => markers.setPlacesVisible(visible),
  onToggleLabels: (visible) => markers.setLabelsVisible(visible),
  onToggleSatellite: (visible) => terrain.setSatelliteVisible(visible),
  onToggleContours: (visible) => terrain.setContoursVisible(visible),
  onToggleWater: (visible) => water.setEnabled(visible),
  onSeaLevelChange: (meters) => water.setTargetMeters(meters),
  onReliefScaleChange: (scale) => {
    terrain.setVerticalScale(scale);
    markers.setVerticalScale(scale);
    water.setVerticalScale(scale);
  },
  onSunAzimuthChange: (deg) => setSunAzimuth(deg),
  onLightingPresetChange: (presetId) => setLightingPreset(presetId),
  onSelectViewpoint: (vp) => {
    if (vp.siteId) {
      selectAndFocusSite(vp.siteId, true);
    } else {
      markers.setSelectedSite(null);
      if (overlay) overlay.showSiteCard(null);
      flyTo({ position: vp.position, target: vp.target, duration: 1.4 });
    }
  },
  onCloseSiteCard: () => markers.setSelectedSite(null),
  onFlyToSite: (siteId) => {
    const view = markers.getSiteCameraView(siteId);
    if (view) flyTo(view);
  },
});

// Raycasting for clicking wrecks/reefs + live WGS84 & depth readout
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let pointerDownPos = { x: 0, y: 0 };
let lastHoverCheck = 0;

function updatePointerNDC(ev) {
  const rect = canvas.getBoundingClientRect();
  pointerNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
}

function findSiteIdFromHit(hit) {
  let obj = hit.object;
  while (obj) {
    if (obj.userData && obj.userData.siteId) return obj.userData.siteId;
    obj = obj.parent;
  }
  return null;
}

canvas.addEventListener('pointerdown', (ev) => {
  pointerDownPos = { x: ev.clientX, y: ev.clientY };
});

canvas.addEventListener('pointerup', (ev) => {
  if (isSpacePanning()) return;
  const dx = ev.clientX - pointerDownPos.x;
  const dy = ev.clientY - pointerDownPos.y;
  if (dx * dx + dy * dy > 36) return;

  updatePointerNDC(ev);
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(markers.getInteractiveObjects(), false);
  const visibleHit = hits.find((h) => h.object.visible && (!h.object.parent || h.object.parent.visible));
  if (visibleHit) {
    const siteId = findSiteIdFromHit(visibleHit);
    if (siteId) {
      selectAndFocusSite(siteId, true);
      return;
    }
  }
});

canvas.addEventListener('pointermove', (ev) => {
  const now = performance.now();
  if (now - lastHoverCheck < 45) return;
  lastHoverCheck = now;

  updatePointerNDC(ev);
  raycaster.setFromCamera(pointerNDC, camera);

  const siteHits = raycaster.intersectObjects(markers.getInteractiveObjects(), false);
  const visibleSiteHit = siteHits.find((h) => h.object.visible && (!h.object.parent || h.object.parent.visible));
  const hoveredId = visibleSiteHit ? findSiteIdFromHit(visibleSiteHit) : null;
  markers.setHoveredSite(hoveredId);
  canvas.style.cursor = !isSpacePanning() && hoveredId ? 'pointer' : '';

  const terrainHits = raycaster.intersectObject(terrain.mesh, false);
  if (terrainHits.length > 0 && overlay) {
    const p = terrainHits[0].point;
    const [lat, lon] = worldToGeo(p.x, p.z);
    const meters = heightmap.getMetersAt(p.x, p.z);
    overlay.updateTelemetry(lat, lon, meters);
  }
});

start();

window.__viz = {
  camera,
  controls,
  terrain,
  markers,
  heightmap,
  water,
  setLightingPreset,
  setSunAzimuth,
  flyTo,
  selectAndFocusSite,
};
