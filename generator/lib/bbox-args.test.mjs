import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBbox, validateSlug, validateName } from './bbox-args.mjs';

test('parses a valid bbox string', () => {
  assert.deepEqual(parseBbox('12.44,55.82,12.94,56.10'),
    { lonMin: 12.44, latMin: 55.82, lonMax: 12.94, latMax: 56.10 });
});

test('rejects malformed bboxes with readable messages', () => {
  assert.throws(() => parseBbox('1,2,3'), /lonMin,latMin,lonMax,latMax/);
  assert.throws(() => parseBbox('a,b,c,d'), /finite/);
  assert.throws(() => parseBbox('-181,0,0,1'), /WGS84/);
  assert.throws(() => parseBbox('1,1,1,2'), /minima/);
});

test('rejects resource-exhausting and degenerate spans', () => {
  assert.throws(() => parseBbox('-180,-90,180,90'), /at most 2°/);
  assert.throws(() => parseBbox('0,0,2.5,1'), /at most 2°/);
  assert.throws(() => parseBbox('0,0,0.005,1'), /at least 0.01°/);
  assert.deepEqual(parseBbox('0,0,1.5,1.5'), { lonMin: 0, latMin: 0, lonMax: 1.5, latMax: 1.5 });
});

test('validates slugs and names', () => {
  assert.equal(validateSlug('bora-bora'), 'bora-bora');
  assert.throws(() => validateSlug('Bora Bora'), /lowercase/);
  assert.throws(() => validateSlug('-x'), /lowercase/);
  assert.equal(validateName('  Öresund '), 'Öresund');
  assert.throws(() => validateName('  '), /empty/);
});
