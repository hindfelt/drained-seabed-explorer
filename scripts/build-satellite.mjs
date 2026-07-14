// Fetch ONE north-up RGB satellite image covering exactly the map window
// (lon 12.44–12.94, lat 55.82–56.10, WGS84) and save it for the land material.
//
//   node scripts/build-satellite.mjs
//
// Tries EOX Sentinel-2 cloudless WMS first, then Esri World Imagery. Validates
// the result WITHOUT any image library: HTTP 200, image/* content-type, > 300 KB,
// JPEG magic bytes, and the SOF marker parsed for real pixel dimensions.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BBOX = [12.44, 55.82, 12.94, 56.1]; // lon_min, lat_min, lon_max, lat_max
const bboxStr = BBOX.join(',');
const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(here, '../src/assets');

const eox = (layer, size) =>
  `https://tiles.maps.eox.at/wms?service=WMS&request=GetMap&version=1.1.1&layers=${layer}` +
  `&bbox=${bboxStr}&srs=EPSG:4326&width=${size}&height=${size}&format=image/jpeg`;
const esri = (size) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export` +
  `?bbox=${bboxStr}&bboxSR=4326&size=${size},${size}&format=jpg&f=image`;

// Candidate sources in priority order: [label, attribution, url-fn].
const SOURCES = [
  ['EOX Sentinel-2 cloudless 2023', 'Sentinel-2 cloudless by EOX', (s) => eox('s2cloudless-2023', s)],
  ['EOX Sentinel-2 cloudless 2022', 'Sentinel-2 cloudless by EOX', (s) => eox('s2cloudless-2022', s)],
  ['EOX Sentinel-2 cloudless', 'Sentinel-2 cloudless by EOX', (s) => eox('s2cloudless', s)],
  ['Esri World Imagery', 'Esri World Imagery', (s) => esri(s)],
];
const SIZES = [4096, 2048];

function isJpeg(buf) {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
}

// Parse the first Start-Of-Frame marker for real width/height (no image libs).
function jpegDimensions(buf) {
  let i = 2; // skip SOI (FF D8)
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // Standalone markers (no length payload): RSTn (D0-D7), SOI/EOI (D8/D9), TEM (01).
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    // SOF markers C0-CF except DHT (C4), JPG (C8), DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

async function attempt(label, urlFn, size) {
  const url = urlFn(size);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'drained-seabed/1.0' } });
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    const reason = [];
    if (!res.ok) reason.push(`HTTP ${res.status}`);
    if (!ct.startsWith('image/')) reason.push(`content-type ${ct || 'none'}`);
    if (buf.length <= 300 * 1024) reason.push(`${(buf.length / 1024).toFixed(0)} KB ≤ 300 KB`);
    if (!isJpeg(buf)) reason.push('not JPEG (no FF D8)');
    const dims = isJpeg(buf) ? jpegDimensions(buf) : null;
    if (isJpeg(buf) && !dims) reason.push('no SOF marker');
    if (reason.length) {
      console.log(`  ✗ ${label} @ ${size}: ${reason.join(', ')}`);
      return null;
    }
    console.log(`  ✓ ${label} @ ${size}: ${(buf.length / 1024).toFixed(0)} KB, ${dims.width}×${dims.height}`);
    return { label, buf, dims };
  } catch (e) {
    console.log(`  ✗ ${label} @ ${size}: ${e.message}`);
    return null;
  }
}

let win = null;
outer: for (const [label, attribution, urlFn] of SOURCES) {
  for (const size of SIZES) {
    const r = await attempt(label, urlFn, size);
    if (r) {
      win = { ...r, attribution };
      break outer;
    }
  }
}

if (!win) {
  console.error('\nFAILED: no satellite source returned a valid image. Nothing written.');
  process.exit(1);
}

mkdirSync(assetsDir, { recursive: true });
const imgPath = resolve(assetsDir, 'satellite-land.jpg');
writeFileSync(imgPath, win.buf);
const meta = {
  source: win.label,
  attribution: win.attribution,
  bbox: BBOX,
  width: win.dims.width,
  height: win.dims.height,
  fetchedAt: new Date().toISOString().slice(0, 10),
};
writeFileSync(resolve(assetsDir, 'satellite-meta.json'), JSON.stringify(meta, null, 2));
console.log(`\nsaved ${imgPath} (${(win.buf.length / 1024).toFixed(0)} KB)`);
console.log(JSON.stringify(meta, null, 2));
