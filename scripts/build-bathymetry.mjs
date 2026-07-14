// Reproducible build of src/data/bathymetry.json for the Drained Seabed Explorer.
//
// Fetches two open bathymetry/elevation grids for the northern-Öresund window
// and merges them: EMODnet Bathymetry DTM 2024 (~115 m, sea floor, land = NaN)
// for the sea, with GEBCO 2020 (~450 m, includes land) filling land and gaps.
//
//   node scripts/build-bathymetry.mjs [outPath]
//
// Default outPath = src/data/bathymetry.json. Needs network access.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const WINDOW = { latMin: 55.82, latMax: 56.1, lonMin: 12.44, lonMax: 12.94 };
const EMODNET =
  'https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024.csv?elevation';
const GEBCO =
  'https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020.csv?elevation';

const range = (v) =>
  `%5B(${WINDOW.latMin}):(${WINDOW.latMax})%5D%5B(${WINDOW.lonMin}):(${WINDOW.lonMax})%5D`;

async function fetchGrid(base, label) {
  const url = base + range();
  process.stdout.write(`fetching ${label} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n').slice(2); // drop 2 header rows
  const latSet = new Set();
  const lonSet = new Set();
  const cells = new Map();
  for (const line of lines) {
    const c = line.split(',');
    const lat = +c[0];
    const lon = +c[1];
    latSet.add(lat);
    lonSet.add(lon);
    cells.set(lat + ',' + lon, c[2] === 'NaN' || c[2] === '' ? NaN : +c[2]);
  }
  const lats = [...latSet].sort((a, b) => a - b);
  const lons = [...lonSet].sort((a, b) => a - b);
  const grid = new Float32Array(lats.length * lons.length);
  for (let i = 0; i < lats.length; i++)
    for (let j = 0; j < lons.length; j++) {
      const v = cells.get(lats[i] + ',' + lons[j]);
      grid[i * lons.length + j] = v === undefined ? NaN : v;
    }
  console.log(`${lats.length} × ${lons.length}`);
  return { lats, lons, nLat: lats.length, nLon: lons.length, grid };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function sample(G, lat, lon) {
  const fLat =
    ((clamp(lat, G.lats[0], G.lats[G.nLat - 1]) - G.lats[0]) /
      (G.lats[G.nLat - 1] - G.lats[0])) *
    (G.nLat - 1);
  const fLon =
    ((clamp(lon, G.lons[0], G.lons[G.nLon - 1]) - G.lons[0]) /
      (G.lons[G.nLon - 1] - G.lons[0])) *
    (G.nLon - 1);
  let i = Math.min(G.nLat - 2, Math.max(0, Math.floor(fLat)));
  let j = Math.min(G.nLon - 2, Math.max(0, Math.floor(fLon)));
  const ti = fLat - i;
  const tj = fLon - j;
  const a = G.grid[i * G.nLon + j];
  const b = G.grid[i * G.nLon + j + 1];
  const c = G.grid[(i + 1) * G.nLon + j];
  const d = G.grid[(i + 1) * G.nLon + j + 1];
  return (a + (b - a) * tj) + ((c + (d - c) * tj) - (a + (b - a) * tj)) * ti;
}

const emod = await fetchGrid(EMODNET, 'EMODnet DTM 2024');
const gebco = await fetchGrid(GEBCO, 'GEBCO 2020');

// Target: EMODnet lats (all), EMODnet lons subsampled ×2 (~isotropic 120 m).
const lats = emod.lats;
const lons = emod.lons.filter((_, j) => j % 2 === 0);
const nLat = lats.length;
const nLon = lons.length;
const elevations = new Array(nLat * nLon);
let filled = 0;
for (let i = 0; i < nLat; i++)
  for (let j = 0; j < nLon; j++) {
    const ej = emod.lons.indexOf(lons[j]);
    let e = emod.grid[i * emod.nLon + ej];
    if (!Number.isFinite(e)) {
      e = sample(gebco, lats[i], lons[j]);
      filled++;
    }
    elevations[i * nLon + j] = Math.round(e * 10) / 10;
  }

const out = {
  source:
    'EMODnet Bathymetry DTM 2024 (sea, ~115 m) merged with GEBCO 2020 (land + gap fill, ~450 m)',
  sourceUrls: [
    'https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024',
    'https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020',
  ],
  fetchedAt: new Date().toISOString().slice(0, 10),
  note: 'elevations row-major; row 0 = latMin (south), col 0 = lonMin (west), ascending. metres, negative = below sea level.',
  latMin: lats[0],
  latMax: lats[nLat - 1],
  lonMin: lons[0],
  lonMax: lons[nLon - 1],
  nLat,
  nLon,
  elevations,
};

const here = dirname(fileURLToPath(import.meta.url));
// Fixed output location — this script exists solely to (re)build the committed
// bathymetry asset, so it takes no path arguments.
const outPath = resolve(here, '../src/data/bathymetry.json');
writeFileSync(outPath, JSON.stringify(out));
console.log(
  `merged ${nLat} × ${nLon} (${filled} GEBCO-filled) → ${outPath}`,
);
