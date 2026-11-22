import * as THREE from 'three';
import { generateHeightmap, generateHeightmapFromGrid } from './data/heightmap.js';
import { REEFS, WRECKS, PLACES } from './data/sites.js';
import { createScene } from './scene/setup.js';
import { createTerrain } from './scene/terrain.js';
import { createMarkers } from './scene/markers.js';
import { createWater } from './scene/water.js';
import { initOverlay, DEFAULT_VIEWPOINTS } from './ui/overlay.js';
import { createWorldMapModal } from './ui/worldMapModal.js';

const canvas = document.getElementById('scene');

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

// Active hot-swappable region state
let currentHeightmap = null;
let currentTerrain = null;
let currentMarkers = null;
let currentWater = null;
let currentBackdropMode = 'archival';
let overlay = null;

onBackdropModeChange((mode) => {
  currentBackdropMode = mode;
  document.body.dataset.backdrop = mode;
  if (currentTerrain) currentTerrain.setStudioShadowVisible(mode === 'archival');
});

onFrame((dt, elapsed) => {
  if (currentWater) currentWater.update(dt, elapsed);
  if (currentMarkers) currentMarkers.update(camera, elapsed);
});

function selectAndFocusSite(siteId, shouldFly = true) {
  if (!currentMarkers || !currentHeightmap) return;
  const entry = currentMarkers.getSiteById(siteId);
  if (!entry) return;
  currentMarkers.setSelectedSite(siteId);
  const [x, z] = entry.data.position;
  const depthMeters = currentHeightmap.getMetersAt(x, z);
  if (overlay) overlay.showSiteCard(entry, depthMeters, currentHeightmap.worldToGeo);
  if (shouldFly) {
    const view = currentMarkers.getSiteCameraView(siteId);
    if (view) flyTo(view);
  }
}

/**
 * Disposes the previous 3D region cleanly and mounts a new heightmap + terrain +
 * markers + water diorama in place (zero page reload).
 */
function mountRegion({
  name,
  heightmap,
  sitesData,
  satelliteUrl,
  viewpoints,
  credits,
  flyOverview = false,
}) {
  if (currentTerrain) {
    scene.remove(currentTerrain.group);
    currentTerrain.dispose();
  }
  if (currentMarkers) {
    scene.remove(currentMarkers.group);
    currentMarkers.dispose();
  }
  if (currentWater) {
    scene.remove(currentWater.mesh);
    currentWater.dispose();
  }

  currentHeightmap = heightmap;

  const ui = overlay ? overlay.getUiState() : {
    reefs: true,
    wrecks: true,
    places: true,
    labels: true,
    satellite: false,
    contours: false,
    reliefScale: 0.5,
  };

  currentTerrain = createTerrain(heightmap, { satelliteUrl });
  currentTerrain.setStudioShadowVisible(currentBackdropMode === 'archival');
  currentTerrain.setSatelliteVisible(ui.satellite);
  currentTerrain.setContoursVisible(ui.contours);
  currentTerrain.setVerticalScale(ui.reliefScale);
  scene.add(currentTerrain.group);

  currentMarkers = createMarkers(heightmap, sitesData);
  currentMarkers.setReefsVisible(ui.reefs);
  currentMarkers.setWrecksVisible(ui.wrecks);
  currentMarkers.setPlacesVisible(ui.places);
  currentMarkers.setLabelsVisible(ui.labels);
  currentMarkers.setVerticalScale(ui.reliefScale);
  scene.add(currentMarkers.group);

  currentWater = createWater(heightmap, { sunDirection, sunColor });
  currentWater.setVerticalScale(ui.reliefScale);
  currentWater.onLevelChange((meters, worldY) => {
    if (currentTerrain) currentTerrain.setWaterLevel(worldY);
    if (overlay) overlay.syncSeaLevelDisplay(meters);
  });
  scene.add(currentWater.mesh);

  if (overlay) {
    overlay.setRegionInfo({
      name,
      bbox: heightmap.bbox,
      widthKm: heightmap.widthKm,
      heightKm: heightmap.heightKm,
      wreckCount: sitesData.wrecks.length,
      reefCount: sitesData.reefs.length,
      placeCount: sitesData.places.length,
      minMeters: currentWater.minMeters,
      viewpoints,
      credits,
    });
  }

  if (flyOverview) {
    flyTo({ position: [820, 440, 860], target: [0, -45, 0], duration: 1.2 });
  }

  syncDebugHandle();
}

function loadBundledOresund(flyOverview = false) {
  const heightmap = generateHeightmap();
  mountRegion({
    name: 'Öresund',
    heightmap,
    sitesData: { reefs: REEFS, wrecks: WRECKS, places: PLACES },
    satelliteUrl: undefined, // default bundled Sentinel-2 asset
    viewpoints: DEFAULT_VIEWPOINTS,
    credits: null,
    flyOverview,
  });
}

