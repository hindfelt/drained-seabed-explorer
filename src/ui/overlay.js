import { REEFS, WRECKS, PLACES } from '../data/sites.js';
import { worldToGeo } from '../data/geo.js';
import { LIGHTING_PRESETS } from '../scene/setup.js';

const FALLBACK_ATTRIBUTION = 'Sentinel-2 © EOX';

export const VIEWPOINTS = [
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

function creditsText(attribution) {
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

/**
 * Editorial cartographic HUD matching the archival museum-print aesthetic:
 * - Top-left live WGS84 coordinate readout (`55° 58′ N` / `12° 41′ E`) + depth
 * - Right-margin elevation/bathymetry graduation ticks
 * - Bottom-left dark-slate `ÖRESUND` nameplate badge
 * - Top-right sleek collapsible Controls drawer (starts compact so the 3D sculpture owns the viewport)
 * - Bottom-center Viewpoints pill bar for instant close-ups of real Öresund wrecks
 * - Bottom-right animated Site Dossier Card on click
 */
export function initOverlay({
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

  // --- 1. Archival editorial coordinates (top-left, mirrors reference image) ---
  const coordBlock = document.createElement('div');
  coordBlock.className = 'archival-coords';
  coordBlock.innerHTML = `
    <div class="archival-coords__line" id="tel-lat">55&deg; 58&prime; N</div>
    <div class="archival-coords__line" id="tel-lon">12&deg; 41&prime; E</div>
    <div class="archival-coords__depth" id="tel-depth">DRAINED SEABED &middot; 31 &times; 31 KM</div>
  `;

  // --- 2. Right-edge cartographic scale ticks (mirrors reference image) ---
  const ruler = document.createElement('div');
  ruler.className = 'archival-ruler';
  ruler.setAttribute('aria-hidden', 'true');
  const tickCount = 24;
  ruler.innerHTML = Array.from({ length: tickCount }, (_, i) => {
    const major = i % 4 === 0 ? ' archival-ruler__tick--major' : '';
    return `<span class="archival-ruler__tick${major}"></span>`;
  }).join('');

  // --- 3. Bottom-left editorial ÖRESUND badge (mirrors reference image) ---
  const titleBadge = document.createElement('div');
  titleBadge.className = 'archival-badge';
  titleBadge.innerHTML = `<span class="archival-badge__name">&Ouml;RESUND</span>`;

  // --- 4. Top-right collapsible expedition Controls drawer ---
  const drawerWrap = document.createElement('section');
  drawerWrap.className = 'controls-wrap';
  drawerWrap.setAttribute('aria-label', 'Drained Seabed Explorer controls');

  drawerWrap.innerHTML = `
    <button type="button" class="controls-trigger" id="controls-trigger" aria-expanded="false" aria-controls="controls-panel">
      <span class="controls-trigger__dot" aria-hidden="true"></span>
      <span>Controls</span>
      <span class="controls-trigger__chev" aria-hidden="true">&#9662;</span>
    </button>

    <div class="panel" id="controls-panel" hidden>
      <div class="panel__texture" aria-hidden="true"></div>
      <header class="panel__header">
        <p class="panel__eyebrow">Bathymetric Diorama &middot; 56&deg;N</p>
        <h1 class="panel__title">Drained Seabed Explorer</h1>
      </header>

      <div class="panel__divider" aria-hidden="true"></div>

      <div class="panel__toggles" role="group" aria-label="Map layers">
        ${toggleRowMarkup({ id: 'wrecks', label: 'Shipwrecks', subLabel: `${siteCountLabel(WRECKS.length)} · Real models`, accent: '--accent-wreck' })}
        ${toggleRowMarkup({ id: 'reefs', label: 'Boulder shoals', subLabel: siteCountLabel(REEFS.length), accent: '--accent-reef' })}
        ${toggleRowMarkup({ id: 'places', label: 'Coastal places', subLabel: siteCountLabel(PLACES.length), accent: '--accent-place' })}
        ${toggleRowMarkup({ id: 'labels', label: 'Site labels', subLabel: 'Cartographic tags', accent: '--brass' })}
        ${toggleRowMarkup({ id: 'satellite', label: 'Satellite land', subLabel: 'Sentinel-2 overlay', accent: '--accent-reef', checked: false })}
        ${toggleRowMarkup({ id: 'contours', label: 'Depth contours', subLabel: '5 m / 15 m lines', accent: '--brass', checked: false })}
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
            <output class="slider-row__val" id="val-relief" for="slider-relief">1.00&times;</output>
          </div>
          <input type="range" id="slider-relief" class="range-input" min="0.5" max="2.2" step="0.05" value="1" />
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
      <p class="panel__credits">${creditsText(FALLBACK_ATTRIBUTION)}</p>
    </div>
  `;

  // --- 5. Viewpoint quick-jump pill bar (bottom-center) ---
  const navBar = document.createElement('nav');
  navBar.className = 'viewpoints';
  navBar.setAttribute('aria-label', 'Camera viewpoints');
  navBar.innerHTML = VIEWPOINTS.map(
    (vp, idx) =>
      `<button type="button" class="viewpoints__btn${idx === 0 ? ' is-active' : ''}" data-viewpoint="${vp.id}">${vp.label}</button>`
  ).join('');

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

  // --- Wire drawer toggle ---
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
  const formatSeaLevel = (m) => (m <= -51.5 ? 'Drained' : `${m.toFixed(1)} m`);
  syncSliderVars(seaLevelSlider, formatSeaLevel);
  seaLevelSlider.addEventListener('input', () => {
    const val = Number(seaLevelSlider.value);
    syncSliderVars(seaLevelSlider, formatSeaLevel);
    seaLevelOut.textContent = formatSeaLevel(val);
    waterInput.checked = val > -51;
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

  // --- Wire viewpoints ---
  const vpBtns = Array.from(navBar.querySelectorAll('.viewpoints__btn'));
  for (const btn of vpBtns) {
    btn.addEventListener('click', () => {
      const vp = VIEWPOINTS.find((v) => v.id === btn.dataset.viewpoint);
      if (!vp) return;
      for (const b of vpBtns) b.classList.toggle('is-active', b === btn);
      onSelectViewpoint(vp);
    });
  }

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
  loadAttribution().then((attribution) => {
    if (creditsEl) creditsEl.textContent = creditsText(attribution);
  });

  const telLat = coordBlock.querySelector('#tel-lat');
  const telLon = coordBlock.querySelector('#tel-lon');
  const telDepth = coordBlock.querySelector('#tel-depth');

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

  function showSiteCard(entry, depthMeters) {
    if (!entry) {
      currentSiteId = null;
      hideAnimated(card);
      return;
    }
    currentSiteId = entry.id;
    const { kind, data } = entry;
    const [lat, lon] = worldToGeo(data.position[0], data.position[1]);

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
      if (data.length) metaItems.push(['Length', `~${data.length} m`]);
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
      data.description || `Coastal landmark overlooking the drained northern Öresund strait.`;

    showAnimated(card);
  }

  return {
    updateTelemetry,
    syncSeaLevelDisplay,
    showSiteCard,
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
