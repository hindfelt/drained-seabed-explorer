// Isomorphic live open-data marine region builder (works identically in Node
// via Vite's /api/region middleware AND directly in the browser as a CORS fallback).
//
// Integrated Open Marine & Shipwreck Sources:
//   1. EMODnet Bathymetry DTM 2024 (~115 m, Europe, CORS-enabled)
//   2. GEBCO 2020 (~450 m, Global, via Node proxy)
//   3. EMODnet Cultural Heritage Shipwrecks (`emodnet:heritageshipwrecks`, CORS-enabled —
//      Historic England, SHOM France, Ireland National Monuments, Oxford Roman Economy Project)
//   4. UKHO Global Shipwrecks (`emodnet:wwshipwrecks`, 94,000+ wrecks worldwide, CORS-enabled)
//   5. Wikidata / Wikipedia geolocated shipwrecks (SPARQL, CORS-enabled — direct Wikipedia URLs!)
//   6. OpenStreetMap Overpass places & seamark wrecks

const regionCache = new Map();
const CACHE_LIMIT = 24;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function coversEurope(bbox) {
  return bbox.latMax > 25 && bbox.latMin < 73 && bbox.lonMax > -36 && bbox.lonMin < 43;
}

function parseErddapGrid(json) {
  const { columnNames, rows } = json.table;
  const iLat = columnNames.indexOf('latitude');
  const iLon = columnNames.indexOf('longitude');
  const iEl = columnNames.indexOf('elevation');
  if (iLat < 0 || iLon < 0 || iEl < 0 || !rows?.length) {
    throw new Error('Unexpected ERDDAP table response');
  }

  const latSet = new Set();
  const lonSet = new Set();
  for (const r of rows) {
    latSet.add(r[iLat]);
    lonSet.add(r[iLon]);
  }
  const lats = [...latSet].sort((a, b) => a - b);
  const lons = [...lonSet].sort((a, b) => a - b);
  const latIdx = new Map(lats.map((v, i) => [v, i]));
  const lonIdx = new Map(lons.map((v, i) => [v, i]));

  const elevations = new Float64Array(lats.length * lons.length);
  elevations.fill(NaN);
  for (const r of rows) {
    const el = r[iEl];
    const v = el == null || el === 'NaN' ? NaN : Number(el);
    elevations[latIdx.get(r[iLat]) * lons.length + lonIdx.get(r[iLon])] = Number.isFinite(v) ? v : NaN;
  }
  return { lats, lons, nLat: lats.length, nLon: lons.length, elevations };
}

function findBracket(arr, val) {
  const n = arr.length;
  if (n <= 1) return [0, 0, 0];
  if (val <= arr[0]) return [0, 0, 0];
  if (val >= arr[n - 1]) return [n - 1, n - 1, 0];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= val) lo = mid;
    else hi = mid;
  }
  const span = arr[hi] - arr[lo] || 1;
  return [lo, hi, (val - arr[lo]) / span];
}

