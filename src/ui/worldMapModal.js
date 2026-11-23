import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { buildLiveRegion as buildLiveRegionDirect } from '../data/liveRegion.js';

export const WRECK_HOTSPOTS = [
  {
    id: 'oresund',
    label: 'Öresund (Bundled)',
    lat: 55.96,
    lon: 12.69,
    sizeKm: 31,
    isBundledDefault: true,
    note: 'Hand-curated + bespoke 3D wrecks',
  },
  {
    id: 'scapa-flow',
    label: 'Scapa Flow, Orkney',
    lat: 58.9,
    lon: -3.1,
    sizeKm: 28,
    note: 'WWI German High Seas Fleet',
  },
  {
    id: 'normandy',
    label: 'Normandy D-Day',
    lat: 49.36,
    lon: -0.62,
    sizeKm: 30,
    note: 'Arromanches, Mulberry harbors & SHOM heritage wrecks',
  },
  {
    id: 'solent',
    label: 'Solent · Portsmouth',
    lat: 50.76,
    lon: -1.16,
    sizeKm: 30,
    note: 'Historic England wrecks (HMS Invincible, HMS/m A1, Mary Rose)',
  },
  {
    id: 'dover',
    label: 'Dover · Goodwin Sands',
    lat: 51.22,
    lon: 1.52,
    sizeKm: 35,
    note: 'Great Storm of 1703 warships & Channel wrecks',
  },
  {
    id: 'skagerrak',
    label: 'Skagerrak · Skagen',
    lat: 57.76,
    lon: 10.58,
    sizeKm: 40,
    note: 'Dense North Sea–Kattegat shipwreck graveyard',
  },
  {
    id: 'gotland',
    label: 'Gotland · Visby',
    lat: 57.64,
    lon: 18.22,
    sizeKm: 35,
    note: 'Baltic limestone coast & wrecks',
  },
  {
    id: 'gallipoli',
    label: 'Gallipoli · Dardanelles',
    lat: 40.14,
    lon: 26.26,
    sizeKm: 35,
    note: 'WWI naval campaign wrecks',
  },
  {
    id: 'gibraltar',
    label: 'Strait of Gibraltar',
    lat: 35.97,
    lon: -5.52,
    sizeKm: 45,
    note: 'Deep Atlantic–Med sill canyon',
  },
  {
    id: 'geiranger',
    label: 'Geirangerfjord',
    lat: 62.13,
    lon: 7.08,
    sizeKm: 22,
    note: 'Steep glacial Norwegian fjord',
  },
  {
    id: 'truk',
    label: 'Truk Lagoon',
    lat: 7.38,
    lon: 151.85,
    sizeKm: 45,
    note: 'WWII Pacific fleet atoll (Fujikawa Maru, 40+ wrecks)',
  },
  {
    id: 'outer-banks',
    label: 'Outer Banks, USA',
    lat: 35.32,
    lon: -75.46,
    sizeKm: 60,
    note: 'Graveyard of the Atlantic (Wikidata & U-boat wrecks)',
  },
];

const SIZE_OPTIONS_KM = [15, 30, 60, 100];

function coversEurope(bbox) {
  return bbox.latMax > 25 && bbox.latMin < 73 && bbox.lonMax > -36 && bbox.lonMin < 43;
}

function computeSquareBbox(centerLat, centerLon, sizeKm) {
  const halfKm = sizeKm / 2;
  const dLat = halfKm / 111.32;
  const cosLat = Math.max(0.18, Math.cos((centerLat * Math.PI) / 180));
  const dLon = halfKm / (111.32 * cosLat);
  return {
    latMin: Math.max(-82, centerLat - dLat),
    latMax: Math.min(82, centerLat + dLat),
    lonMin: Math.max(-179.8, centerLon - dLon),
    lonMax: Math.min(179.8, centerLon + dLon),
  };
}

function formatDegMin(val, posHem, negHem) {
  const hem = val >= 0 ? posHem : negHem;
  const abs = Math.abs(val);
  const deg = Math.floor(abs);
  const min = Math.floor((abs - deg) * 60);
  return `${deg}° ${String(min).padStart(2, '0')}′ ${hem}`;
}

/**
 * Interactive World Map Picker (<dialog closedby="any">) powered by Leaflet,
 * OpenStreetMap/Carto tiles, OpenSeaMap nautical wreck overlay, GEBCO shaded
 * bathymetry overlay, Nominatim place search, and live 3D region rendering.
 */
