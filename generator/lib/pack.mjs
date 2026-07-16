import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as bathyGebcoDefault from '../adapters/bathy-gebco.mjs';
import * as bathyEmodnetDefault from '../adapters/bathy-emodnet.mjs';
import * as wrecksDefault from '../adapters/wrecks-emodnet.mjs';
import * as placesDefault from '../adapters/places-overpass.mjs';
import * as imageryDefault from '../adapters/imagery-eox.mjs';
import { encodeBathy } from './bathy-codec.mjs';
import { mergeToPackGrid } from './grid.mjs';
import { buildMeta } from './meta.mjs';
import { withRetry } from './retry.mjs';
import { findShoals } from './shoals.mjs';

const REQUIRED_FILES = [
  'meta.json',
  'bathymetry.json',
  'bathymetry.bin',
  'satellite.jpg',
  'sites.json',
];

const GEBCO_ONLY_WARNING = 'bathymetry is GEBCO-only (~450 m) — small features will be smooth';

export async function assemblePack({
  bbox,
  name,
  slug,
  adapters,
  fetchImpl,
  outDir = path.join('public', 'packs', slug ?? ''),
  now,
  onProgress = () => {},
} = {}) {
  assertBBox(bbox, 'bbox');
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('name must be a non-empty string');
  }
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new TypeError('slug must be a non-empty string');
  }
  if (typeof outDir !== 'string' || outDir === '') {
    throw new TypeError('outDir must be a non-empty string');
  }

  const selected = resolveAdapters(adapters);
  assertAdapterMethod(selected.bathyGebco, 'fetchGrid', 'bathyGebco');
  assertAdapterMethod(selected.wrecks, 'fetchWrecks', 'wrecks');
  assertAdapterMethod(selected.places, 'fetchPlaces', 'places');
  assertAdapterMethod(selected.imagery, 'fetchImagery', 'imagery');

  const warnings = [];
  const regionalCoverage = selected.bathyEmodnet != null
    && typeof selected.bathyEmodnet.fetchGrid === 'function'
    && (typeof selected.bathyEmodnet.covers !== 'function' || selected.bathyEmodnet.covers(bbox));

  if (!regionalCoverage) warnings.push(GEBCO_ONLY_WARNING);

  const stage = (label) => (value) => { onProgress(label); return value; };
  const coarsePromise = selected.bathyGebco.fetchGrid(bbox, { fetchImpl })
    .then(stage('bathymetry'));
  const finePromise = regionalCoverage
    ? selected.bathyEmodnet.fetchGrid(bbox, { fetchImpl })
    : Promise.resolve(null);
  const wrecksPromise = fetchOptionalSites(
    () => selected.wrecks.fetchWrecks(bbox, { fetchImpl }),
    'wrecks',
    warnings,
  ).then(stage('wrecks'));
  // The public Overpass instance is flaky (406/504 bursts) — retry with
  // fixed backoff before degrading to a warning.
  const placesPromise = fetchOptionalSites(
    () => withRetry(() => selected.places.fetchPlaces(bbox, { fetchImpl })),
    'places',
    warnings,
  ).then(stage('places'));
  // Imagery is intentionally required for P0. The adapter already tries its
  // fallback source, so a total failure rejects assembly rather than creating
  // a pack that validatePack would have to treat specially.
  const imageryPromise = selected.imagery.fetchImagery(bbox, { fetchImpl })
    .then(stage('imagery'));

  const [coarse, fine, wreckResult, placeResult, imagery] = await Promise.all([
    coarsePromise,
    finePromise,
    wrecksPromise,
    placesPromise,
    imageryPromise,
  ]);

  onProgress('assembling');
  const packGrid = mergeToPackGrid({ fine, coarse, bbox });

  // The Int16-decimeter codec can only carry ±3276.7 m. Clamp BEFORE stats
  // and encoding so meta.json always describes exactly what the binary
  // holds — and say so, instead of silently corrupting abyssal regions.
  let deepestClipped = 0;
  for (let i = 0; i < packGrid.elevations.length; i++) {
    const m = packGrid.elevations[i];
    if (m < -3276.7) {
      deepestClipped = Math.min(deepestClipped, m);
      packGrid.elevations[i] = -3276.7;
    } else if (m > 3276.7) {
      packGrid.elevations[i] = 3276.7;
    }
  }
  if (deepestClipped < 0) {
    warnings.push(
      `depths below 3276.7 m clipped by pack encoding (deepest was ${Math.round(-deepestClipped)} m)`
    );
  }
  const wrecks = wreckResult.records;
  const places = placeResult.records;
  const shoals = findShoals(packGrid, bbox);

  if (wrecks.length === 0) warnings.push('no charted wrecks in this area');
  if (Number.isFinite(wrecks.dropped) && wrecks.dropped > 0) {
    warnings.push(`wrecks capped — ${wrecks.dropped} records dropped`);
  }
  if (isImageryFallback(imagery)) {
    warnings.push('imagery fallback used');
  }

  const sources = [selected.bathyGebco.meta];
  if (regionalCoverage) sources.push(selected.bathyEmodnet.meta);
  if (wreckResult.succeeded) sources.push(selected.wrecks.meta);
  if (placeResult.succeeded) sources.push(selected.places.meta);
  // Credit the imagery source that actually served the pack (EOX or the
  // Esri fallback), not the adapter's combined-sources blurb.
  sources.push({
    ...selected.imagery.meta,
    attribution: typeof imagery.attribution === 'string'
      ? imagery.attribution
      : selected.imagery.meta?.attribution,
  });

  const meta = buildMeta({ name, slug, bbox, packGrid, sources, now });
  // Persist warnings into the pack so the engine can surface data-quality
  // caveats (e.g. GEBCO-only bathymetry) in the credits line.
  if (warnings.length > 0) meta.warnings = warnings;
  const bathymetry = {
    nLat: packGrid.nLat,
    nLon: packGrid.nLon,
    bbox,
    encoding: 'int16-decimeters-le',
    nodata: -32768,
  };
  const sites = { wrecks, places, shoals };

  // Publish transactionally: write + validate in a staging directory, then
  // swap it in. A failed regeneration must never leave an already-indexed
  // pack half-replaced.
  const stagingDir = `${outDir}.staging`;
  const previousDir = `${outDir}.previous`;
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  try {
    await Promise.all([
      writeJson(path.join(stagingDir, 'meta.json'), meta),
      writeJson(path.join(stagingDir, 'bathymetry.json'), bathymetry),
      writeFile(path.join(stagingDir, 'bathymetry.bin'), encodeBathy(packGrid.elevations)),
      writeFile(path.join(stagingDir, 'satellite.jpg'), imagery.jpeg),
      writeJson(path.join(stagingDir, 'sites.json'), sites),
    ]);

    onProgress('validating');
    await validatePack(stagingDir);

    await rm(previousDir, { recursive: true, force: true });
    let hadPrevious = true;
    try {
      await rename(outDir, previousDir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hadPrevious = false;
    }
    try {
      await rename(stagingDir, outDir);
    } catch (error) {
      if (hadPrevious) await rename(previousDir, outDir); // roll back
      throw error;
    }
    if (hadPrevious) await rm(previousDir, { recursive: true, force: true });
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }

  return {
    wreckCount: wrecks.length,
    placeCount: places.length,
    shoalCount: shoals.length,
    minMeters: meta.stats.minMeters,
    maxMeters: meta.stats.maxMeters,
    warnings,
  };
}

