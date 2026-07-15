import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as bathyGebco from '../adapters/bathy-gebco.mjs';
import * as bathyEmodnet from '../adapters/bathy-emodnet.mjs';
import * as wrecks from '../adapters/wrecks-emodnet.mjs';
import * as places from '../adapters/places-overpass.mjs';
import * as imagery from '../adapters/imagery-eox.mjs';
import { assemblePack, validatePack } from './pack.mjs';

const bbox = { lonMin: 12.44, latMin: 55.82, lonMax: 12.94, latMax: 56.10 };
const gebcoFixture = JSON.parse(
  readFileSync(new URL('../fixtures/gebco-oresund-mini.json', import.meta.url), 'utf8'),
);
const wrecksFixture = JSON.parse(
  readFileSync(new URL('../fixtures/wwshipwrecks-oresund.json', import.meta.url), 'utf8'),
);
const placesFixture = JSON.parse(
  readFileSync(new URL('../fixtures/overpass-oresund.json', import.meta.url), 'utf8'),
);
const imageryFixture = readFileSync(new URL('../fixtures/tiny.jpg', import.meta.url));

function fixtureFetch(url, options = {}) {
  const href = String(url);

  if (href.includes('/GEBCO_2020.json?')) {
    return Promise.resolve({ ok: true, json: async () => gebcoFixture });
  }

  if (href.includes('typeNames=emodnet:wwshipwrecks')) {
    return Promise.resolve({ ok: true, json: async () => wrecksFixture });
  }

  if (href === 'https://overpass-api.de/api/interpreter') {
    assert.equal(options.method, 'POST');
    return Promise.resolve({ ok: true, json: async () => placesFixture });
  }

  if (href.startsWith('https://tiles.maps.eox.at/wms?')) {
    return Promise.resolve({ ok: true, arrayBuffer: async () => imageryFixture });
  }

  return Promise.reject(new Error(`Unexpected fixture request: ${href}`));
}

test('assembles and validates a fixture-backed GEBCO-only pack', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'drained-seabed-pack-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  const report = await assemblePack({
    bbox,
    name: 'Öresund',
    slug: 'oresund',
    outDir,
    now: '2026-07-15T12:00:00.000Z',
    fetchImpl: fixtureFetch,
    adapters: {
      bathyGebco,
      bathyEmodnet: { ...bathyEmodnet, covers: () => false },
      wrecks,
      places,
      imagery,
    },
  });

  assert.deepEqual(await readdir(outDir).then((files) => files.sort()), [
    'bathymetry.bin',
    'bathymetry.json',
    'meta.json',
    'satellite.jpg',
    'sites.json',
  ]);
  await validatePack(outDir);

  assert.equal(report.wreckCount, 39);
  assert.equal(report.placeCount, 12);
  assert.equal(report.shoalCount, 1);
  assert.ok(Number.isFinite(report.minMeters));
  assert.ok(Number.isFinite(report.maxMeters));
  assert.ok(report.warnings.includes(
    'bathymetry is GEBCO-only (~450 m) — small features will be smooth',
  ));

  const writtenMeta = JSON.parse(await readFile(join(outDir, 'meta.json'), 'utf8'));
  assert.ok(writtenMeta.warnings.includes(
    'bathymetry is GEBCO-only (~450 m) — small features will be smooth',
  ), 'warnings persist into meta.json for the engine credits line');

  const satellitePath = join(outDir, 'satellite.jpg');
  await rm(satellitePath);
  await assert.rejects(async () => validatePack(outDir), /missing file: satellite\.jpg/);
  await writeFile(satellitePath, imageryFixture);

  const sitesPath = join(outDir, 'sites.json');
  const validSitesText = await readFile(sitesPath, 'utf8');
  const invalidSites = JSON.parse(validSitesText);
  invalidSites.wrecks[0].latLon[0] = bbox.latMax + 1;
  await writeFile(sitesPath, JSON.stringify(invalidSites));
  await assert.rejects(async () => validatePack(outDir), /site outside bbox: wrecks\[0\]/);
  await writeFile(sitesPath, validSitesText);

  const metaPath = join(outDir, 'meta.json');
  const validMetaText = await readFile(metaPath, 'utf8');
  const invalidMeta = JSON.parse(validMetaText);
  invalidMeta.stats.minMeters = null;
  await writeFile(metaPath, JSON.stringify(invalidMeta));
  await assert.rejects(
    async () => validatePack(outDir),
    /meta\.json has non-finite number at stats\.minMeters/,
  );
  await writeFile(metaPath, validMetaText);

  const binPath = join(outDir, 'bathymetry.bin');
  const binStat = await stat(binPath);
  await truncate(binPath, binStat.size - 2);
  await assert.rejects(async () => validatePack(outDir), /bin length/);
});