function loadLiveRegionPayload(payload) {
  const heightmap = generateHeightmapFromGrid(payload.bathymetry, {
    seaExaggeration: payload.scale.seaExaggeration,
    landExaggeration: payload.scale.landExaggeration,
    landCeiling: payload.scale.landCeiling,
  });

  const projectSites = (arr) =>
    (arr || []).map((item) => ({
      ...item,
      position: heightmap.geoToWorld(item.latLon[0], item.latLon[1]),
    }));

  const wrecks = projectSites(payload.wrecks);
  const reefs = projectSites(payload.reefs);
  const places = projectSites(payload.places);

  // Build dynamic Viewpoints bar from the region's top wrecks & shoals
  const viewpoints = [
    { id: 'overview', label: 'Overview', position: [820, 440, 860], target: [0, -45, 0] },
  ];
  for (const w of wrecks.slice(0, 5)) {
    const shortLabel = w.name.length > 20 ? `${w.name.slice(0, 18)}…` : w.name;
    viewpoints.push({
      id: w.id,
      label: w.sunkYear ? `${shortLabel} (${w.sunkYear})` : shortLabel,
      siteId: w.id,
    });
  }
  if (viewpoints.length < 4) {
    for (const r of reefs.slice(0, 2)) {
      viewpoints.push({ id: r.id, label: r.name, siteId: r.id });
    }
  }

  const creditParts = [...(payload.meta.attributions || [])];
  if (payload.meta.warnings?.length) creditParts.push(payload.meta.warnings[0]);

  mountRegion({
    name: payload.meta.name || 'Custom Region',
    heightmap,
    sitesData: { reefs, wrecks, places },
    satelliteUrl: payload.satelliteUrl,
    viewpoints,
    credits: creditParts.join(' · '),
    flyOverview: true,
  });
}

const worldMapModal = createWorldMapModal({
  onRenderRegion: async (payload) => {
    loadLiveRegionPayload(payload);
  },
  onSelectBundledOresund: () => {
    loadBundledOresund(true);
  },
});

overlay = initOverlay({
  onOpenWorldMap: () => {
    const bbox = currentHeightmap?.bbox;
    if (bbox) {
      worldMapModal.open({
        lat: (bbox.latMin + bbox.latMax) / 2,
        lon: (bbox.lonMin + bbox.lonMax) / 2,
        zoom: 9,
      });
    } else {
      worldMapModal.open();
    }
  },
  onToggleReefs: (visible) => currentMarkers?.setReefsVisible(visible),
  onToggleWrecks: (visible) => currentMarkers?.setWrecksVisible(visible),
  onTogglePlaces: (visible) => currentMarkers?.setPlacesVisible(visible),
  onToggleLabels: (visible) => currentMarkers?.setLabelsVisible(visible),
  onToggleSatellite: (visible) => currentTerrain?.setSatelliteVisible(visible),
  onToggleContours: (visible) => currentTerrain?.setContoursVisible(visible),
  onToggleWater: (visible) => currentWater?.setEnabled(visible),
  onSeaLevelChange: (meters) => currentWater?.setTargetMeters(meters),
  onReliefScaleChange: (scale) => {
    currentTerrain?.setVerticalScale(scale);
    currentMarkers?.setVerticalScale(scale);
    currentWater?.setVerticalScale(scale);
  },
  onSunAzimuthChange: (deg) => setSunAzimuth(deg),
  onLightingPresetChange: (presetId) => setLightingPreset(presetId),
  onSelectViewpoint: (vp) => {
    if (vp.siteId) {
      selectAndFocusSite(vp.siteId, true);
    } else {
      currentMarkers?.setSelectedSite(null);
      if (overlay) overlay.showSiteCard(null);
      flyTo({ position: vp.position, target: vp.target, duration: 1.4 });
    }
  },
  onCloseSiteCard: () => currentMarkers?.setSelectedSite(null),
  onFlyToSite: (siteId) => {
    const view = currentMarkers?.getSiteCameraView(siteId);
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
  if (isSpacePanning() || !currentMarkers) return;
  const dx = ev.clientX - pointerDownPos.x;
  const dy = ev.clientY - pointerDownPos.y;
  if (dx * dx + dy * dy > 36) return;

  updatePointerNDC(ev);
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(currentMarkers.getInteractiveObjects(), false);
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
  if (!currentMarkers || !currentTerrain || !currentHeightmap) return;
  const now = performance.now();
  if (now - lastHoverCheck < 45) return;
  lastHoverCheck = now;

  updatePointerNDC(ev);
  raycaster.setFromCamera(pointerNDC, camera);

  const siteHits = raycaster.intersectObjects(currentMarkers.getInteractiveObjects(), false);
  const visibleSiteHit = siteHits.find((h) => h.object.visible && (!h.object.parent || h.object.parent.visible));
  const hoveredId = visibleSiteHit ? findSiteIdFromHit(visibleSiteHit) : null;
  currentMarkers.setHoveredSite(hoveredId);
  canvas.style.cursor = !isSpacePanning() && hoveredId ? 'pointer' : '';

  const terrainHits = raycaster.intersectObject(currentTerrain.mesh, false);
  if (terrainHits.length > 0 && overlay) {
    const p = terrainHits[0].point;
    const [lat, lon] = currentHeightmap.worldToGeo(p.x, p.z);
    const meters = currentHeightmap.getMetersAt(p.x, p.z);
    overlay.updateTelemetry(lat, lon, meters);
  }
});

function syncDebugHandle() {
  window.__viz = {
    camera,
    controls,
    terrain: currentTerrain,
    markers: currentMarkers,
    heightmap: currentHeightmap,
    water: currentWater,
    worldMapModal,
    setLightingPreset,
    setSunAzimuth,
    flyTo,
    selectAndFocusSite,
    loadLiveRegionPayload,
    loadBundledOresund,
  };
}

// Boot immediately with the offline Öresund dataset
loadBundledOresund(false);
start();
