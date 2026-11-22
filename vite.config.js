import { defineConfig } from 'vite';
import {
  buildLiveRegion,
  fetchSatelliteProxy,
  fetchGeocodeProxy,
} from './src/server/regionApi.mjs';

function seabedApiMiddleware() {
  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith('/api/')) return next();

    const parsed = new URL(req.url, 'http://localhost');

    try {
      if (parsed.pathname === '/api/region') {
        const latMin = parsed.searchParams.get('latMin');
        const latMax = parsed.searchParams.get('latMax');
        const lonMin = parsed.searchParams.get('lonMin');
        const lonMax = parsed.searchParams.get('lonMax');
        const name = parsed.searchParams.get('name') || 'Custom Region';

        const payload = await buildLiveRegion({ latMin, latMax, lonMin, lonMax, name });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.end(JSON.stringify(payload));
        return;
      }

      if (parsed.pathname === '/api/satellite') {
        const latMin = parsed.searchParams.get('latMin');
        const latMax = parsed.searchParams.get('latMax');
        const lonMin = parsed.searchParams.get('lonMin');
        const lonMax = parsed.searchParams.get('lonMax');

        const img = await fetchSatelliteProxy({ latMin, latMax, lonMin, lonMax });
        if (!img) {
          res.statusCode = 404;
          res.end('Satellite imagery unavailable');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', img.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.end(img.buffer);
        return;
      }

      if (parsed.pathname === '/api/geocode') {
        const q = (parsed.searchParams.get('q') || '').trim();
        if (!q) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end('[]');
          return;
        }
        const results = await fetchGeocodeProxy(q);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(results));
        return;
      }

      next();
    } catch (err) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: err?.message || 'Upstream marine data request failed' }));
    }
  };
}

export default defineConfig({
  plugins: [
    {
      name: 'seabed-live-api',
      configureServer(server) {
        server.middlewares.use(seabedApiMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(seabedApiMiddleware());
      },
    },
  ],
});