function sampleGrid(grid, lat, lon) {
  if (!grid || grid.nLat === 0 || grid.nLon === 0) return NaN;
  const [i0, i1, ti] = findBracket(grid.lats, lat);
  const [j0, j1, tj] = findBracket(grid.lons, lon);
  const a = grid.elevations[i0 * grid.nLon + j0];
  const b = grid.elevations[i0 * grid.nLon + j1];
  const c = grid.elevations[i1 * grid.nLon + j0];
  const d = grid.elevations[i1 * grid.nLon + j1];

  if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d)) {
    const top = a + (b - a) * tj;
    const bot = c + (d - c) * tj;
    return top + (bot - top) * ti;
  }

  const corners = [
    [a, (1 - ti) * (1 - tj)],
    [b, (1 - ti) * tj],
    [c, ti * (1 - tj)],
    [d, ti * tj],
  ];
  let wSum = 0;
  let vSum = 0;
  for (const [val, w] of corners) {
    if (Number.isFinite(val)) {
      vSum += val * w;
      wSum += w;
    }
  }
  return wSum > 0 ? vSum / wSum : NaN;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 18000, isBrowser = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { ...(opts.headers || {}) };
    if (!isBrowser && !headers['User-Agent']) {
      headers['User-Agent'] = 'DrainedSeabedExplorer/1.0 (https://github.com/hindfelt/drained-seabed-explorer)';
    }
    return await fetch(url, { ...opts, signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGebco(bbox, isBrowser) {
  const latSpan = bbox.latMax - bbox.latMin;
  const lonSpan = bbox.lonMax - bbox.lonMin;
  const latStride = Math.max(1, Math.ceil((latSpan * 240) / 200));
  const lonStride = Math.max(1, Math.ceil((lonSpan * 240) / 200));
  const q = encodeURIComponent(
    `elevation[(${bbox.latMin.toFixed(4)}):${latStride}:(${bbox.latMax.toFixed(4)})][(${bbox.lonMin.toFixed(4)}):${lonStride}:(${bbox.lonMax.toFixed(4)})]`
  );
  const url = `https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020.json?${q}`;
  const res = await fetchWithTimeout(url, {}, 20000, isBrowser);
  if (!res.ok) throw new Error(`GEBCO HTTP ${res.status}`);
  return parseErddapGrid(await res.json());
}

async function fetchEmodnet(bbox, isBrowser) {
  if (!coversEurope(bbox)) return null;
  const latSpan = bbox.latMax - bbox.latMin;
  const lonSpan = bbox.lonMax - bbox.lonMin;
  const latStride = Math.max(1, Math.ceil((latSpan * 960) / 200));
  const lonStride = Math.max(1, Math.ceil((lonSpan * 960) / 200));
  const q = encodeURIComponent(
    `elevation[(${bbox.latMin.toFixed(4)}):${latStride}:(${bbox.latMax.toFixed(4)})][(${bbox.lonMin.toFixed(4)}):${lonStride}:(${bbox.lonMax.toFixed(4)})]`
  );
  const url = `https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024.json?${q}`;
  const res = await fetchWithTimeout(url, {}, 16000, isBrowser);
  if (!res.ok) return null;
  return parseErddapGrid(await res.json());
}

function cleanStr(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s || /^n\/?a$/i.test(s) || /^unknown$/i.test(s) || /^none/i.test(s) || s === '-' || s === '0') return null;
  return s;
}

function cleanUrl(val) {
  const s = cleanStr(val);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  return null;
}

function parseNum(val) {
  const s = cleanStr(val);
  if (!s) return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseYear(val) {
  const s = cleanStr(val);
  if (!s) return null;
  const m = s.match(/\b(1[3-9]\d\d|20[0-2]\d)\b/) || s.match(/^(1[3-9]\d\d|20[0-2]\d)/);
  return m ? Number(m[1]) : null;
}

function titleCaseName(raw) {
  if (!raw) return null;
  if (raw === raw.toUpperCase() && raw.length > 3) {
    return raw
      .toLowerCase()
      .replace(/(^|[\s\-/.])([a-zåäöæø])/g, (_, sep, ch) => sep + ch.toUpperCase())
      .replace(/\b(Ss|S\/S|Hms|Uss|Sms|Mv|Ms|Sv|Ub|Uc)\b/g, (m) => m.toUpperCase());
  }
  return raw;
}

function buildLookupLinks({ name, hasRealName, ukhoId, lat, lon, extraLinks = [] }) {
  const links = [];
  const seen = new Set();
  const addLink = (label, url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({ label, url });
  };

  for (const l of extraLinks) addLink(l.label, l.url);

  if (hasRealName && name) {
    const cleanQ = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    addLink('Wrecksite.eu', `https://www.google.com/search?q=${encodeURIComponent(`site:wrecksite.eu "${cleanQ}"`)}`);
    if (!links.some((l) => /wikipedia/i.test(l.label))) {
      addLink('Wikipedia', `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(`${cleanQ} shipwreck`)}`);
    }
  } else if (ukhoId) {
    addLink(
      `UKHO #${ukhoId} Search`,
      `https://www.google.com/search?q=${encodeURIComponent(`"${ukhoId}" wreck OR shipwreck UKHO`)}`
    );
    addLink('Wrecksite.eu', `https://www.google.com/search?q=${encodeURIComponent(`site:wrecksite.eu "${ukhoId}"`)}`);
  }

  // Always include an exact-coordinate OpenSeaMap nautical chart deep link
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    addLink('OpenSeaMap Chart', `https://map.openseamap.org/?zoom=15&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
  }
  return links;
}

/**
 * 1. EMODnet Cultural Heritage Shipwrecks (Historic England, SHOM France,
 * Ireland National Monuments, Oxford Roman Economy Project Mediterranean wrecks).
 */
async function fetchHeritageWrecks(bbox, isBrowser = false) {
  if (!coversEurope(bbox)) return [];
  const bboxParam = `${bbox.lonMin.toFixed(5)},${bbox.latMin.toFixed(5)},${bbox.lonMax.toFixed(5)},${bbox.latMax.toFixed(5)},EPSG:4326`;
  const url = `https://ows.emodnet-humanactivities.eu/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&typeNames=emodnet:heritageshipwrecks&outputFormat=application/json&bbox=${bboxParam}&count=100`;
  const res = await fetchWithTimeout(url, {}, 12000, isBrowser);
  if (!res.ok) return [];
  const geo = await res.json();
  const features = Array.isArray(geo.features) ? geo.features : [];

  const out = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const p = f.properties || {};

    const rawName = cleanStr(p.name);
    const objType = cleanStr(p.obj_type) || cleanStr(p.ship_char) || 'heritage wreck';
    const sunkYear = parseYear(p.sink_yr) || parseYear(p.dating);
    const lengthMeters = parseNum(p.object_length);
    const depthMeters = parseNum(p.least_depth) || parseNum(p.max_depth);
    const sourceInf = cleanStr(p.source_inf) || 'EMODnet Heritage';
    const period = cleanStr(p.period);
    const context = cleanStr(p.sink_context);
    const objDesc = cleanStr(p.obj_desc);
    const artefacts = cleanStr(p.artefacts);

    const id = `heritage-${p.source_id || f.id || hashString(`${lat},${lon}`)}`;
    const hasRealName = Boolean(rawName);
    const name = titleCaseName(rawName) || `${titleCaseName(objType)} (${sourceInf})`;

    const storyBits = [];
    if (context) storyBits.push(context);
    if (objDesc && objDesc !== context) storyBits.push(objDesc);
    if (artefacts) storyBits.push(`Artefacts: ${artefacts}`);
    if (period && !sunkYear) storyBits.push(`Period: ${period}`);
    if (depthMeters != null && depthMeters > 0) storyBits.push(`Charted least depth ~${depthMeters.toFixed(1)} m.`);
    const fullDesc = storyBits.join(' ');

    const extraLinks = [];
    const w1 = cleanUrl(p.website1);
    const w2 = cleanUrl(p.website2);
    if (w1) extraLinks.push({ label: sourceInf, url: w1 });
    if (w2) extraLinks.push({ label: 'Archive Record', url: w2 });

    out.push({
      id,
      name,
      hasRealName,
      priority: 3, // rich heritage record
      latLon: [lat, lon],
      heading: ((hashString(id) % 3600) / 3600) * Math.PI * 2,
      length: clamp(lengthMeters || 30, 18, 52),
      type: objType,
      sunkYear,
      approximate: parseNum(p.loc_prec) > 250,
      source: sourceInf,
      description: fullDesc.length > 340 ? `${fullDesc.slice(0, 337)}…` : fullDesc || `Protected/recorded heritage shipwreck (${sourceInf}).`,
      links: buildLookupLinks({ name, hasRealName, lat, lon, extraLinks }),
      _depthSort: depthMeters || 0,
    });
  }
  return out;
}

/**
 * 2. UKHO Global Shipwrecks via EMODnet WFS (94,000+ wrecks worldwide).
 */
async function fetchUkhoWrecks(bbox, isBrowser = false) {
  const bboxParam = `${bbox.lonMin.toFixed(5)},${bbox.latMin.toFixed(5)},${bbox.lonMax.toFixed(5)},${bbox.latMax.toFixed(5)},EPSG:4326`;
  const url = `https://ows.emodnet-humanactivities.eu/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&typeNames=emodnet:wwshipwrecks&outputFormat=application/json&bbox=${bboxParam}&count=200`;
  const res = await fetchWithTimeout(url, {}, 15000, isBrowser);
  if (!res.ok) throw new Error(`UKHO WFS HTTP ${res.status}`);
  const geo = await res.json();
  const features = Array.isArray(geo.features) ? geo.features : [];

  const out = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const p = f.properties || {};

    const ukhoId = cleanStr(p.wreck_id);
    const rawName = cleanStr(p.name);
    const wreckType = cleanStr(p.type) || cleanStr(p.wreck_cate) || 'shipwreck';
    const sunkYear = parseYear(p.date_sunk) || parseYear(p.original_d);
    const lengthMeters = parseNum(p.length) || parseNum(p.sonar_leng);
    const widthMeters = parseNum(p.width) || parseNum(p.sonar_widt);
    const depthMeters = parseNum(p.depth) || parseNum(p.water_dept);
    const orientDeg = parseNum(p.orientatio);
    const flag = cleanStr(p.flag);
    const cargo = cleanStr(p.cargo);
    const tonnage = parseNum(p.tonnage);
    const category = cleanStr(p.wreck_cate);
    const circumstan = cleanStr(p.circumstan);
    const surveying = cleanStr(p.surveying_);
    const general = cleanStr(p.general_co);
    const debris = cleanStr(p.debris_fie);
    const scour = cleanStr(p.scour_dime);
    const bottom = cleanStr(p.bottom_tex);
    const lastDetec = cleanStr(p.last_detec);
    const posMethod = cleanStr(p.position_m);
    const depthQual = cleanStr(p.depth_qual);

    const id = `ukho-${ukhoId || f.id || hashString(`${lat},${lon}`)}`;
    const hasRealName = Boolean(rawName);
    const name =
      titleCaseName(rawName) || `${titleCaseName(wreckType) || 'Charted Wreck'} #${ukhoId || out.length + 1}`;
    const heading =
      orientDeg != null
        ? (orientDeg * Math.PI) / 180
        : ((hashString(id) % 3600) / 3600) * Math.PI * 2;

    const descParts = [];
    if (circumstan) descParts.push(circumstan);
    else if (general) descParts.push(general);
    else if (surveying) descParts.push(surveying);

    const facts = [];
    if (category) facts.push(category);
    if (flag) facts.push(`Flag: ${flag}`);
    if (tonnage) facts.push(`${tonnage} GT`);
    if (cargo) facts.push(`Cargo: ${cargo}`);
    if (lengthMeters && widthMeters) facts.push(`Hull ${lengthMeters.toFixed(0)} × ${widthMeters.toFixed(0)} m`);
    if (depthMeters != null) facts.push(`Charted depth ~${Math.abs(depthMeters).toFixed(1)} m`);
    if (bottom) facts.push(`Seabed: ${bottom}`);
    if (debris) facts.push(`Debris: ${debris}`);
    if (scour) facts.push(`Scour: ${scour}`);
    if (lastDetec) facts.push(`Last surveyed: ${lastDetec}`);

    if (!descParts.length && facts.length) descParts.push(`${facts.join(' · ')}.`);
    else if (descParts.length && facts.length) descParts.push(`(${facts.slice(0, 4).join(' · ')})`);

    const fullDesc = descParts.join(' ');
    const approximate = !posMethod && (!depthQual || /unknown|unsurveyed/i.test(depthQual));

    out.push({
      id,
      name,
      hasRealName,
      priority: hasRealName ? 2 : 1,
      latLon: [lat, lon],
      heading,
      length: clamp(lengthMeters || 28, 18, 52),
      type: wreckType,
      sunkYear,
      approximate,
      source: ukhoId ? `UKHO #${ukhoId}` : 'UKHO Global Wrecks',
      description:
        fullDesc.length > 340
          ? `${fullDesc.slice(0, 337)}…`
          : fullDesc || 'Charted hydrographic seabed wreck from UKHO records.',
      links: buildLookupLinks({ name, hasRealName, ukhoId, lat, lon }),
      _depthSort: depthMeters != null ? Math.abs(depthMeters) : 0,
    });
  }
  return out;
}

/**
 * 3. Wikidata / Wikipedia geolocated shipwrecks (global, CORS-enabled, real Wikipedia URLs!).
 */
async function fetchWikidataWrecks(bbox, isBrowser = false) {
  const sw = `Point(${bbox.lonMin.toFixed(4)} ${bbox.latMin.toFixed(4)})`;
  const ne = `Point(${bbox.lonMax.toFixed(4)} ${bbox.latMax.toFixed(4)})`;
  const sparql = `SELECT ?item ?itemLabel ?coord ?article ?desc ?date WHERE {
    SERVICE wikibase:box {
      ?item wdt:P625 ?coord .
      bd:serviceParam wikibase:cornerWest "${sw}"^^geo:wktLiteral .
      bd:serviceParam wikibase:cornerEast "${ne}"^^geo:wktLiteral .
    }
    ?item wdt:P31/wdt:P279* wd:Q852190 .
    OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
    OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc)="en") }
    OPTIONAL { ?item wdt:P585 ?date . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,sv,da,de,fr". }
  } LIMIT 40`;

  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  const res = await fetchWithTimeout(
    url,
    { headers: { Accept: 'application/sparql-results+json' } },
    9000,
    isBrowser
  );
  if (!res.ok) return [];
  const data = await res.json();
  const rows = data?.results?.bindings || [];

  const out = [];
  const seenIds = new Set();
  for (const r of rows) {
    const qUrl = r.item?.value;
    const coordStr = r.coord?.value || '';
    const m = coordStr.match(/Point\((-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\)/i);
    if (!m || !qUrl || seenIds.has(qUrl)) continue;
    seenIds.add(qUrl);

    const lon = Number(m[1]);
    const lat = Number(m[2]);
    const rawName = r.itemLabel?.value;
    if (!rawName || /^Q\d+$/.test(rawName)) continue;

    const wikiUrl = r.article?.value || null;
    const desc = r.desc?.value || 'Documented historic shipwreck recorded in Wikidata / Wikipedia.';
    const sunkYear = parseYear(r.date?.value);
    const qId = qUrl.split('/').pop();

    const extraLinks = [];
    if (wikiUrl) extraLinks.push({ label: 'Wikipedia', url: wikiUrl });
    extraLinks.push({ label: 'Wikidata', url: qUrl });

    out.push({
      id: `wiki-${qId}`,
      name: rawName,
      hasRealName: true,
      priority: wikiUrl ? 4 : 3, // Wikipedia-backed wrecks get highest priority!
      latLon: [lat, lon],
      heading: ((hashString(qId) % 3600) / 3600) * Math.PI * 2,
      length: 34,
      type: /sub|u-?boat/i.test(`${rawName} ${desc}`)
        ? 'submarine'
        : /destroyer|battleship|cruiser|hms|sms|uss/i.test(`${rawName} ${desc}`)
          ? 'warship'
          : 'shipwreck',
      sunkYear,
      approximate: false,
      source: wikiUrl ? 'Wikipedia / Wikidata' : 'Wikidata',
      description: desc.charAt(0).toUpperCase() + desc.slice(1) + (desc.endsWith('.') ? '' : '.'),
      links: buildLookupLinks({ name: rawName, hasRealName: true, lat, lon, extraLinks }),
      _depthSort: 25,
    });
  }
  return out;
}

/**
 * 4. OpenStreetMap Overpass: coastal places + OpenSeaMap wrecks (with wikipedia/website links).
 */
async function fetchOverpassPlacesAndWrecks(bbox, isBrowser = false) {
  const b = `${bbox.latMin.toFixed(4)},${bbox.lonMin.toFixed(4)},${bbox.latMax.toFixed(4)},${bbox.lonMax.toFixed(4)}`;
  const query = `[out:json][timeout:10];(node["place"~"^(city|town|village)$"](${b});node["seamark:type"="wreck"](${b});node["historic"="wreck"](${b}););out body 120;`;
  const res = await fetchWithTimeout(
    'https://overpass-api.de/api/interpreter',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `data=${encodeURIComponent(query)}`,
    },
    10000,
    isBrowser
  );
  if (!res.ok) return { places: [], osmWrecks: [] };
  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];

  const places = [];
  const osmWrecks = [];
  const kindRank = { city: 0, town: 1, village: 2 };

  for (const el of elements) {
    const tags = el.tags || {};
    if (tags.place && tags.name) {
      places.push({
        id: `osm-place-${el.id}`,
        name: tags.name,
        latLon: [el.lat, el.lon],
        kind: tags.place,
        _pop: parseNum(tags.population) || 0,
      });
    } else if (tags['seamark:type'] === 'wreck' || tags.historic === 'wreck') {
      const rawName = cleanStr(tags.name || tags['seamark:name']);
      const hasRealName = Boolean(rawName);
      const name = rawName || `OSM Wreck #${el.id}`;
      const extraLinks = [];
      if (tags.wikipedia) {
        const [lang, ...rest] = tags.wikipedia.includes(':') ? tags.wikipedia.split(':') : ['en', tags.wikipedia];
        extraLinks.push({
          label: 'Wikipedia',
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(rest.join(':').replace(/ /g, '_'))}`,
        });
      }
      const webUrl = cleanUrl(tags.website || tags.url);
      if (webUrl) extraLinks.push({ label: 'Source Page', url: webUrl });
      extraLinks.push({ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/node/${el.id}` });

      osmWrecks.push({
        id: `osm-wreck-${el.id}`,
        name,
        hasRealName,
        priority: hasRealName ? 2 : 0,
        latLon: [el.lat, el.lon],
        heading: ((hashString(String(el.id)) % 3600) / 3600) * Math.PI * 2,
        length: clamp(parseNum(tags.length) || 26, 18, 45),
        type: cleanStr(tags['wreck:type'] || tags.ship_type) || 'shipwreck',
        sunkYear: parseYear(tags.start_date || tags.end_date || tags.date_sunk),
        approximate: !hasRealName,
        source: 'OpenStreetMap',
        description:
          cleanStr(tags.description || tags.note) ||
          'OpenStreetMap / OpenSeaMap charted shipwreck location.',
        links: buildLookupLinks({ name, hasRealName, lat: el.lat, lon: el.lon, extraLinks }),
        _depthSort: parseNum(tags['seamark:wreck:depth']) || 0,
      });
    }
  }

  places.sort((a, b) => {
    const r = (kindRank[a.kind] ?? 3) - (kindRank[b.kind] ?? 3);
    if (r !== 0) return r;
    if (b._pop !== a._pop) return b._pop - a._pop;
    return a.name.localeCompare(b.name);
  });

  const selectedPlaces = [];
  const minSep = Math.max(bbox.latMax - bbox.latMin, bbox.lonMax - bbox.lonMin) * 0.08;
  for (const p of places) {
    if (selectedPlaces.length >= 10) break;
    const tooClose = selectedPlaces.some(
      (q) => Math.hypot(q.latLon[0] - p.latLon[0], q.latLon[1] - p.latLon[1]) < minSep
    );
    if (!tooClose) {
      const { _pop, ...clean } = p;
      selectedPlaces.push(clean);
    }
  }

  return { places: selectedPlaces, osmWrecks };
}

