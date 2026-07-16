// Dev-only generation endpoint for the region picker page.
//
// Registered via `configureServer`, so it exists ONLY under `vite dev` —
// production builds contain no trace of it. The picker POSTs
// { bbox, name, slug } and receives NDJSON progress lines:
//   {"stage":"bathymetry"} ... {"done":true,"report":{...}} | {"error":"..."}

import path from 'node:path';
import { parseBbox, validateSlug, validateName } from './lib/bbox-args.mjs';
import { updatePackIndex } from './lib/pack-index.mjs';

// One generation at a time — the upstream open-data APIs are rate-limited
// and two concurrent runs would interleave index.json writes.
let busy = false;
export function __resetBusyForTests() { busy = false; }

const MAX_BODY_BYTES = 64 * 1024;

// Even a dev-only local endpoint has a browser-facing attack surface:
// text/plain "simple requests" dodge CORS preflight, and DNS rebinding
// dodges same-origin entirely. Require JSON content type, a loopback Host,
// and (when present) a loopback Origin before touching the body.
const LOOPBACK_HOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(:\d+)?$/i;

function requestRejection(req) {
  const host = String(req.headers?.host ?? '');
  if (!LOOPBACK_HOST_PATTERN.test(host)) {
    return `blocked non-loopback host "${host}" (DNS rebinding guard)`;
  }
  const origin = req.headers?.origin;
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      return `blocked malformed origin "${origin}"`;
    }
    if (!LOOPBACK_HOST_PATTERN.test(originHost)) {
      return `blocked cross-origin request from "${origin}"`;
    }
  }
  const contentType = String(req.headers?.['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return 'content type must be application/json';
  }
  return null;
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function endWith(res, statusCode, line) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.end(`${JSON.stringify(line)}\n`);
}

export async function handleGenerate(req, res, { assemble, updateIndex, cwd }) {
  const rejection = requestRejection(req);
  if (rejection) {
    endWith(res, 403, { error: rejection });
    return;
  }

  if (busy) {
    endWith(res, 409, { error: 'a generation is already running' });
    return;
  }
  // Take the lock BEFORE the awaited body read — otherwise a second request
  // could pass the check while the first is still buffering.
  busy = true;
  try {
    let options;
    try {
      const body = await readJsonBody(req);
      options = {
        bbox: parseBbox([body.bbox?.lonMin, body.bbox?.latMin, body.bbox?.lonMax, body.bbox?.latMax].join(',')),
        name: validateName(body.name),
        slug: validateSlug(body.slug),
      };
    } catch (error) {
      endWith(res, 400, { error: error.message });
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-ndjson');
    try {
      const packsDir = path.resolve(cwd, 'public', 'packs');
      const outDir = path.join(packsDir, options.slug);
      const report = await assemble({
        ...options,
        outDir,
        onProgress: (stage) => res.write(`${JSON.stringify({ stage })}\n`),
      });
      await updateIndex(packsDir, options.slug);
      res.end(`${JSON.stringify({ done: true, report })}\n`);
    } catch (error) {
      res.end(`${JSON.stringify({ error: error.message })}\n`);
    }
  } finally {
    busy = false;
  }
}

export function devGenerateApi() {
  return {
    name: 'dev-generate-api',
    async configureServer(server) {
      const { assemblePack } = await import('./lib/pack.mjs');
      server.middlewares.use('/api/generate', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        handleGenerate(req, res, {
          assemble: assemblePack,
          updateIndex: updatePackIndex,
          cwd: server.config.root,
        });
      });
    },
  };
}
