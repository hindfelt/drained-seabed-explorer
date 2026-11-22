// Thin Node server wrapper around src/data/liveRegion.js plus image & geocode proxies.
import { buildLiveRegion as buildRegionCore } from '../data/liveRegion.js';

export function buildLiveRegion(params) {
  return buildRegionCore({ ...params, browserMode: false });
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'DrainedSeabedExplorer/1.0 (https://github.com/hindfelt/drained-seabed-explorer)',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSatelliteProxy({ latMin, latMax, lonMin, lonMax }) {
  const bboxStr = `${Number(lonMin).toFixed(5)},${Number(latMin).toFixed(5)},${Number(lonMax).toFixed(5)},${Number(latMax).toFixed(5)}`;
  const urls = [
    `https://tiles.maps.eox.at/wms?service=WMS&request=GetMap&version=1.1.1&layers=s2cloudless-2023&bbox=${bboxStr}&srs=EPSG:4326&width=2048&height=2048&format=image/jpeg`,
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bboxStr}&bboxSR=4326&size=2048,2048&format=jpg&f=image`,
  ];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 16000);
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.startsWith('image/')) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 20 * 1024) {
          return { buffer: buf, contentType: ct };
        }
      }
    } catch {
      // try fallback
    }
  }
  return null;
}

export async function fetchGeocodeProxy(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, 8000);
  if (!res.ok) return [];
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    name: r.display_name,
    shortName: r.name || r.display_name.split(',')[0],
    lat: Number(r.lat),
    lon: Number(r.lon),
  }));
}
