import { loadRegionPack, resolveRegionSlug, convertSites } from './pack-loader.js';
import { createHeightmap } from './data/heightmap.js';
import { createScene } from './scene/setup.js';
import { createTerrain } from './scene/terrain.js';
import { createMarkers } from './scene/markers.js';
import { createWater } from './scene/water.js';
import { initOverlay } from './ui/overlay.js';

const canvas = document.getElementById('scene');

function showBootError(error) {
  const root = document.getElementById('overlay-root');
  if (root) {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.innerHTML = `
      <header class="panel__header">
        <h1 class="panel__title">Drained Seabed Explorer</h1>
        <p class="panel__subtitle">Could not load the region pack.</p>
      </header>
      <p class="panel__credits"></p>
    `;
    panel.querySelector('.panel__credits').textContent =
      `${error.message} — generate one with: npm run generate -- --bbox <lonMin,latMin,lonMax,latMax> --name <name> --slug <slug>`;
    root.appendChild(panel);
  }
  console.error('[boot] region pack failed to load:', error);
}

async function boot() {
  const slug = await resolveRegionSlug();
  const pack = await loadRegionPack(slug);
  document.title = `Drained Seabed Explorer — ${pack.meta.name}`;

  const heightmap = createHeightmap(pack.heightmapData, pack.meta.scale);
  const sites = convertSites(pack.sites, heightmap.geoToWorld, heightmap.metersToWorld);

  const { scene, camera, controls, onFrame, start } = createScene(canvas);

  scene.add(createTerrain(heightmap, {
    colorBands: pack.meta.colorBands,
    satelliteUrl: pack.satelliteUrl,
  }));

  const markers = createMarkers(heightmap, sites);
  scene.add(markers.group);

  const water = createWater(heightmap.size);
  scene.add(water.mesh);
  onFrame((dt, elapsed) => water.update(dt, elapsed));

  initOverlay({
    meta: pack.meta,
    counts: {
      reefs: sites.reefs.length,
      wrecks: sites.wrecks.length,
      places: sites.places.length,
    },
    onToggleReefs: (visible) => markers.setReefsVisible(visible),
    onToggleWrecks: (visible) => markers.setWrecksVisible(visible),
    onTogglePlaces: (visible) => markers.setPlacesVisible(visible),
    onToggleWater: (visible) => water.setEnabled(visible),
  });

  start();

  // Dev/debug handle for scripted camera moves and state inspection.
  window.__viz = { camera, controls, markers, heightmap, water, pack };
}

boot().catch(showBootError);
