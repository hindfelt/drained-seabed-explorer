// Region picker page: slippy map + bbox form + streaming generation log.

import { createSlippyMap } from './slippy-map.js';

const map = createSlippyMap(document.getElementById('map'), { center: [30, 0], zoom: 3 });

// Dev/debug handle, mirroring window.__viz in the explorer.
window.__picker = { map };

const drawToggle = document.getElementById('draw-toggle');
const clearButton = document.getElementById('clear-bbox');
const readout = document.getElementById('bbox-readout');
const coordsEl = document.getElementById('bbox-coords');
const spanEl = document.getElementById('bbox-span');
const warningsEl = document.getElementById('bbox-warnings');
const form = document.getElementById('generate-form');
const nameInput = document.getElementById('region-name');
const slugInput = document.getElementById('region-slug');
const generateButton = document.getElementById('generate-button');
const log = document.getElementById('progress-log');
const resultLine = document.getElementById('result-line');

let currentBBox = null;
let drawMode = false;
let slugTouched = false;

drawToggle.addEventListener('click', () => {
  drawMode = !drawMode;
  map.setDrawMode(drawMode);
  drawToggle.textContent = drawMode ? 'Drawing… (drag on the map)' : 'Draw area';
  drawToggle.classList.toggle('picker__button--active', drawMode);
});

clearButton.addEventListener('click', () => map.clearBBox());

map.onBBoxChange((bbox) => {
  currentBBox = bbox;
  clearButton.disabled = !bbox;
  readout.hidden = !bbox;
  form.hidden = !bbox;
  warningsEl.replaceChildren();
  if (!bbox) return;

  const format = (v) => v.toFixed(4);
  coordsEl.textContent =
    `${format(bbox.lonMin)}, ${format(bbox.latMin)} → ${format(bbox.lonMax)}, ${format(bbox.latMax)}`;

  const latSpan = bbox.latMax - bbox.latMin;
  const lonSpan = bbox.lonMax - bbox.lonMin;
  const midLat = ((bbox.latMin + bbox.latMax) / 2) * (Math.PI / 180);
  const kmNS = latSpan * 111.32;
  const kmEW = lonSpan * 111.32 * Math.cos(midLat);
  spanEl.textContent = `${kmEW.toFixed(1)} × ${kmNS.toFixed(1)} km`;

  const warnings = [];
  const aspect = kmEW / kmNS;
  if (aspect < 0.6 || aspect > 1.6) {
    warnings.push('box is far from square — the scene is a fixed 1200×1200 world and will stretch it');
  }
  if (latSpan < 0.15 || latSpan > 1.0) {
    warnings.push('span is outside the sweet spot (≈0.15°–1.0°) — too small is featureless, too large is coarse');
  }
  for (const warning of warnings) {
    const li = document.createElement('li');
    li.textContent = warning;
    warningsEl.appendChild(li);
  }
});

function deriveSlug(name) {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

nameInput.addEventListener('input', () => {
  if (!slugTouched) slugInput.value = deriveSlug(nameInput.value);
});
slugInput.addEventListener('input', () => { slugTouched = slugInput.value.length > 0; });

function appendLog(text, cssClass) {
  const line = document.createElement('span');
  if (cssClass) line.className = cssClass;
  line.textContent = `${text}\n`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentBBox) return;

  generateButton.disabled = true;
  resultLine.hidden = true;
  log.hidden = false;
  log.replaceChildren();
  appendLog(`generating "${nameInput.value.trim()}" (${slugInput.value})…`);

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox: currentBBox, name: nameInput.value, slug: slugInput.value }),
    });

    if (response.status === 404) {
      appendLog('generation needs the dev server — run: npm run dev', 'picker__log-error');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let finished = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const rawLine of lines) {
        if (!rawLine.trim()) continue;
        let parsed;
        try {
          parsed = JSON.parse(rawLine);
        } catch {
          continue;
        }
        if (parsed.stage) appendLog(`  ${parsed.stage} ✓`);
        if (parsed.error) {
          appendLog(parsed.error, 'picker__log-error');
          finished = true;
        }
        if (parsed.done) {
          finished = true;
          const { report } = parsed;
          appendLog(`  wrecks ${report.wreckCount} · places ${report.placeCount} · shoals ${report.shoalCount}`);
          for (const warning of report.warnings ?? []) appendLog(`  ⚠ ${warning}`);
          resultLine.hidden = false;
          resultLine.replaceChildren();
          const link = document.createElement('a');
          link.href = `/?region=${encodeURIComponent(slugInput.value)}`;
          link.textContent = `Open ${nameInput.value.trim()}, drained →`;
          resultLine.appendChild(link);
        }
      }
    }
    if (!finished) appendLog('stream ended unexpectedly — check the dev server log', 'picker__log-error');
  } catch (error) {
    appendLog(`request failed: ${error.message}`, 'picker__log-error');
  } finally {
    generateButton.disabled = false;
  }
});