export function createWorldMapModal({ onRenderRegion, onSelectBundledOresund }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'world-map-dialog';
  dialog.className = 'atlas-dialog';
  dialog.setAttribute('closedby', 'any');
  dialog.setAttribute('aria-labelledby', 'atlas-dialog-title');

  dialog.innerHTML = `
    <div class="atlas-dialog__shell">
      <header class="atlas-header">
        <div class="atlas-header__title-group">
          <p class="atlas-header__eyebrow">EMODnet &middot; UKHO 94k+ &middot; Heritage &middot; Wikidata</p>
          <h2 class="atlas-header__title" id="atlas-dialog-title">Select Any Coast to Drain &amp; Render</h2>
        </div>

        <form class="atlas-search" id="atlas-search-form" role="search">
          <input
            type="search"
            id="atlas-search-input"
            class="atlas-search__input"
            placeholder="Search any strait, island, port, or bay..."
            aria-label="Search coastal location"
            autocomplete="off"
          />
          <button type="submit" class="atlas-search__btn">Find</button>
          <ul class="atlas-search__results" id="atlas-search-results" hidden></ul>
        </form>

        <button type="button" class="atlas-close" id="atlas-close-btn" aria-label="Close world map">&times;</button>
      </header>

      <div class="atlas-hotspots" role="group" aria-label="Famous shipwreck hotspots">
        ${WRECK_HOTSPOTS.map(
          (h) =>
            `<button type="button" class="atlas-hotspot${h.isBundledDefault ? ' is-featured' : ''}" data-hotspot="${h.id}" title="${h.note}">${h.label}</button>`
        ).join('')}
      </div>

      <div class="atlas-map-stage">
        <div class="atlas-map" id="atlas-leaflet-map"></div>
        <div class="atlas-map-overlays">
          <label class="atlas-chip">
            <input type="checkbox" id="atlas-layer-seamark" checked />
            <span>OpenSeaMap wrecks &amp; buoys</span>
          </label>
          <label class="atlas-chip">
            <input type="checkbox" id="atlas-layer-bathy" />
            <span>GEBCO bathymetry shading</span>
          </label>
        </div>
        <div class="atlas-loading" id="atlas-loading" hidden>
          <div class="atlas-loading__card">
            <div class="atlas-loading__spinner" aria-hidden="true"></div>
            <div class="atlas-loading__text" id="atlas-loading-text">Fetching seabed elevation &amp; real wrecks...</div>
          </div>
        </div>
      </div>

      <footer class="atlas-footer">
        <div class="atlas-footer__info">
          <div class="atlas-footer__row">
            <input
              type="text"
              id="atlas-region-name"
              class="atlas-name-input"
              value="Scapa Flow"
              aria-label="Region label name"
              placeholder="Region name..."
            />
            <div class="atlas-sizes" role="group" aria-label="Capture window size">
              ${SIZE_OPTIONS_KM.map(
                (km) =>
                  `<button type="button" class="atlas-size-btn${km === 30 ? ' is-active' : ''}" data-size="${km}">${km} km</button>`
              ).join('')}
            </div>
          </div>
          <div class="atlas-footer__meta" id="atlas-bbox-meta">
            Pan &amp; zoom the map — the highlighted square will be carved into a 3D wreckmap.
          </div>
          <div class="atlas-footer__error" id="atlas-error" hidden role="alert"></div>
        </div>

        <div class="atlas-footer__actions">
          <button type="button" class="atlas-btn-secondary" id="atlas-reset-oresund">Öresund (Instant)</button>
          <button type="button" class="atlas-btn-primary" id="atlas-render-btn">Render 3D Wreckmap</button>
        </div>
      </footer>
    </div>
  `;

  document.body.appendChild(dialog);

  // Safari fallback for <dialog closedby="any"> light-dismiss (per modern-web-guidance)
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = outside(e);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e) && !isLoading) dialog.close();
    });
  }

  let map = null;
  let selectionRect = null;
  let seamarkLayer = null;
  let bathyLayer = null;
  let selectedSizeKm = 30;
  let isLoading = false;
  let currentBbox = computeSquareBbox(58.9, -3.1, 30);

  const mapEl = dialog.querySelector('#atlas-leaflet-map');
  const closeBtn = dialog.querySelector('#atlas-close-btn');
  const renderBtn = dialog.querySelector('#atlas-render-btn');
  const resetOresundBtn = dialog.querySelector('#atlas-reset-oresund');
  const nameInput = dialog.querySelector('#atlas-region-name');
  const metaEl = dialog.querySelector('#atlas-bbox-meta');
  const errEl = dialog.querySelector('#atlas-error');
  const loadingEl = dialog.querySelector('#atlas-loading');
  const loadingTextEl = dialog.querySelector('#atlas-loading-text');
  const searchForm = dialog.querySelector('#atlas-search-form');
  const searchInput = dialog.querySelector('#atlas-search-input');
  const searchResultsEl = dialog.querySelector('#atlas-search-results');
  const seamarkCheck = dialog.querySelector('#atlas-layer-seamark');
  const bathyCheck = dialog.querySelector('#atlas-layer-bathy');
  const sizeBtns = Array.from(dialog.querySelectorAll('.atlas-size-btn'));
  const hotspotBtns = Array.from(dialog.querySelectorAll('.atlas-hotspot'));

  function setError(msg) {
    if (!msg) {
      errEl.hidden = true;
      errEl.textContent = '';
    } else {
      errEl.hidden = false;
      errEl.textContent = msg;
    }
  }

  function setLoading(active, text = 'Fetching seabed elevation & real wrecks...') {
    isLoading = active;
    loadingEl.hidden = !active;
    loadingTextEl.textContent = text;
    renderBtn.disabled = active;
    resetOresundBtn.disabled = active;
  }

  function updateSelectionBox() {
    if (!map) return;
    const center = map.getCenter();
    currentBbox = computeSquareBbox(center.lat, center.lng, selectedSizeKm);
    const bounds = [
      [currentBbox.latMin, currentBbox.lonMin],
      [currentBbox.latMax, currentBbox.lonMax],
    ];
    if (!selectionRect) {
      selectionRect = L.rectangle(bounds, {
        color: '#d46b34',
        weight: 2.5,
        fillColor: '#35a898',
        fillOpacity: 0.14,
        dashArray: '6 5',
        interactive: false,
      }).addTo(map);
    } else {
      selectionRect.setBounds(bounds);
    }

    const cov = coversEurope(currentBbox)
      ? 'EMODnet 115 m + Heritage + UKHO + Wikidata'
      : 'GEBCO 450 m + UKHO + Wikidata';
    metaEl.textContent = `Center ${formatDegMin(center.lat, 'N', 'S')} · ${formatDegMin(center.lng, 'E', 'W')} · ${selectedSizeKm} × ${selectedSizeKm} km · ${cov}`;
  }

  function ensureMapInitialized() {
    if (map) {
      setTimeout(() => {
        map.invalidateSize();
        updateSelectionBox();
      }, 40);
      return;
    }

    map = L.map(mapEl, {
      center: [58.9, -3.1],
      zoom: 10,
      minZoom: 3,
      maxZoom: 15,
      zoomControl: true,
    });

    // Keyless Esri World Ocean Base + Reference (shows real bathymetry, shelves & strait names!)
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '&copy; Esri, GEBCO, NOAA, National Geographic',
        maxNativeZoom: 13,
        maxZoom: 16,
      }
    ).addTo(map);

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}',
      {
        maxNativeZoom: 13,
        maxZoom: 16,
        opacity: 0.9,
      }
    ).addTo(map);

    // Optional GEBCO shaded-relief bathymetry WMS overlay
    bathyLayer = L.tileLayer.wms('https://wms.gebco.net/mapserv?', {
      layers: 'GEBCO_LATEST',
      format: 'image/png',
      transparent: true,
      opacity: 0.5,
      attribution: '&copy; GEBCO',
    });

    // OpenSeaMap seamarks & wreck symbols overlay (on by default!)
    seamarkLayer = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenSeaMap',
      maxZoom: 18,
      opacity: 0.95,
    }).addTo(map);

    map.on('move zoom', updateSelectionBox);
    updateSelectionBox();
  }

  function setSizeKm(km) {
    selectedSizeKm = km;
    for (const b of sizeBtns) {
      b.classList.toggle('is-active', Number(b.dataset.size) === km);
    }
    updateSelectionBox();
  }

  function jumpTo(lat, lon, sizeKm, label) {
    ensureMapInitialized();
    setSizeKm(sizeKm || selectedSizeKm);
    const targetZoom = sizeKm <= 18 ? 11 : sizeKm <= 38 ? 10 : sizeKm <= 70 ? 9 : 8;
    map.setView([lat, lon], targetZoom, { animate: true });
    if (label) nameInput.value = label;
    setError('');
  }

  // Wire controls
  closeBtn.addEventListener('click', () => {
    if (!isLoading) dialog.close();
  });

  dialog.addEventListener('cancel', (e) => {
    if (isLoading) e.preventDefault();
  });

  seamarkCheck.addEventListener('change', () => {
    if (!map || !seamarkLayer) return;
    if (seamarkCheck.checked) seamarkLayer.addTo(map);
    else map.removeLayer(seamarkLayer);
  });

  bathyCheck.addEventListener('change', () => {
    if (!map || !bathyLayer) return;
    if (bathyCheck.checked) bathyLayer.addTo(map);
    else map.removeLayer(bathyLayer);
  });

  for (const btn of sizeBtns) {
    btn.addEventListener('click', () => setSizeKm(Number(btn.dataset.size)));
  }

  for (const btn of hotspotBtns) {
    btn.addEventListener('click', () => {
      const h = WRECK_HOTSPOTS.find((x) => x.id === btn.dataset.hotspot);
      if (!h) return;
      if (h.isBundledDefault) {
        jumpTo(h.lat, h.lon, 30, 'Öresund');
      } else {
        jumpTo(h.lat, h.lon, h.sizeKm, h.label.split(',')[0]);
      }
    });
  }

  resetOresundBtn.addEventListener('click', () => {
    setError('');
    if (onSelectBundledOresund) onSelectBundledOresund();
    dialog.close();
  });

  // Nominatim place search (uses local /api/geocode proxy, falls back directly to Nominatim CORS)
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) return;
    searchResultsEl.hidden = false;
    searchResultsEl.innerHTML = `<li class="atlas-search__status">Searching "${q}"...</li>`;
    try {
      let items = [];
      const proxyRes = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`).catch(() => null);
      if (proxyRes && proxyRes.ok && (proxyRes.headers.get('content-type') || '').includes('application/json')) {
        items = await proxyRes.json();
      } else {
        const directRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`
        );
        if (directRes.ok) {
          const rows = await directRes.json();
          items = (Array.isArray(rows) ? rows : []).map((r) => ({
            name: r.display_name,
            shortName: r.name || r.display_name.split(',')[0],
            lat: Number(r.lat),
            lon: Number(r.lon),
          }));
        }
      }
      if (!items.length) {
        searchResultsEl.innerHTML = `<li class="atlas-search__status">No coastal places found.</li>`;
        return;
      }
      searchResultsEl.innerHTML = items
        .map(
          (item, i) =>
            `<li><button type="button" class="atlas-search__item" data-idx="${i}">${item.name}</button></li>`
        )
        .join('');
      for (const btn of searchResultsEl.querySelectorAll('.atlas-search__item')) {
        btn.addEventListener('click', () => {
          const picked = items[Number(btn.dataset.idx)];
          searchResultsEl.hidden = true;
          jumpTo(picked.lat, picked.lon, selectedSizeKm, picked.shortName);
        });
      }
    } catch {
      searchResultsEl.innerHTML = `<li class="atlas-search__status">Search unavailable offline.</li>`;
    }
  });

  searchInput.addEventListener('input', () => {
    if (!searchInput.value.trim()) searchResultsEl.hidden = true;
  });

  // Render live 3D wreckmap: tries Vite /api/region proxy first, and seamlessly
  // falls back to direct browser CORS fetch (EMODnet + UKHO + EOX) if running
  // statically or on a dev server that wasn't restarted after adding vite.config.js.
  renderBtn.addEventListener('click', async () => {
    if (isLoading) return;
    setError('');
    const regionName = nameInput.value.trim() || 'Selected Strait';
    setLoading(true, `Fetching bathymetry, UKHO wrecks & places for ${regionName}...`);
    try {
      const params = new URLSearchParams({
        latMin: currentBbox.latMin.toFixed(5),
        latMax: currentBbox.latMax.toFixed(5),
        lonMin: currentBbox.lonMin.toFixed(5),
        lonMax: currentBbox.lonMax.toFixed(5),
        name: regionName,
      });

      let payload = null;
      const proxyRes = await fetch(`/api/region?${params.toString()}`).catch(() => null);
      const proxyContentType = proxyRes?.headers?.get('content-type') || '';

      if (proxyRes && proxyContentType.includes('application/json')) {
        const json = await proxyRes.json();
        if (!proxyRes.ok) {
          throw new Error(json?.error || `Server error (${proxyRes.status})`);
        }
        payload = json;
      } else {
        // Fallback: direct browser fetch via CORS-enabled EMODnet + UKHO endpoints
        setLoading(true, `Fetching directly from EMODnet & UKHO for ${regionName}...`);
        payload = await buildLiveRegionDirect({
          ...currentBbox,
          name: regionName,
          browserMode: true,
        });
      }

      setLoading(true, `Sculpting 3D diorama (${payload.wrecks.length} wrecks)...`);
      await onRenderRegion(payload);
      setLoading(false);
      dialog.close();
    } catch (err) {
      setLoading(false);
      setError(`Could not build 3D wreckmap: ${err?.message || 'Network error'}`);
    }
  });

  function open(initialCenter) {
    setError('');
    searchResultsEl.hidden = true;
    dialog.showModal();
    ensureMapInitialized();
    if (initialCenter) {
      map.setView([initialCenter.lat, initialCenter.lon], initialCenter.zoom || 9, { animate: false });
      updateSelectionBox();
    }
  }

  return { open, dialog };
}