/**
 * Merges wrecks from Wikipedia/Wikidata, EMODnet Heritage, UKHO Global, and OSM:
 * - When two sources refer to the same wreck (within ~350 m or matching name),
 *   fuses their links, richer name, longer historical description, and metadata.
 */
function mergeAndEnrichWrecks(lists, maxCount = 52) {
  const all = lists.flat();
  // Highest-richness sources first (Wikipedia -> Heritage -> Named UKHO -> OSM -> Unnamed UKHO)
  all.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.hasRealName !== b.hasRealName) return a.hasRealName ? -1 : 1;
    if (Boolean(a.sunkYear) !== Boolean(b.sunkYear)) return a.sunkYear ? -1 : 1;
    return b.length - a.length || (b._depthSort || 0) - (a._depthSort || 0);
  });

  const merged = [];
  for (const cand of all) {
    const normCand = cand.hasRealName ? cand.name.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const existing = merged.find((m) => {
      const d = Math.hypot(m.latLon[0] - cand.latLon[0], m.latLon[1] - cand.latLon[1]);
      if (d < 0.0028) return true; // ~300 m proximity match
      if (normCand && normCand.length >= 5 && m.hasRealName) {
        const normM = m.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normM === normCand && d < 0.03) return true;
      }
      return false;
    });

    if (existing) {
      // Enrich existing record with any missing facts or links
      if (!existing.sunkYear && cand.sunkYear) existing.sunkYear = cand.sunkYear;
      if (cand.description && cand.description.length > existing.description.length + 25) {
        existing.description = cand.description;
      }
      if (existing.type === 'shipwreck' && cand.type && cand.type !== 'shipwreck') {
        existing.type = cand.type;
      }
      if (cand.links?.length) {
        const haveUrls = new Set(existing.links.map((l) => l.url));
        for (const l of cand.links) {
          if (!haveUrls.has(l.url) && existing.links.length < 4) {
            existing.links.push(l);
            haveUrls.add(l.url);
          }
        }
      }
    } else {
      merged.push({ ...cand, links: [...(cand.links || [])] });
    }
  }

  return merged.slice(0, maxCount).map(({ hasRealName, priority, _depthSort, ...clean }) => clean);
}

