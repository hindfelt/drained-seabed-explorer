import { REEFS, WRECKS, PLACES } from '../data/sites.js';
import { LIGHTING_PRESETS } from '../scene/setup.js';

const FALLBACK_ATTRIBUTION = 'Sentinel-2 © EOX';

export const DEFAULT_VIEWPOINTS = [
  { id: 'overview', label: 'Overview', position: [820, 440, 860], target: [0, -45, 0] },
  { id: 'ven', label: 'Ven Island', position: [145, 110, 310], target: [-60, -25, 130] },
  { id: 'robert', label: 'S/S Robert (1905)', siteId: 'wreck-s-s-robert' },
  { id: 'cimbria', label: 'Cimbria (1858)', siteId: 'wreck-cimbria' },
  { id: 'johannes', label: 'Johannes L (1979)', siteId: 'wreck-johannes-l' },
  { id: 'emil', label: 'Emil Retzlaff', siteId: 'wreck-s-s-emil-r-retzlaff' },
  { id: 'k7', label: 'K7 Patrol', siteId: 'wreck-k7-bevakningsfartyg' },
];

function formatDegMin(val, posHem, negHem) {
  const hem = val >= 0 ? posHem : negHem;
  const abs = Math.abs(val);
  const deg = Math.floor(abs);
  const min = Math.floor((abs - deg) * 60);
  return `${deg}° ${String(min).padStart(2, '0')}′ ${hem}`;
}

function defaultCreditsText(attribution) {
  return `Bathymetry © EMODnet / GEBCO · Imagery: ${attribution} · Wrecks: oresundsdykning.se / vragguiden.dk / vrag.dk`;
}

function loadAttribution() {
  return import('../assets/satellite-meta.json')
    .then((mod) => {
      const meta = mod && mod.default ? mod.default : mod;
      return (meta && meta.attribution) || FALLBACK_ATTRIBUTION;
    })
    .catch(() => FALLBACK_ATTRIBUTION);
}

let supportsDisplayTransition;
function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

async function hideAnimated(el) {
  if (el.hidden) return;
  if (canTransitionDisplay()) {
    el.hidden = true;
  } else {
    el.setAttribute('data-closing', '');
  }
  const animations = el.getAnimations();
  if (animations.length > 0) {
    await Promise.race([
      Promise.allSettled(animations.map((a) => a.finished)),
      new Promise((r) => setTimeout(r, 1200)),
    ]);
  }
  if (el.hasAttribute('data-closing')) {
    el.removeAttribute('data-closing');
    el.hidden = true;
  }
}

function showAnimated(el) {
  el.removeAttribute('data-closing');
  el.hidden = false;
}

function syncSliderVars(slider, formatText) {
  slider.style.setProperty('--attr-min', slider.min || 0);
  slider.style.setProperty('--attr-max', slider.max || 100);
  slider.style.setProperty('--control-value', slider.value);
  if (formatText) {
    slider.setAttribute('aria-valuetext', formatText(Number(slider.value)));
  }
}

