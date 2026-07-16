/**
 * Builds the expedition instrument panel inside #overlay-root.
 * The three marker toggles start checked (visible); Water starts unchecked
 * (the app opens fully drained). Fires the callbacks on change.
 * @param meta the region pack's meta.json (name, attributions, warnings?)
 * @param counts `{ reefs, wrecks, places }` — loaded site counts
 */
export function initOverlay({ meta, counts, onToggleReefs, onToggleWrecks, onTogglePlaces, onToggleWater }) {
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
      <p class="panel__subtitle">${escapeHtml(meta.name)}, drained.</p>
    </header>

    <div class="panel__region">
      <label class="panel__region-label" for="region-select">Region</label>
      <select id="region-select" class="region-select" aria-label="Switch region"></select>
      <a class="region-new" href="generate.html">+ new region</a>
    </div>

    <div class="panel__divider" aria-hidden="true"></div>

    <div class="panel__toggles" role="group" aria-label="Marker layers">
      ${toggleRowMarkup({ id: 'reefs', label: 'Shoals &amp; reefs', subLabel: siteCountLabel(counts.reefs), accent: '--accent-reef' })}
      ${toggleRowMarkup({ id: 'wrecks', label: 'Shipwrecks', subLabel: siteCountLabel(counts.wrecks), accent: '--accent-wreck' })}
      ${toggleRowMarkup({ id: 'places', label: 'Place names', subLabel: siteCountLabel(counts.places), accent: '--accent-place' })}
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
    <p class="panel__credits"></p>
  `;

  root.appendChild(panel);

  // Credits are the honest part of the panel: every attribution of a source
  // actually used in this pack — with its license linked when the pack
  // carries one (CC BY-NC-SA requires the license URI to travel with the
  // imagery) — plus any generation warnings (e.g. coarse GEBCO-only
  // bathymetry) so data-quality caveats stay visible. Built with DOM APIs:
  // pack fields are data, never markup.
  const creditsEl = panel.querySelector('.panel__credits');
  const sources = Array.isArray(meta.sources) && meta.sources.length > 0
    ? meta.sources
    : (meta.attributions ?? []).map((attribution) => ({ attribution, license: null }));
  const parts = [];
  for (const source of sources) {
    const span = document.createElement('span');
    span.textContent = source.attribution ?? '';
    const licenseUrl = typeof source.license === 'string'
      ? source.license.match(/https?:\/\/\S+?(?=[,;\s]|$)/)?.[0]
      : null;
    if (licenseUrl) {
      span.append(' (');
      const link = document.createElement('a');
      link.href = licenseUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'license';
      link.title = source.license;
      span.append(link, ')');
    }
    parts.push(span);
  }
  for (const warning of meta.warnings ?? []) {
    const span = document.createElement('span');
    span.textContent = warning;
    parts.push(span);
  }
  if (parts.length === 0) {
    creditsEl.textContent = 'Open data';
  } else {
    parts.forEach((part, i) => {
      if (i > 0) creditsEl.append(' · ');
      creditsEl.append(part);
    });
  }

  const reefsInput = panel.querySelector('#toggle-reefs');
  const wrecksInput = panel.querySelector('#toggle-wrecks');
  const placesInput = panel.querySelector('#toggle-places');
  const waterInput = panel.querySelector('#toggle-water');

  const regionSelect = panel.querySelector('#region-select');
  const currentSlug = new URLSearchParams(location.search).get('region');
  fetch('packs/index.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((index) => {
      if (!index || !Array.isArray(index.packs)) return;
      const active = currentSlug ?? index.default;
      for (const slug of index.packs) {
        const option = document.createElement('option');
        option.value = slug;
        option.textContent = slug;
        option.selected = slug === active;
        regionSelect.appendChild(option);
      }
      regionSelect.addEventListener('change', () => {
        location.search = `?region=${encodeURIComponent(regionSelect.value)}`;
      });
    })
    .catch(() => {});

  reefsInput.addEventListener('change', () => onToggleReefs(reefsInput.checked));
  wrecksInput.addEventListener('change', () => onToggleWrecks(wrecksInput.checked));
  placesInput.addEventListener('change', () => onTogglePlaces(placesInput.checked));
  waterInput.addEventListener('change', () => onToggleWater(waterInput.checked));
}

function siteCountLabel(count) {
  return `${String(count).padStart(2, '0')} sites`;
}

// Pack fields (name, attributions) are data, not markup — escape them before
// they land in panel.innerHTML.
function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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
