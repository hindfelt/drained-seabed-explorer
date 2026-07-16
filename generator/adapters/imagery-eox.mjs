export const meta = {
  name: 'eox-sentinel-2-cloudless',
  coverage: 'global',
  license: 'CC BY-NC-SA 4.0 (non-commercial, share-alike) — https://creativecommons.org/licenses/by-nc-sa/4.0/ — source https://cloudless.eox.at, unmodified except cropping; Esri fallback subject to Esri terms of use',
  attribution: 'Sentinel-2 cloudless 2023 by EOX (https://s2maps.eu)',
};

const EOX_SOURCE = {
  name: 'EOX Sentinel-2 cloudless 2023',
  // EOX's required attribution form: year-specific, linked, with the
  // Copernicus notice. CC BY-NC-SA 4.0 — non-commercial use only.
  attribution: 'Sentinel-2 cloudless 2023 — https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2023)',
  url(bbox, size) {
    const bboxString = bboxToString(bbox);
    return 'https://tiles.maps.eox.at/wms?service=WMS&request=GetMap&version=1.1.1'
      + '&layers=s2cloudless-2023'
      + `&bbox=${bboxString}&srs=EPSG:4326&width=${size}&height=${size}&format=image/jpeg`;
  },
};

const ESRI_SOURCE = {
  name: 'Esri World Imagery',
  attribution: 'Esri World Imagery',
  url(bbox, size) {
    const bboxString = bboxToString(bbox);
    return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export'
      + `?bbox=${bboxString}&bboxSR=4326&size=${size},${size}&format=jpg&f=image`;
  },
};

function bboxToString(bbox) {
  return [bbox.lonMin, bbox.latMin, bbox.lonMax, bbox.latMax].join(',');
}

function isJpeg(buf) {
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

/**
 * Read JPEG dimensions from the first Start Of Frame segment.
 * Supports baseline (SOF0), progressive (SOF2), and the other JPEG SOF variants.
 */
export function parseJpegSize(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (!isJpeg(bytes)) throw new Error('Invalid JPEG: missing FF D8 magic bytes');

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }

    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    const markerOffset = offset - 1;

    // Standalone markers have no length payload: TEM, RSTn, SOI, and EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset++;
      continue;
    }

    // A Start Of Frame always precedes the compressed scan data.
    if (marker === 0xda) break;
    if (markerOffset + 3 >= bytes.length) break;

    const segmentLength = bytes.readUInt16BE(markerOffset + 2);
    if (segmentLength < 2 || markerOffset + 2 + segmentLength > bytes.length) {
      throw new Error('Invalid JPEG: malformed marker segment');
    }

    // SOF markers are C0-CF except DHT (C4), JPG (C8), and DAC (CC).
    const isStartOfFrame = marker >= 0xc0
      && marker <= 0xcf
      && marker !== 0xc4
      && marker !== 0xc8
      && marker !== 0xcc;

    if (isStartOfFrame) {
      if (segmentLength < 7 || markerOffset + 8 >= bytes.length) {
        throw new Error('Invalid JPEG: truncated SOF marker');
      }

      const height = bytes.readUInt16BE(markerOffset + 5);
      const width = bytes.readUInt16BE(markerOffset + 7);
      if (width === 0 || height === 0) throw new Error('Invalid JPEG: zero-sized image');
      return { width, height };
    }

    offset = markerOffset + 2 + segmentLength;
  }

  throw new Error('Invalid JPEG: no SOF marker');
}

export async function fetchImagery(bbox, { fetchImpl = fetch, size = 4096 } = {}) {
  const errors = [];

  for (const candidate of [EOX_SOURCE, ESRI_SOURCE]) {
    const url = candidate.url(bbox, size);
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': 'drained-seabed/1.0' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status ?? 'error'}`);
      }

      const jpeg = Buffer.from(await response.arrayBuffer());
      if (!isJpeg(jpeg)) throw new Error('response is not a JPEG (missing FF D8 magic bytes)');
      const { width, height } = parseJpegSize(jpeg);

      return {
        jpeg,
        width,
        height,
        source: candidate.name,
        attribution: candidate.attribution,
      };
    } catch (error) {
      errors.push(`${candidate.name}: ${error.message}`);
    }
  }

  throw new Error(`No imagery source returned a valid JPEG (${errors.join('; ')})`);
}
