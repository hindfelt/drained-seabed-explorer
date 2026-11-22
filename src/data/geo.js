// Geographic reference frame for the Drained Seabed Explorer.
//
// Supports both the default bundled northern Öresund window AND any dynamic
// coastal bounding box chosen from the interactive World Map picker.
// World frame: 1200×1200 square centered at origin (+x = east, -z = north).

export const TERRAIN_SIZE = 1200;

export const LON_MIN = 12.44;
export const LON_MAX = 12.94;
export const LAT_MIN = 55.82;
export const LAT_MAX = 56.1;

export const DEFAULT_BBOX = {
  latMin: LAT_MIN,
  latMax: LAT_MAX,
  lonMin: LON_MIN,
  lonMax: LON_MAX,
};

/**
 * Creates a reusable WGS84 <-> world [x, z] projection for any bounding box.
 */
export function createGeoProjection(bbox = DEFAULT_BBOX) {
  const { latMin, latMax, lonMin, lonMax } = bbox;
  const half = TERRAIN_SIZE / 2;
  const lonSpan = lonMax - lonMin || 1;
  const latSpan = latMax - latMin || 1;

  function geoToWorld(lat, lon) {
    const x = -half + ((lon - lonMin) / lonSpan) * TERRAIN_SIZE;
    const z = half - ((lat - latMin) / latSpan) * TERRAIN_SIZE;
    return [x, z];
  }

  function worldToGeo(x, z) {
    const lon = lonMin + ((x + half) / TERRAIN_SIZE) * lonSpan;
    const lat = latMin + ((half - z) / TERRAIN_SIZE) * latSpan;
    return [lat, lon];
  }

  const midLat = (latMin + latMax) / 2;
  const heightKm = Math.max(1, Math.round(latSpan * 111.32));
  const widthKm = Math.max(1, Math.round(lonSpan * 111.32 * Math.cos((midLat * Math.PI) / 180)));

  return { bbox, geoToWorld, worldToGeo, widthKm, heightKm };
}

const defaultProj = createGeoProjection(DEFAULT_BBOX);

export function geoToWorld(lat, lon, bbox) {
  return bbox ? createGeoProjection(bbox).geoToWorld(lat, lon) : defaultProj.geoToWorld(lat, lon);
}

export function worldToGeo(x, z, bbox) {
  return bbox ? createGeoProjection(bbox).worldToGeo(x, z) : defaultProj.worldToGeo(x, z);
}
