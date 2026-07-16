const WFS_URL = 'https://ows.emodnet-humanactivities.eu/wfs';
const PAGE_SIZE = 200;

export const meta = {
  name: 'ukho-global-wrecks',
  coverage: 'global',
  license: 'Open Government Licence',
  attribution: 'Wrecks © UK Hydrographic Office via EMODnet Human Activities, OGL',
};

export async function fetchWrecks(bbox, { fetchImpl = fetch, max = 60 } = {}) {
  const bboxParam = `${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax},EPSG:4326`;
  const url = `${WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&typeNames=emodnet:wwshipwrecks&outputFormat=application/json&bbox=${bboxParam}&count=${PAGE_SIZE}`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`EMODnet wrecks WFS ${response.status ?? 'error'} for ${url}`);
  }

  const payload = await response.json();
  const features = Array.isArray(payload.features) ? payload.features : [];
  const numberMatched = Number(payload.numberMatched);

  if (Number.isFinite(numberMatched) && numberMatched > features.length) {
    console.warn(
      `EMODnet wrecks WFS matched ${numberMatched} features but returned ${features.length}; using the first page only`,
    );
  }

  const wrecks = features.map(normalizeWreck);
  if (wrecks.length <= max) return wrecks;

  const result = wrecks
    .map((wreck, sourceIndex) => ({ wreck, sourceIndex }))
    .sort(compareWreckPriority)
    .slice(0, Math.max(0, Math.floor(max)))
    .map(({ wreck }) => wreck);

  result.dropped = wrecks.length - result.length;
  return result;
}

function normalizeWreck(feature) {
  const properties = feature.properties ?? {};
  const [lon, lat] = feature.geometry.coordinates;

  return {
    id: String(feature.id ?? properties.wreck_id),
    name: nullableText(properties.name),
    latLon: [lat, lon],
    type: nullableText(properties.type),
    sunkYear: parseSunkYear(properties.date_sunk),
    depthMeters: nullableNumber(properties.depth),
    lengthMeters: nullableNumber(properties.length),
    category: nullableText(properties.wreck_cate) ?? 'Wreck',
    story: nullableText(properties.circumstan),
    approximate: positionIsApproximate(properties),
  };
}

function nullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' || /^n\/a$/i.test(text) ? null : text;
}

function nullableNumber(value) {
  const text = nullableText(value);
  if (text === null) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseSunkYear(value) {
  const match = String(value ?? '').match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return match ? Number(match[1]) : null;
}

// UKHO's position_m (position method) is 'n/a' across entire regions, so it
// carries no signal. Two signals do:
// 1. Explicit uncertainty language in the survey/position history fields
//    ('REPD SUNK IN 560500N, 123300E APPROX.') — authoritative, overrides
//    any precise-looking coordinate formatting.
// 2. The charted `position` text precision: fixes recorded with decimal
//    minutes on BOTH axes ('55 58.585 N,12 33.589 E') are surveyed
//    positions; whole-minute entries ('56 2 N,12 38 E', ~1 nm) are estimates.
const UNCERTAIN_POSITION_PATTERN =
  /\bAPPROX\b|\bAPPROXIMATE\b|POSN\s+DOUBTFUL|POSITION\s+DOUBTFUL|\bUNVERIFIED\b|\bun[-\s]?surveyed\b|\bnot\s+surveyed\b/i;

function positionIsApproximate(properties) {
  const uncertaintyDeclared = Object.entries(properties).some(
    ([key, value]) =>
      /(qual|accu|survey|position|original)/i.test(key)
      && UNCERTAIN_POSITION_PATTERN.test(String(value ?? '')),
  );
  if (uncertaintyDeclared) return true;

  const text = nullableText(properties.position);
  if (text === null) return true;
  const parts = text.split(',');
  return !(parts.length === 2
    && parts.every((part) => /\d+\s+\d+\.\d+\s+[NSEW]/.test(part.trim())));
}

function compareWreckPriority(a, b) {
  const namedDifference = Number(b.wreck.name !== null) - Number(a.wreck.name !== null);
  if (namedDifference !== 0) return namedDifference;

  const aDepth = a.wreck.depthMeters ?? Number.NEGATIVE_INFINITY;
  const bDepth = b.wreck.depthMeters ?? Number.NEGATIVE_INFINITY;
  return bDepth - aDepth || a.sourceIndex - b.sourceIndex;
}