function detectShoals(elevations, nLat, nLon, bbox, maxShoals = 4) {
  const candidates = [];
  const margin = 8;
  if (nLat < margin * 2 + 4 || nLon < margin * 2 + 4) return [];

  for (let i = margin; i < nLat - margin; i += 2) {
    for (let j = margin; j < nLon - margin; j += 2) {
      const h = elevations[i * nLon + j];
      if (!Number.isFinite(h) || h >= -1.5) continue;

      let ringSum = 0;
      let ringCount = 0;
      let isPeak = true;
      for (let di = -4; di <= 4; di += 2) {
        for (let dj = -4; dj <= 4; dj += 2) {
          if (di === 0 && dj === 0) continue;
          const v = elevations[(i + di) * nLon + (j + dj)];
          if (v > h + 0.2) {
            isPeak = false;
            break;
          }
          ringSum += v;
          ringCount++;
        }
        if (!isPeak) break;
      }
      if (!isPeak || ringCount === 0) continue;

      const ringMean = ringSum / ringCount;
      const prominence = h - ringMean;
      if (prominence >= 4.5 && ringMean < -4) {
        candidates.push({ i, j, crest: h, prominence });
      }
    }
  }

  candidates.sort((a, b) => b.prominence - a.prominence);
  const picked = [];
  const minCellSep = Math.max(12, Math.floor(Math.min(nLat, nLon) * 0.14));

  for (const c of candidates) {
    if (picked.length >= maxShoals) break;
    const tooClose = picked.some((p) => Math.hypot(p.i - c.i, p.j - c.j) < minCellSep);
    if (!tooClose) picked.push(c);
  }

  return picked.map((c, idx) => {
    const lat = bbox.latMin + (c.i / (nLat - 1)) * (bbox.latMax - bbox.latMin);
    const lon = bbox.lonMin + (c.j / (nLon - 1)) * (bbox.lonMax - bbox.lonMin);
    return {
      id: `shoal-auto-${idx + 1}`,
      name: `Shoal ${idx + 1} (${Math.abs(c.crest).toFixed(0)} m)`,
      latLon: [lat, lon],
      radius: 38,
      description: `Submerged bank/seamount detected from bathymetry rising ~${c.prominence.toFixed(0)} m above the surrounding floor (crest at ${Math.abs(c.crest).toFixed(1)} m depth).`,
    };
  });
}