export async function validatePack(dir) {
  if (typeof dir !== 'string' || dir === '') {
    throw new TypeError('pack directory must be a non-empty string');
  }

  for (const file of REQUIRED_FILES) {
    try {
      await access(path.join(dir, file));
    } catch {
      throw new Error(`missing file: ${file}`);
    }
  }

  const [meta, bathymetry, sites, binaryStat, imageryStat] = await Promise.all([
    readJson(path.join(dir, 'meta.json'), 'meta.json'),
    readJson(path.join(dir, 'bathymetry.json'), 'bathymetry.json'),
    readJson(path.join(dir, 'sites.json'), 'sites.json'),
    stat(path.join(dir, 'bathymetry.bin')),
    stat(path.join(dir, 'satellite.jpg')),
  ]);

  validateMeta(meta);
  validateBathymetryHeader(bathymetry);
  validateSites(sites, bathymetry.bbox);

  const expectedLength = bathymetry.nLat * bathymetry.nLon * 2;
  if (binaryStat.size !== expectedLength) {
    throw new Error(`bin length mismatch: expected ${expectedLength} bytes, found ${binaryStat.size}`);
  }
  if (imageryStat.size === 0) throw new Error('satellite.jpg is empty');

  if (meta.grid.nLat !== bathymetry.nLat || meta.grid.nLon !== bathymetry.nLon) {
    throw new Error('meta.json grid does not match bathymetry.json dimensions');
  }
  for (const key of ['latMin', 'latMax', 'lonMin', 'lonMax']) {
    if (meta.bbox[key] !== bathymetry.bbox[key]) {
      throw new Error(`meta.json bbox.${key} does not match bathymetry.json`);
    }
  }

  return true;
}

function resolveAdapters(adapters = {}) {
  return {
    bathyGebco: adapters.bathyGebco
      ?? adapters.gebco
      ?? adapters.global
      ?? adapters.coarse
      ?? bathyGebcoDefault,
    bathyEmodnet: adapters.bathyEmodnet
      ?? adapters.emodnet
      ?? adapters.regional
      ?? adapters.fine
      ?? bathyEmodnetDefault,
    wrecks: adapters.wrecks ?? wrecksDefault,
    places: adapters.places ?? placesDefault,
    imagery: adapters.imagery ?? imageryDefault,
  };
}

function assertAdapterMethod(adapter, method, name) {
  if (adapter == null || typeof adapter[method] !== 'function') {
    throw new TypeError(`${name} adapter must implement ${method}()`);
  }
}

