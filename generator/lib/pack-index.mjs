import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Maintains public/packs/index.json — shared by the CLI and the dev API so
// both entry points keep identical default-preservation semantics.
export async function updatePackIndex(packsDir, slug) {
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