function computeAutoScale(elevations) {
  const seaVals = [];
  let maxLand = 0;
  for (let i = 0; i < elevations.length; i++) {
    const v = elevations[i];
    if (!Number.isFinite(v)) continue;
    if (v < 0) seaVals.push(v);
    else if (v > maxLand) maxLand = v;
  }

  seaVals.sort((a, b) => a - b);
  const minMeters = seaVals.length ? seaVals[0] : -40;
  const p02 = seaVals.length ? seaVals[Math.floor(seaVals.length * 0.02)] : -40;
  const refDepth = Math.max(14, Math.abs(p02));

  const seaExaggeration = clamp(96 / refDepth, 0.08, 3.2);
  const landExaggeration = clamp(
    maxLand > 10 ? Math.min(seaExaggeration * 0.72, 48 / (maxLand * 0.65)) : seaExaggeration * 0.65,
    0.05,
    1.8
  );

  return {
    seaExaggeration: Number(seaExaggeration.toFixed(4)),
    landExaggeration: Number(landExaggeration.toFixed(4)),
    landCeiling: 45,
    minMeters: Number(minMeters.toFixed(1)),
    maxMeters: Number(maxLand.toFixed(1)),
  };
}

function fillMissingLandElevation(elevations, nLat, nLon) {
  const dist = new Float32Array(nLat * nLon);
  const INF = 1e6;
  for (let k = 0; k < elevations.length; k++) {
    dist[k] = Number.isFinite(elevations[k]) ? 0 : INF;
  }
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const idx = i * nLon + j;
      let d = dist[idx];
      if (i > 0) d = Math.min(d, dist[(i - 1) * nLon + j] + 1);
      if (j > 0) d = Math.min(d, dist[idx - 1] + 1);
      dist[idx] = d;
    }
  }
  for (let i = nLat - 1; i >= 0; i--) {
    for (let j = nLon - 1; j >= 0; j--) {
      const idx = i * nLon + j;
      let d = dist[idx];
      if (i < nLat - 1) d = Math.min(d, dist[(i + 1) * nLon + j] + 1);
      if (j < nLon - 1) d = Math.min(d, dist[idx + 1] + 1);
      dist[idx] = d;
    }
  }
  for (let k = 0; k < elevations.length; k++) {
    if (!Number.isFinite(elevations[k])) {
      elevations[k] = Math.round(Math.min(38, 2.5 + Math.sqrt(dist[k]) * 4.8) * 10) / 10;
    }
  }
}

