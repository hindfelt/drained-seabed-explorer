import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import * as bathyEmodnet from './adapters/bathy-emodnet.mjs';
import * as bathyGebco from './adapters/bathy-gebco.mjs';
import * as imagery from './adapters/imagery-eox.mjs';
import * as places from './adapters/places-overpass.mjs';
import * as wrecks from './adapters/wrecks-emodnet.mjs';
import { assemblePack, validatePack } from './lib/pack.mjs';

const USAGE = `Usage:
  npm run generate -- --bbox <lonMin,latMin,lonMax,latMax> --name <name> --slug <slug>

Example:
  npm run generate -- --bbox 12.44,55.82,12.94,56.10 --name "Öresund" --slug oresund`;

const adapters = {
  bathyGebco,
  bathyEmodnet,
  wrecks,
  places,
  imagery,
};

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return null;

  const values = new Map();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new Error(`unexpected argument: ${argument}`);
    }

    const equalsIndex = argument.indexOf('=');
    const key = argument.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    if (!['bbox', 'name', 'slug'].includes(key)) {
      throw new Error(`unknown option: --${key}`);
    }
    if (values.has(key)) throw new Error(`option specified more than once: --${key}`);

    const value = equalsIndex === -1 ? argv[++index] : argument.slice(equalsIndex + 1);
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    values.set(key, value);
  }

  for (const key of ['bbox', 'name', 'slug']) {
    if (!values.has(key)) throw new Error(`missing required option: --${key}`);
  }

  const name = values.get('name').trim();
  if (name.length === 0) throw new Error('--name must not be empty');

  const slug = values.get('slug');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('--slug must contain only lowercase letters, numbers, and single hyphens');
  }

  const bbox = parseBbox(values.get('bbox'));
  return { bbox, name, slug };
}

function parseBbox(value) {
  const parts = value.split(',');
  if (parts.length !== 4) {
    throw new Error('--bbox must be lonMin,latMin,lonMax,latMax');
  }

  const numbers = parts.map(Number);
  if (numbers.some((number) => !Number.isFinite(number))) {
    throw new Error('--bbox coordinates must be finite numbers');
  }

  const [lonMin, latMin, lonMax, latMax] = numbers;
  if (lonMin < -180 || lonMax > 180 || latMin < -90 || latMax > 90) {
    throw new Error('--bbox coordinates must be within WGS84 longitude/latitude ranges');
  }
  if (lonMin >= lonMax || latMin >= latMax) {
    throw new Error('--bbox minima must be less than maxima');
  }

  return { lonMin, latMin, lonMax, latMax };
}

async function updatePackIndex(packsDir, slug) {
  await mkdir(packsDir, { recursive: true });

  const indexPath = path.join(packsDir, 'index.json');
  let existing = {};
  try {
    existing = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`could not read existing pack index: ${error.message}`, { cause: error });
    }
  }
  if (existing === null || Array.isArray(existing) || typeof existing !== 'object') {
    throw new Error('could not read existing pack index: root must be a JSON object');
  }

  const existingPacks = Array.isArray(existing.packs)
    ? existing.packs.filter((entry) => typeof entry === 'string' && entry.length > 0)
    : [];
  const existingDefault = typeof existing.default === 'string' && existing.default.length > 0
    ? existing.default
    : null;
  const defaultSlug = existingDefault ?? existingPacks[0] ?? slug;
  const packs = [...new Set([...existingPacks, defaultSlug, slug])].sort();

  await writeFile(indexPath, `${JSON.stringify({ default: defaultSlug, packs }, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const packsDir = path.resolve(process.cwd(), 'public', 'packs');
  const outDir = path.join(packsDir, options.slug);
  const report = await assemblePack({ ...options, adapters, outDir });

  await validatePack(outDir);
  await updatePackIndex(packsDir, options.slug);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`Generation failed: ${error.message}\n\n${USAGE}\n`);
  process.exitCode = 1;
}
