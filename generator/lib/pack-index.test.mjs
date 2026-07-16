import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updatePackIndex } from './pack-index.mjs';

async function readIndex(dir) {
  return JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
}

test('creates a fresh index with the first slug as default', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'packs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await updatePackIndex(dir, 'oresund');
  assert.deepEqual(await readIndex(dir), { default: 'oresund', packs: ['oresund'] });
});

test('adds slugs sorted and preserves the existing default', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'packs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await updatePackIndex(dir, 'oresund');
  await updatePackIndex(dir, 'bora-bora');
  assert.deepEqual(await readIndex(dir), { default: 'oresund', packs: ['bora-bora', 'oresund'] });
});

test('rejects a corrupt index instead of clobbering it', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'packs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'index.json'), '[]');
  await assert.rejects(() => updatePackIndex(dir, 'x'), /JSON object/);
});