export async function buildLiveRegion({
  latMin,
  latMax,
  lonMin,
  lonMax,
  name = 'Custom Region',
  browserMode = false,
}) {
  const bbox = {
    latMin: clamp(Number(latMin), -84, 84),
    latMax: clamp(Number(latMax), -84, 84),
    lonMin: clamp(Number(lonMin), -179.9, 179.9),
    lonMax: clamp(Number(lonMax), -179.9, 179.9),
  };
  if (!(bbox.latMax > bbox.latMin) || !(bbox.lonMax > bbox.lonMin)) {
    throw new Error('Invalid bounding box');
  }

  const cacheKey = `${browserMode ? 'b' : 's'}:${bbox.latMin.toFixed(3)},${bbox.latMax.toFixed(3)},${bbox.lonMin.toFixed(3)},${bbox.lonMax.toFixed(3)}`;
  if (regionCache.has(cacheKey)) {
    const cached = regionCache.get(cacheKey);
    return { ...cached, meta: { ...cached.meta, name: name || cached.meta.name } };
  }

  // Fetch bathymetry + ALL FOUR open wreck & heritage databases in parallel!
  const [gebcoRes, emodRes, ukhoRes, heritageRes, wikiRes, osmRes] = await Promise.allSettled([
    browserMode ? Promise.reject(new Error('GEBCO requires server proxy')) : fetchGebco(bbox, false),
    fetchEmodnet(bbox, browserMode),
    fetchUkhoWrecks(bbox, browserMode),
    fetchHeritageWrecks(bbox, browserMode),
    fetchWikidataWrecks(bbox, browserMode),
    fetchOverpassPlacesAndWrecks(bbox, browserMode),
  ]);

  const coarse = gebcoRes.status === 'fulfilled' ? gebcoRes.value : null;
  const fine = emodRes.status === 'fulfilled' ? emodRes.value : null;

  if (!coarse && !fine) {
    if (browserMode && !coversEurope(bbox)) {
      throw new Error(
        'Regions outside Europe use NOAA GEBCO, which requires restarting `npm run dev` so Vite loads vite.config.js.'
      );
    }
    throw new Error(`Could not fetch bathymetry (${gebcoRes.reason?.message || 'network timeout'})`);
  }

  const nLat = 180;
  const nLon = 180;
  const elevations = new Array(nLat * nLon);
  let seaCount = 0;
  let hasMissingLand = false;

  for (let i = 0; i < nLat; i++) {
    const lat = bbox.latMin + (i / (nLat - 1)) * (bbox.latMax - bbox.latMin);
    for (let j = 0; j < nLon; j++) {
      const lon = bbox.lonMin + (j / (nLon - 1)) * (bbox.lonMax - bbox.lonMin);
      let v = fine ? sampleGrid(fine, lat, lon) : NaN;
      if (!Number.isFinite(v) && coarse) {
        v = sampleGrid(coarse, lat, lon);
      }
      if (!Number.isFinite(v)) {
        elevations[i * nLon + j] = NaN;
        hasMissingLand = true;
      } else {
        const rounded = Math.round(v * 10) / 10;
        elevations[i * nLon + j] = rounded;
        if (rounded < 0) seaCount++;
      }
    }
  }

  if (hasMissingLand) {
    fillMissingLandElevation(elevations, nLat, nLon);
  }

  const scale = computeAutoScale(elevations);
  const reefs = detectShoals(elevations, nLat, nLon, bbox, 4);

  const ukhoWrecks = ukhoRes.status === 'fulfilled' ? ukhoRes.value : [];
  const heritageWrecks = heritageRes.status === 'fulfilled' ? heritageRes.value : [];
  const wikiWrecks = wikiRes.status === 'fulfilled' ? wikiRes.value : [];
  const osmData = osmRes.status === 'fulfilled' ? osmRes.value : { places: [], osmWrecks: [] };

  const wrecks = mergeAndEnrichWrecks([wikiWrecks, heritageWrecks, ukhoWrecks, osmData.osmWrecks], 52);

  const midLat = (bbox.latMin + bbox.latMax) / 2;
  const heightKm = Math.round((bbox.latMax - bbox.latMin) * 111.32);
  const widthKm = Math.round((bbox.lonMax - bbox.lonMin) * 111.32 * Math.cos((midLat * Math.PI) / 180));

  const attributions = [];
  if (fine) attributions.push('EMODnet DTM 2024 (~115 m)');
  if (coarse) attributions.push('GEBCO 2020 (~450 m)');
  if (heritageWrecks.length > 0) attributions.push('EMODnet Heritage (SHOM / Historic England)');
  if (ukhoWrecks.length > 0) attributions.push('UKHO Global Wrecks (OGL)');
  if (wikiWrecks.length > 0) attributions.push('Wikidata / Wikipedia');
  if (osmData.places.length > 0 || osmData.osmWrecks.length > 0) attributions.push('OpenStreetMap');

  const warnings = [];
  if (!fine) warnings.push('GEBCO-only (~450 m) outside European EMODnet coverage');
  if (seaCount < nLat * nLon * 0.04) warnings.push('Area is mostly land — pan toward a coast or strait for seabed relief');

  const bboxStr = `${bbox.lonMin.toFixed(5)},${bbox.latMin.toFixed(5)},${bbox.lonMax.toFixed(5)},${bbox.latMax.toFixed(5)}`;
  const satelliteUrl = browserMode
    ? `https://tiles.maps.eox.at/wms?service=WMS&request=GetMap&version=1.1.1&layers=s2cloudless-2023&bbox=${bboxStr}&srs=EPSG:4326&width=2048&height=2048&format=image/jpeg`
    : `/api/satellite?latMin=${bbox.latMin.toFixed(5)}&latMax=${bbox.latMax.toFixed(5)}&lonMin=${bbox.lonMin.toFixed(5)}&lonMax=${bbox.lonMax.toFixed(5)}`;

  const result = {
    meta: {
      name,
      isCustom: true,
      bbox,
      widthKm,
      heightKm,
      attributions,
      warnings,
      totalUkhoWrecks: ukhoWrecks.length,
      totalHeritageWrecks: heritageWrecks.length,
      totalWikiWrecks: wikiWrecks.length,
    },
    scale,
    bathymetry: {
      ...bbox,
      nLat,
      nLon,
      elevations,
    },
    wrecks,
    reefs,
    places: osmData.places,
    satelliteUrl,
  };

  if (regionCache.size >= CACHE_LIMIT) {
    const firstKey = regionCache.keys().next().value;
    regionCache.delete(firstKey);
  }
  regionCache.set(cacheKey, result);
  return result;
}