export function initOverlay({
  onOpenWorldMap,
  onToggleReefs,
  onToggleWrecks,
  onTogglePlaces,
  onToggleLabels,
  onToggleSatellite,
  onToggleContours,
  onToggleWater,
  onSeaLevelChange,
  onReliefScaleChange,
  onSunAzimuthChange,
  onLightingPresetChange,
  onSelectViewpoint,
  onCloseSiteCard,
  onFlyToSite,
}) {
  const root = document.getElementById('overlay-root');
  if (!root) return null;

  // --- 1. Archival editorial coordinates (top-left) ---
  const coordBlock = document.createElement('div');
  coordBlock.className = 'archival-coords';
  coordBlock.innerHTML = `
    <div class="archival-coords__line" id="tel-lat">55&deg; 58&prime; N</div>
    <div class="archival-coords__line" id="tel-lon">12&deg; 41&prime; E</div>
    <div class="archival-coords__depth" id="tel-depth">DRAINED SEABED &middot; 31 &times; 31 KM</div>
  `;

  // --- 2. Right-edge cartographic scale ticks ---
  const ruler = document.createElement('div');
  ruler.className = 'archival-ruler';
  ruler.setAttribute('aria-hidden', 'true');
  const tickCount = 24;
  ruler.innerHTML = Array.from({ length: tickCount }, (_, i) => {
    const major = i % 4 === 0 ? ' archival-ruler__tick--major' : '';
    return `<span class="archival-ruler__tick${major}"></span>`;
  }).join('');

  // --- 3. Bottom-left editorial region badge ---
  const titleBadge = document.createElement('div');
  titleBadge.className = 'archival-badge';
  titleBadge.innerHTML = `<span class="archival-badge__name" id="archival-region-badge">&Ouml;RESUND</span>`;

  // --- 4. Top-right World Map button + collapsible Controls drawer ---
  const drawerWrap = document.createElement('section');
  drawerWrap.className = 'controls-wrap';
  drawerWrap.setAttribute('aria-label', 'Drained Seabed Explorer controls');

  drawerWrap.innerHTML = `
    <div class="controls-bar">
      <button type="button" class="worldmap-trigger" id="worldmap-trigger" title="Choose any coast on Earth to render in 3D">
        <span class="worldmap-trigger__icon" aria-hidden="true">&#9678;</span>
        <span>World Map</span>
      </button>
      <button type="button" class="controls-trigger" id="controls-trigger" aria-expanded="false" aria-controls="controls-panel">
        <span class="controls-trigger__dot" aria-hidden="true"></span>
        <span>Controls</span>
        <span class="controls-trigger__chev" aria-hidden="true">&#9662;</span>
      </button>
    </div>

    <div class="panel" id="controls-panel" hidden>
      <div class="panel__texture" aria-hidden="true"></div>
      <header class="panel__header">
        <p class="panel__eyebrow" id="panel-eyebrow">Bathymetric Diorama &middot; 56&deg;N</p>
        <h1 class="panel__title" id="panel-title">Drained Seabed Explorer</h1>
      </header>

      <div class="panel__divider" aria-hidden="true"></div>

      <div class="panel__toggles" role="group" aria-label="Map layers">
        ${toggleRowMarkup({ id: 'wrecks', label: 'Shipwrecks', subLabel: `${siteCountLabel(WRECKS.length)} · Real models`, accent: '--accent-wreck' })}
        ${toggleRowMarkup({ id: 'reefs', label: 'Boulder shoals', subLabel: siteCountLabel(REEFS.length), accent: '--accent-reef' })}
        ${toggleRowMarkup({ id: 'places', label: 'Coastal places', subLabel: siteCountLabel(PLACES.length), accent: '--accent-place' })}
        ${toggleRowMarkup({ id: 'labels', label: 'Site labels', subLabel: 'Cartographic tags', accent: '--brass' })}
        ${toggleRowMarkup({ id: 'satellite', label: 'Satellite land', subLabel: 'Sentinel-2 overlay', accent: '--accent-reef', checked: false })}
        ${toggleRowMarkup({ id: 'contours', label: 'Depth contours', subLabel: 'Bathymetric lines', accent: '--brass', checked: false })}
      </div>

      <div class="panel__divider" aria-hidden="true"></div>

      <div class="panel__toggles" role="group" aria-label="Water and sea level">
        ${toggleRowMarkup({
          id: 'water',
          label: 'Refill sound',
          subLabel: 'Animate to 0 m',
          accent: '--accent-water',
          checked: false,
          rowClass: 'toggle-row--water',
        })}
        <div class="slider-row">
          <div class="slider-row__head">
            <label class="slider-row__label" for="slider-sealevel">Sea level</label>
            <output class="slider-row__val" id="val-sealevel" for="slider-sealevel">Drained</output>
          </div>
          <input type="range" id="slider-sealevel" class="range-input range-input--water" min="-52" max="0" step="0.5" value="-52" />
        </div>
      </div>

      <div class="panel__divider" aria-hidden="true"></div>

      <div class="panel__section" role="group" aria-label="3D Relief and atmosphere">
        <div class="slider-row">
          <div class="slider-row__head">
            <label class="slider-row__label" for="slider-relief">3D Relief</label>
            <output class="slider-row__val" id="val-relief" for="slider-relief">0.50&times;</output>
          </div>
          <input type="range" id="slider-relief" class="range-input" min="0.25" max="2.2" step="0.05" value="0.5" />
        </div>

        <div class="slider-row">
          <div class="slider-row__head">
            <label class="slider-row__label" for="slider-sun">Sun azimuth</label>
            <output class="slider-row__val" id="val-sun" for="slider-sun">124&deg;</output>
          </div>
          <input type="range" id="slider-sun" class="range-input" min="0" max="360" step="1" value="124" />
        </div>

        <div class="preset-pills" role="group" aria-label="Atmosphere lighting presets">
          ${Object.values(LIGHTING_PRESETS)
            .map(
              (p, idx) =>
                `<button type="button" class="preset-pill${idx === 0 ? ' is-active' : ''}" data-preset="${p.id}" aria-pressed="${idx === 0 ? 'true' : 'false'}">${p.label}</button>`
            )
            .join('')}
        </div>
      </div>

      <div class="panel__divider" aria-hidden="true"></div>

      <footer class="panel__footer">
        <span>Drag orbit</span>
        <span class="panel__footer-dot" aria-hidden="true">&middot;</span>
        <span>Space+drag pan</span>
        <span class="panel__footer-dot" aria-hidden="true">&middot;</span>
        <span>Scroll zoom</span>
      </footer>
      <p class="panel__credits">${defaultCreditsText(FALLBACK_ATTRIBUTION)}</p>
    </div>
  `;

  // --- 5. Viewpoint quick-jump pill bar (bottom-center) ---
  const navBar = document.createElement('nav');
  navBar.className = 'viewpoints';
  navBar.setAttribute('aria-label', 'Camera viewpoints');

  // --- 6. Animated Site Dossier Card (bottom-right) ---
  const card = document.createElement('aside');
  card.className = 'site-card';
  card.hidden = true;
  card.setAttribute('aria-label', 'Selected site details');
  card.innerHTML = `
    <div class="site-card__header">
      <span class="site-card__badge" id="card-badge">Shipwreck</span>
      <button type="button" class="site-card__close" id="card-close" aria-label="Close site details">&times;</button>
    </div>
    <h2 class="site-card__title" id="card-title"></h2>
    <dl class="site-card__meta" id="card-meta"></dl>
    <p class="site-card__desc" id="card-desc"></p>
    <div class="site-card__actions">
      <button type="button" class="site-card__fly" id="card-fly">Focus camera</button>
    </div>
  `;

  root.append(coordBlock, ruler, titleBadge, drawerWrap, navBar, card);

  // --- Wire World Map button & drawer toggle ---
  const worldMapBtn = drawerWrap.querySelector('#worldmap-trigger');
  worldMapBtn.addEventListener('click', () => {
    if (onOpenWorldMap) onOpenWorldMap();
  });

  const triggerBtn = drawerWrap.querySelector('#controls-trigger');
  const panel = drawerWrap.querySelector('#controls-panel');
  let panelOpen = false;
  triggerBtn.addEventListener('click', () => {
    panelOpen = !panelOpen;
    triggerBtn.setAttribute('aria-expanded', String(panelOpen));
    triggerBtn.classList.toggle('is-open', panelOpen);
    if (panelOpen) showAnimated(panel);
    else hideAnimated(panel);
  });

  // --- Wire checkboxes ---
  const reefsInput = panel.querySelector('#toggle-reefs');
  const wrecksInput = panel.querySelector('#toggle-wrecks');
  const placesInput = panel.querySelector('#toggle-places');
  const labelsInput = panel.querySelector('#toggle-labels');
  const satelliteInput = panel.querySelector('#toggle-satellite');
  const contoursInput = panel.querySelector('#toggle-contours');
  const waterInput = panel.querySelector('#toggle-water');

  reefsInput.addEventListener('change', () => onToggleReefs(reefsInput.checked));
  wrecksInput.addEventListener('change', () => onToggleWrecks(wrecksInput.checked));
  placesInput.addEventListener('change', () => onTogglePlaces(placesInput.checked));
  labelsInput.addEventListener('change', () => onToggleLabels(labelsInput.checked));
  satelliteInput.addEventListener('change', () => onToggleSatellite(satelliteInput.checked));
  contoursInput.addEventListener('change', () => onToggleContours(contoursInput.checked));
  waterInput.addEventListener('change', () => onToggleWater(waterInput.checked));

  // --- Wire sliders ---
  const seaLevelSlider = panel.querySelector('#slider-sealevel');
  const seaLevelOut = panel.querySelector('#val-sealevel');
  let minSeaMeters = -52;
  const formatSeaLevel = (m) => (m <= minSeaMeters + 0.5 ? 'Drained' : `${m.toFixed(1)} m`);
  syncSliderVars(seaLevelSlider, formatSeaLevel);
  seaLevelSlider.addEventListener('input', () => {
    const val = Number(seaLevelSlider.value);
    syncSliderVars(seaLevelSlider, formatSeaLevel);
    seaLevelOut.textContent = formatSeaLevel(val);
    waterInput.checked = val > minSeaMeters + 1;
    onSeaLevelChange(val);
  });

  const reliefSlider = panel.querySelector('#slider-relief');
  const reliefOut = panel.querySelector('#val-relief');
  const formatRelief = (v) => `${v.toFixed(2)}×`;
  syncSliderVars(reliefSlider, formatRelief);
  reliefSlider.addEventListener('input', () => {
    const val = Number(reliefSlider.value);
    syncSliderVars(reliefSlider, formatRelief);
    reliefOut.textContent = formatRelief(val);
    onReliefScaleChange(val);
  });

  const sunSlider = panel.querySelector('#slider-sun');
  const sunOut = panel.querySelector('#val-sun');
  const formatSun = (deg) => `${Math.round(deg)}°`;
  syncSliderVars(sunSlider, formatSun);
  sunSlider.addEventListener('input', () => {
    const val = Number(sunSlider.value);
    syncSliderVars(sunSlider, formatSun);
    sunOut.textContent = formatSun(val);
    onSunAzimuthChange(val);
  });

  // --- Wire lighting presets ---
  const presetBtns = Array.from(panel.querySelectorAll('.preset-pill'));
  for (const btn of presetBtns) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.preset;
      for (const b of presetBtns) {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      }
      const preset = LIGHTING_PRESETS[id];
      if (preset) {
        sunSlider.value = String(preset.azimuth);
        syncSliderVars(sunSlider, formatSun);
        sunOut.textContent = formatSun(preset.azimuth);
      }
      onLightingPresetChange(id);
    });
  }

  // --- Dynamic viewpoints bar builder ---
  function renderViewpoints(viewpoints) {
    navBar.innerHTML = viewpoints
      .map(
        (vp, idx) =>
          `<button type="button" class="viewpoints__btn${idx === 0 ? ' is-active' : ''}" data-vp-idx="${idx}">${vp.label}</button>`
      )
      .join('');
    const btns = Array.from(navBar.querySelectorAll('.viewpoints__btn'));
    for (const btn of btns) {
      btn.addEventListener('click', () => {
        const vp = viewpoints[Number(btn.dataset.vpIdx)];
        if (!vp) return;
        for (const b of btns) b.classList.toggle('is-active', b === btn);
        onSelectViewpoint(vp);
      });
    }
  }
  renderViewpoints(DEFAULT_VIEWPOINTS);

  // --- Wire Site Dossier Card ---
  let currentSiteId = null;
  const cardBadge = card.querySelector('#card-badge');
  const cardTitle = card.querySelector('#card-title');
  const cardMeta = card.querySelector('#card-meta');
  const cardDesc = card.querySelector('#card-desc');
  const cardClose = card.querySelector('#card-close');
  const cardFly = card.querySelector('#card-fly');

  cardClose.addEventListener('click', () => {
    currentSiteId = null;
    hideAnimated(card);
    if (onCloseSiteCard) onCloseSiteCard();
  });

  cardFly.addEventListener('click', () => {
    if (currentSiteId && onFlyToSite) onFlyToSite(currentSiteId);
  });

  const creditsEl = panel.querySelector('.panel__credits');
  let bundledAttribution = FALLBACK_ATTRIBUTION;
  loadAttribution().then((attribution) => {
    bundledAttribution = attribution;
    if (creditsEl && !isCustomCredits) creditsEl.textContent = defaultCreditsText(attribution);
  });

  let isCustomCredits = false;
  const telLat = coordBlock.querySelector('#tel-lat');
  const telLon = coordBlock.querySelector('#tel-lon');
  const telDepth = coordBlock.querySelector('#tel-depth');
  const badgeEl = titleBadge.querySelector('#archival-region-badge');
  const eyebrowEl = panel.querySelector('#panel-eyebrow');

  const countWrecksEl = panel.querySelector('label[for="toggle-wrecks"] .toggle-row__count');
  const countReefsEl = panel.querySelector('label[for="toggle-reefs"] .toggle-row__count');
  const countPlacesEl = panel.querySelector('label[for="toggle-places"] .toggle-row__count');

  function updateTelemetry(lat, lon, meters) {
    if (lat == null) return;
    telLat.textContent = formatDegMin(lat, 'N', 'S');
    telLon.textContent = formatDegMin(lon, 'E', 'W');
    const sign = meters >= 0 ? '+' : '−';
    const absM = Math.abs(meters).toFixed(1);
    telDepth.textContent = meters < 0 ? `DEPTH ${sign}${absM} M` : `ELEVATION ${sign}${absM} M`;
  }

  function syncSeaLevelDisplay(meters) {
    if (document.activeElement !== seaLevelSlider) {
      seaLevelSlider.value = String(meters.toFixed(1));
      syncSliderVars(seaLevelSlider, formatSeaLevel);
      seaLevelOut.textContent = formatSeaLevel(meters);
    }
  }

  function setRegionInfo({
    name,
    bbox,
    widthKm,
    heightKm,
    wreckCount,
    reefCount,
    placeCount,
    minMeters,
    viewpoints,
    credits,
  }) {
    const centerLat = (bbox.latMin + bbox.latMax) / 2;
    const centerLon = (bbox.lonMin + bbox.lonMax) / 2;

    badgeEl.textContent = name.toUpperCase();
    telLat.textContent = formatDegMin(centerLat, 'N', 'S');
    telLon.textContent = formatDegMin(centerLon, 'E', 'W');
    telDepth.textContent = `DRAINED SEABED · ${widthKm} × ${heightKm} KM`;

    const latHem = centerLat >= 0 ? 'N' : 'S';
    eyebrowEl.textContent = `Bathymetric Diorama · ${Math.abs(Math.round(centerLat))}°${latHem}`;

    if (countWrecksEl) countWrecksEl.textContent = `${siteCountLabel(wreckCount)} · Real models`;
    if (countReefsEl) countReefsEl.textContent = siteCountLabel(reefCount);
    if (countPlacesEl) countPlacesEl.textContent = siteCountLabel(placeCount);

    minSeaMeters = minMeters;
    seaLevelSlider.min = String(minMeters);
    seaLevelSlider.step = Math.abs(minMeters) > 200 ? '5' : Math.abs(minMeters) > 80 ? '1' : '0.5';
    seaLevelSlider.value = String(minMeters);
    waterInput.checked = false;
    syncSliderVars(seaLevelSlider, formatSeaLevel);
    seaLevelOut.textContent = 'Drained';

    renderViewpoints(viewpoints || DEFAULT_VIEWPOINTS);

    if (credits) {
      isCustomCredits = true;
      creditsEl.textContent = credits;
    } else {
      isCustomCredits = false;
      creditsEl.textContent = defaultCreditsText(bundledAttribution);
    }

    // Close any open site card from previous region
    currentSiteId = null;
    hideAnimated(card);
  }

  function showSiteCard(entry, depthMeters, worldToGeoFn) {
    if (!entry) {
      currentSiteId = null;
      hideAnimated(card);
      return;
    }
    currentSiteId = entry.id;
    const { kind, data } = entry;
    const [lat, lon] = data.latLon || (worldToGeoFn ? worldToGeoFn(data.position[0], data.position[1]) : [0, 0]);

    card.dataset.kind = kind;
    cardBadge.textContent =
      kind === 'wreck'
        ? data.approximate
          ? 'Shipwreck · Approx. Position'
          : 'Charted Shipwreck'
        : kind === 'reef'
          ? 'Exposed Boulder Shoal'
          : `Coastal ${data.kind || 'Place'}`;

    cardTitle.textContent = data.name;

    const metaItems = [];
    if (kind === 'wreck') {
      if (data.type) metaItems.push(['Vessel', data.type]);
      if (data.sunkYear) metaItems.push(['Sunk', String(data.sunkYear)]);
      if (data.length) metaItems.push(['Length', `~${Math.round(data.length)} m`]);
    }
    if (typeof depthMeters === 'number') {
      metaItems.push([
        depthMeters < 0 ? 'Former depth' : 'Elevation',
        `${depthMeters < 0 ? '−' : '+'}${Math.abs(depthMeters).toFixed(1)} m`,
      ]);
    }
    metaItems.push(['WGS84', `${formatDegMin(lat, 'N', 'S')} · ${formatDegMin(lon, 'E', 'W')}`]);

    cardMeta.innerHTML = metaItems
      .map(([k, v]) => `<div class="site-card__meta-item"><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');

    cardDesc.textContent =
      data.description || `Coastal landmark overlooking the drained seabed diorama.`;

    showAnimated(card);
  }

  function getUiState() {
    return {
      reefs: reefsInput.checked,
      wrecks: wrecksInput.checked,
      places: placesInput.checked,
      labels: labelsInput.checked,
      satellite: satelliteInput.checked,
      contours: contoursInput.checked,
      reliefScale: Number(reliefSlider.value),
    };
  }

  return {
    updateTelemetry,
    syncSeaLevelDisplay,
    setRegionInfo,
    showSiteCard,
    getUiState,
  };
}

function siteCountLabel(count) {
  return `${String(count).padStart(2, '0')} sites`;
}

function toggleRowMarkup({ id, label, subLabel, accent, checked = true, rowClass = '' }) {
  return `
    <label class="toggle-row${rowClass ? ` ${rowClass}` : ''}" for="toggle-${id}">
      <span class="toggle-row__swatch" style="--swatch-color: var(${accent})" aria-hidden="true"></span>
      <span class="toggle-row__text">
        <span class="toggle-row__label">${label}</span>
        <span class="toggle-row__count">${subLabel}</span>
      </span>
      <span class="switch">
        <input type="checkbox" id="toggle-${id}" class="switch__input" ${checked ? 'checked' : ''} />
        <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
      </span>
    </label>
  `;
}
