import { REEFS, WRECKS, PLACES } from '../data/sites.js';

const FALLBACK_ATTRIBUTION = 'Sentinel-2 © EOX';

function creditsText(attribution) {
  return `Bathymetry © EMODnet / GEBCO · Imagery: ${attribution} · Wrecks: oresundsdykning.se / vragguiden.dk / vrag.dk`;
}

// Dynamic import so a missing satellite-meta.json 404s gracefully at
// request time instead of failing the whole module graph like a static
// import of a possibly-absent file would.
function loadAttribution() {
  return import('../assets/satellite-meta.json')
    .then((mod) => {
      const meta = mod && mod.default ? mod.default : mod;
      return (meta && meta.attribution) || FALLBACK_ATTRIBUTION;
    })
    .catch(() => FALLBACK_ATTRIBUTION);
}

/**
 * Builds the expedition instrument panel inside #overlay-root.
 * The three marker toggles start checked (visible); Water starts unchecked
 * (the app opens fully drained). Fires the callbacks on change.
 */
export function initOverlay({ onToggleReefs, onToggleWrecks, onTogglePlaces, onToggleWater }) {
  const root = document.getElementById('overlay-root');
  if (!root) return;

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'Drained Seabed Explorer controls');

  panel.innerHTML = `
    <div class="panel__texture" aria-hidden="true"></div>
    <header class="panel__header">
      <p class="panel__eyebrow">Bathymetric Survey &middot; Site Index</p>
      <h1 class="panel__title">Drained Seabed Explorer</h1>
      <p class="panel__subtitle">&Ouml;resund, drained.</p>
    </header>

    <div class="panel__divider" aria-hidden="true"></div>

    <div class="panel__toggles" role="group" aria-label="Marker layers">
      ${toggleRowMarkup({ id: 'reefs', label: 'Coral reefs', subLabel: siteCountLabel(REEFS.length), accent: '--accent-reef' })}
      ${toggleRowMarkup({ id: 'wrecks', label: 'Shipwrecks', subLabel: siteCountLabel(WRECKS.length), accent: '--accent-wreck' })}
      ${toggleRowMarkup({ id: 'places', label: 'Place names', subLabel: siteCountLabel(PLACES.length), accent: '--accent-place' })}
    </div>

    <div class="panel__divider" aria-hidden="true"></div>

    <div class="panel__toggles" role="group" aria-label="Environment">
      ${toggleRowMarkup({
        id: 'water',
        label: 'Water',
        subLabel: 'Former sea level',
        accent: '--accent-water',
        checked: false,
        rowClass: 'toggle-row--water',
      })}
    </div>

    <div class="panel__divider" aria-hidden="true"></div>

    <footer class="panel__footer">
      <span>Drag to orbit</span>
      <span class="panel__footer-dot" aria-hidden="true">&middot;</span>
      <span>Scroll to zoom</span>
      <span class="panel__footer-dot" aria-hidden="true">&middot;</span>
      <span>Right-drag to pan</span>
    </footer>
    <p class="panel__credits">${creditsText(FALLBACK_ATTRIBUTION)}</p>
  `;

  root.appendChild(panel);

  const reefsInput = panel.querySelector('#toggle-reefs');
  const wrecksInput = panel.querySelector('#toggle-wrecks');
  const placesInput = panel.querySelector('#toggle-places');
  const waterInput = panel.querySelector('#toggle-water');

  reefsInput.addEventListener('change', () => onToggleReefs(reefsInput.checked));
  wrecksInput.addEventListener('change', () => onToggleWrecks(wrecksInput.checked));
  placesInput.addEventListener('change', () => onTogglePlaces(placesInput.checked));
  waterInput.addEventListener('change', () => onToggleWater(waterInput.checked));

  const creditsEl = panel.querySelector('.panel__credits');
  loadAttribution().then((attribution) => {
    if (creditsEl) creditsEl.textContent = creditsText(attribution);
  });
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
