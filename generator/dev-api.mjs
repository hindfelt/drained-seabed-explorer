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

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function endWith(res, statusCode, line) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.end(`${JSON.stringify(line)}\n`);
}

export async function handleGenerate(req, res, { assemble, updateIndex, cwd }) {
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

  if (busy) {
    endWith(res, 409, { error: 'a generation is already running' });
    return;
  }

  busy = true;
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
