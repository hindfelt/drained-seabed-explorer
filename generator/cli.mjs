import path from 'node:path';
import process from 'node:process';

import * as bathyEmodnet from './adapters/bathy-emodnet.mjs';
import * as bathyGebco from './adapters/bathy-gebco.mjs';
import * as imagery from './adapters/imagery-eox.mjs';
import * as places from './adapters/places-overpass.mjs';
import * as wrecks from './adapters/wrecks-emodnet.mjs';
import { parseBbox, validateSlug, validateName } from './lib/bbox-args.mjs';
import { assemblePack, validatePack } from './lib/pack.mjs';
import { updatePackIndex } from './lib/pack-index.mjs';

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

  const name = validateName(values.get('name'));
  const slug = validateSlug(values.get('slug'));
  const bbox = parseBbox(values.get('bbox'));
  return { bbox, name, slug };
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
