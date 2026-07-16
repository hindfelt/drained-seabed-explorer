import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { handleGenerate, __resetBusyForTests } from './dev-api.mjs';

function makeReq(body, headers = {}) {
  const req = new PassThrough();
  req.method = 'POST';
  req.headers = {
    host: '127.0.0.1:5173',
    'content-type': 'application/json',
    ...headers,
  };
  req.end(typeof body === 'string' ? body : JSON.stringify(body));
  return req;
}

function makeRes() {
  const chunks = [];
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    write(c) { chunks.push(String(c)); },
    end(c) { if (c) chunks.push(String(c)); this.ended = true; },
    lines() { return chunks.join('').trim().split('\n').map((l) => JSON.parse(l)); },
  };
}

const goodBody = { bbox: { lonMin: 1, latMin: 1, lonMax: 2, latMax: 2 }, name: 'X', slug: 'x' };

test('streams stages then a final report', async () => {
  __resetBusyForTests();
  const res = makeRes();
  await handleGenerate(makeReq(goodBody), res, {
    assemble: async ({ onProgress }) => { onProgress('bathymetry'); onProgress('validating'); return { wreckCount: 1, warnings: [] }; },
    updateIndex: async () => {},
    cwd: '/tmp',
  });
  const lines = res.lines();
  assert.deepEqual(lines[0], { stage: 'bathymetry' });
  assert.equal(lines.at(-1).done, true);
  assert.equal(lines.at(-1).report.wreckCount, 1);
});

test('rejects invalid slugs with 400 before generating', async () => {
  __resetBusyForTests();
  const res = makeRes();
  await handleGenerate(makeReq({ ...goodBody, slug: 'Bad Slug' }), res, {
    assemble: async () => { throw new Error('must not be called'); },
    updateIndex: async () => {},
    cwd: '/tmp',
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.lines()[0].error, /lowercase/);
});

test('streams an error line when generation throws', async () => {
  __resetBusyForTests();
  const res = makeRes();
  await handleGenerate(makeReq(goodBody), res, {
    assemble: async () => { throw new Error('ERDDAP down'); },
    updateIndex: async () => {},
    cwd: '/tmp',
  });
  assert.match(res.lines().at(-1).error, /ERDDAP down/);
});

test('403s non-loopback hosts, cross-origin requests, and non-JSON content types', async () => {
  __resetBusyForTests();
  const noop = { assemble: async () => { throw new Error('must not be called'); }, updateIndex: async () => {}, cwd: '/tmp' };

  const rebound = makeRes();
  await handleGenerate(makeReq(goodBody, { host: 'evil.example.com' }), rebound, noop);
  assert.equal(rebound.statusCode, 403);
  assert.match(rebound.lines()[0].error, /rebinding/);

  const crossOrigin = makeRes();
  await handleGenerate(makeReq(goodBody, { origin: 'https://evil.example.com' }), crossOrigin, noop);
  assert.equal(crossOrigin.statusCode, 403);
  assert.match(crossOrigin.lines()[0].error, /cross-origin/);

  const textPlain = makeRes();
  await handleGenerate(makeReq(goodBody, { 'content-type': 'text/plain' }), textPlain, noop);
  assert.equal(textPlain.statusCode, 403);
  assert.match(textPlain.lines()[0].error, /application\/json/);

  const sameOrigin = makeRes();
  await handleGenerate(makeReq(goodBody, { origin: 'http://localhost:5173' }), sameOrigin, {
    assemble: async () => ({ warnings: [] }), updateIndex: async () => {}, cwd: '/tmp',
  });
  assert.equal(sameOrigin.statusCode, 200);
});

test('rejects oversized bodies before parsing', async () => {
  __resetBusyForTests();
  const res = makeRes();
  await handleGenerate(makeReq(`{"pad":"${'x'.repeat(70 * 1024)}"}`), res, {
    assemble: async () => { throw new Error('must not be called'); },
    updateIndex: async () => {},
    cwd: '/tmp',
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.lines()[0].error, /too large/);
});

test('409s when a generation is already in flight', async () => {
  __resetBusyForTests();
  let release;
  const gate = new Promise((r) => { release = r; });
  const res1 = makeRes();
  const first = handleGenerate(makeReq(goodBody), res1, {
    assemble: async () => { await gate; return { warnings: [] }; },
    updateIndex: async () => {},
    cwd: '/tmp',
  });
  const res2 = makeRes();
  await handleGenerate(makeReq(goodBody), res2, {
    assemble: async () => ({ warnings: [] }),
    updateIndex: async () => {},
    cwd: '/tmp',
  });
  assert.equal(res2.statusCode, 409);
  release();
  await first;
  assert.equal(res1.lines().at(-1).done, true);
});
