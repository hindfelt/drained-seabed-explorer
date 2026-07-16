const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const KIND_PRIORITY = { city: 0, town: 1, village: 2 };

export const meta = {
  name: 'openstreetmap-overpass',
  coverage: 'global',
  license: 'Open Database License (ODbL) 1.0',
  attribution: '© OpenStreetMap contributors',
};

export async function fetchPlaces(bbox, { fetchImpl = fetch, max = 12 } = {}) {
  const query = `[out:json][timeout:25];node["place"~"^(city|town|village)$"](${bbox.latMin},${bbox.lonMin},${bbox.latMax},${bbox.lonMax});out body;`;
  // Overpass 406es a bare text/plain body — it wants a form-encoded `data`
  // field and a self-identifying User-Agent.
  const response = await fetchImpl(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'drained-seabed/1.0',
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass places request ${response.status ?? 'error'} for ${OVERPASS_URL}`);
  }

  const payload = await response.json();
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const limit = Math.max(0, Math.floor(max));

  return elements
    .filter((element) => (
      typeof element.tags?.name === 'string'
      && element.tags.name.trim() !== ''
      && Object.hasOwn(KIND_PRIORITY, element.tags.place)
      && Number.isFinite(element.lat)
      && Number.isFinite(element.lon)
    ))
    .map((element) => ({
      id: `place-${element.id}`,
      name: element.tags.name,
      latLon: [element.lat, element.lon],
      kind: element.tags.place,
    }))
    .sort(comparePlaces)
    .slice(0, limit);
}

function comparePlaces(a, b) {
  return KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.name.localeCompare(b.name);
}
