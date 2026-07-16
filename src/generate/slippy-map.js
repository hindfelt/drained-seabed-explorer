// Zero-dependency slippy map with a bbox draw mode, for the region picker.
//
// OSM raster tiles (256 px, z/x/y) positioned as absolutely-placed <img>
// elements inside the container. World coordinates are Web Mercator
// normalized to 0..1 on both axes; screen mapping is
//   px = (world - viewOrigin) * scale,  scale = 256 * 2^zoom.
// Drag pans (or draws the selection rectangle in draw mode), wheel zooms
// ±1 around the cursor. No dependencies — package.json stays three + vite.

const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 16;
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const worldX = (lon) => (lon + 180) / 360;
const worldY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};
const worldToLon = (x) => x * 360 - 180;
const worldToLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createSlippyMap(container, { center = [30, 0], zoom = 3 } = {}) {
  const state = {
    centerX: worldX(center[1]),
    centerY: worldY(center[0]),
    zoom,
    drawMode: false,
    rect: null, // { x0, y0, x1, y1 } in world units, unordered
  };

  container.classList.add('slippy');

  const tileLayer = document.createElement('div');
  tileLayer.className = 'slippy__tiles';
  const selection = document.createElement('div');
  selection.className = 'slippy__selection';
  selection.hidden = true;
  const attribution = document.createElement('div');
  attribution.className = 'slippy__attribution';
  attribution.innerHTML =
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  container.append(tileLayer, selection, attribution);

  const tiles = new Map(); // "z/x/y" -> <img>
  let bboxChangeCallback = () => {};

  function scale() {
    return TILE_SIZE * 2 ** state.zoom;
  }

  function viewOrigin() {
    return {
      x: state.centerX - container.clientWidth / 2 / scale(),
      y: state.centerY - container.clientHeight / 2 / scale(),
    };
  }

  function screenToWorld(px, py) {
    const origin = viewOrigin();
    return { x: origin.x + px / scale(), y: origin.y + py / scale() };
  }

  function render() {
    const origin = viewOrigin();
    const s = scale();
    const n = 2 ** state.zoom;
    const txMin = Math.floor(origin.x * n);
    const txMax = Math.floor((origin.x + container.clientWidth / s) * n);
    const tyMin = Math.max(0, Math.floor(origin.y * n));
    const tyMax = Math.min(n - 1, Math.floor((origin.y + container.clientHeight / s) * n));

    const wanted = new Set();
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const wrappedX = ((tx % n) + n) % n; // wrap longitude
        const key = `${state.zoom}/${tx}/${ty}`;
        wanted.add(key);
        let img = tiles.get(key);
        if (!img) {
          img = document.createElement('img');
          img.className = 'slippy__tile';
          img.width = TILE_SIZE;
          img.height = TILE_SIZE;
          img.draggable = false;
          img.alt = '';
          img.src = TILE_URL(state.zoom, wrappedX, ty);
          tiles.set(key, img);
          tileLayer.appendChild(img);
        }
        img.style.transform =
          `translate(${(tx / n - origin.x) * s}px, ${(ty / n - origin.y) * s}px)`;
      }
    }
    for (const [key, img] of tiles) {
      if (!wanted.has(key)) {
        img.remove();
        tiles.delete(key);
      }
    }

    if (state.rect) {
      const x0 = Math.min(state.rect.x0, state.rect.x1);
      const y0 = Math.min(state.rect.y0, state.rect.y1);
      const x1 = Math.max(state.rect.x0, state.rect.x1);
      const y1 = Math.max(state.rect.y0, state.rect.y1);
      selection.hidden = false;
      selection.style.transform = `translate(${(x0 - origin.x) * s}px, ${(y0 - origin.y) * s}px)`;
      selection.style.width = `${(x1 - x0) * s}px`;
      selection.style.height = `${(y1 - y0) * s}px`;
    } else {
      selection.hidden = true;
    }
  }

  function getBBox() {
    if (!state.rect) return null;
    let x0 = Math.min(state.rect.x0, state.rect.x1);
    const y0 = Math.min(state.rect.y0, state.rect.y1);
    let x1 = Math.max(state.rect.x0, state.rect.x1);
    const y1 = Math.max(state.rect.y0, state.rect.y1);
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return null;
    // Canonicalize longitude onto one world copy (panning across repeated
    // copies leaves raw x outside 0..1). A selection that still crosses the
    // ±180° seam after shifting has no single-bbox representation — reject
    // it rather than serialize a >180° monster.
    const shift = Math.floor(x0);
    x0 -= shift;
    x1 -= shift;
    if (x1 > 1) return null;
    // Larger world y = further south, so latMin comes from y1 (bottom edge).
    return {
      lonMin: worldToLon(x0),
      latMin: worldToLat(y1),
      lonMax: worldToLon(x1),
      latMax: worldToLat(y0),
    };
  }

  // --- pointer interaction -------------------------------------------------
  let pointer = null; // { px, py, drawing }

  container.addEventListener('pointerdown', (event) => {
    try {
      container.setPointerCapture(event.pointerId);
    } catch {
      // synthetic events (tests) have no active pointer to capture
    }
    const rect = container.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    pointer = { px, py, drawing: state.drawMode };
    if (state.drawMode) {
      const world = screenToWorld(px, py);
      // Clamp BOTH endpoints into Web Mercator's 0..1 — blank space beyond
      // the poles must never serialize into a bbox.
      state.rect = { x0: world.x, y0: clamp(world.y, 0, 1), x1: world.x, y1: clamp(world.y, 0, 1) };
      render();
    }
  });

  container.addEventListener('pointermove', (event) => {
    if (!pointer) return;
    const rect = container.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    if (pointer.drawing) {
      const world = screenToWorld(px, py);
      state.rect.x1 = world.x;
      state.rect.y1 = clamp(world.y, 0, 1);
    } else {
      state.centerX -= (px - pointer.px) / scale();
      state.centerY = clamp(state.centerY - (py - pointer.py) / scale(), 0, 1);
      pointer.px = px;
      pointer.py = py;
    }
    render();
  });

  container.addEventListener('pointerup', () => {
    if (pointer?.drawing) bboxChangeCallback(getBBox());
    pointer = null;
  });

  container.addEventListener('wheel', (event) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    const newZoom = clamp(state.zoom + direction, MIN_ZOOM, MAX_ZOOM);
    if (newZoom === state.zoom) return;
    const rect = container.getBoundingClientRect();
    const cursor = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    // Keep the world point under the cursor fixed through the zoom change.
    const shrink = 1 - 2 ** (state.zoom - newZoom);
    state.centerX += (cursor.x - state.centerX) * shrink;
    state.centerY = clamp(state.centerY + (cursor.y - state.centerY) * shrink, 0, 1);
    state.zoom = newZoom;
    render();
  }, { passive: false });

  const resizeObserver = new ResizeObserver(render);
  resizeObserver.observe(container);
  render();

  return {
    getBBox,
    setDrawMode(on) {
      state.drawMode = Boolean(on);
      container.classList.toggle('slippy--draw', state.drawMode);
    },
    clearBBox() {
      state.rect = null;
      render();
      bboxChangeCallback(null);
    },
    zoomBy(direction) {
      state.zoom = clamp(state.zoom + direction, MIN_ZOOM, MAX_ZOOM);
      render();
    },
    onBBoxChange(callback) {
      bboxChangeCallback = callback;
    },
    destroy() {
      resizeObserver.disconnect();
      container.replaceChildren();
    },
  };
}