async function fetchOptionalSites(fetchRecords, label, warnings) {
  try {
    const records = await fetchRecords();
    if (!Array.isArray(records)) throw new TypeError(`${label} adapter did not return an array`);
    return { records, succeeded: true };
  } catch (error) {
    warnings.push(`${label} unavailable: ${errorMessage(error)}`);
    return { records: [], succeeded: false };
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isImageryFallback(imagery) {
  return typeof imagery?.source === 'string' && /\besri\b|fallback/i.test(imagery.source);
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(file, label) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${label}: ${errorMessage(error)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in ${label}: ${errorMessage(error)}`);
  }
}

function assertBBox(bbox, label) {
  if (bbox == null || typeof bbox !== 'object' || Array.isArray(bbox)) {
    throw new TypeError(`${label} must be an object`);
  }
  for (const key of ['latMin', 'latMax', 'lonMin', 'lonMax']) {
    if (!Number.isFinite(bbox[key])) {
      throw new TypeError(`${label}.${key} must be a finite number`);
    }
  }
  if (bbox.latMin >= bbox.latMax) throw new TypeError(`${label}.latMin must be less than latMax`);
  if (bbox.lonMin >= bbox.lonMax) throw new TypeError(`${label}.lonMin must be less than lonMax`);
  if (bbox.latMin < -90 || bbox.latMax > 90) {
    throw new TypeError(`${label} latitude must be between -90 and 90`);
  }
  if (bbox.lonMin < -180 || bbox.lonMax > 180) {
    throw new TypeError(`${label} longitude must be between -180 and 180`);
  }
}

function validateBathymetryHeader(header) {
  if (header == null || typeof header !== 'object' || Array.isArray(header)) {
    throw new Error('bathymetry.json must contain an object');
  }
  for (const key of ['nLat', 'nLon']) {
    if (!Number.isInteger(header[key]) || header[key] <= 0) {
      throw new Error(`bathymetry.json ${key} must be a positive integer`);
    }
  }
  try {
    assertBBox(header.bbox, 'bathymetry.json bbox');
  } catch (error) {
    throw new Error(errorMessage(error));
  }
  if (header.encoding !== 'int16-decimeters-le') {
    throw new Error('bathymetry.json encoding must be "int16-decimeters-le"');
  }
  if (header.nodata !== -32768) {
    throw new Error('bathymetry.json nodata must be -32768');
  }
}

function validateMeta(meta) {
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('meta.json must contain an object');
  }
  if (typeof meta.name !== 'string' || meta.name === '') throw new Error('meta.json name is missing');
  if (typeof meta.slug !== 'string' || meta.slug === '') throw new Error('meta.json slug is missing');

  const numericPaths = [
    'bbox.latMin', 'bbox.latMax', 'bbox.lonMin', 'bbox.lonMax',
    'grid.nLat', 'grid.nLon',
    'scale.seaFactor', 'scale.landFactor', 'scale.landCeiling',
    'colorBands.shelfEdge', 'colorBands.midEdge', 'colorBands.trenchStart',
    'colorBands.trenchFull', 'colorBands.saltMin', 'colorBands.saltMax',
    'stats.minMeters', 'stats.maxMeters',
    'stats.seaPercentiles.p25', 'stats.seaPercentiles.p50', 'stats.seaPercentiles.p75',
  ];
  for (const numericPath of numericPaths) {
    if (!Number.isFinite(valueAtPath(meta, numericPath))) {
      throw new Error(`meta.json has non-finite number at ${numericPath}`);
    }
  }

  try {
    assertBBox(meta.bbox, 'meta.json bbox');
  } catch (error) {
    throw new Error(errorMessage(error));
  }
  if (!Number.isInteger(meta.grid.nLat) || !Number.isInteger(meta.grid.nLon)) {
    throw new Error('meta.json grid dimensions must be integers');
  }
  if (!Array.isArray(meta.attributions)) throw new Error('meta.json attributions must be an array');
  if (typeof meta.generatedAt !== 'string') throw new Error('meta.json generatedAt must be a string');
}

function valueAtPath(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], object);
}

function validateSites(sites, bbox) {
  if (sites == null || typeof sites !== 'object' || Array.isArray(sites)) {
    throw new Error('sites.json must contain an object');
  }
  for (const group of ['wrecks', 'places', 'shoals']) {
    if (!Array.isArray(sites[group])) throw new Error(`sites.json ${group} must be an array`);
    sites[group].forEach((site, index) => validateSite(site, group, index, bbox));
  }
}

function validateSite(site, group, index, bbox) {
  if (site == null || typeof site !== 'object' || Array.isArray(site)) {
    throw new Error(`sites.json ${group}[${index}] must be an object`);
  }
  if (!Array.isArray(site.latLon) || site.latLon.length !== 2) {
    throw new Error(`sites.json ${group}[${index}].latLon must be [lat, lon]`);
  }
  const [lat, lon] = site.latLon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`sites.json ${group}[${index}].latLon must contain finite numbers`);
  }
  if (lat < bbox.latMin || lat > bbox.latMax || lon < bbox.lonMin || lon > bbox.lonMax) {
    const identifier = typeof site.id === 'string' ? ` (${site.id})` : '';
    throw new Error(`site outside bbox: ${group}[${index}]${identifier}`);
  }
}
