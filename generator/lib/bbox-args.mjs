// Shared user-input validation for region generation — used by both the CLI
// (generator/cli.mjs) and the dev API (generator/dev-api.mjs) so the two
// entry points reject bad input with identical messages.

// Span limits: the engine renders a fixed 1200×1200 world (sweet spot
// ≈0.15°–1.0°), and unbounded rectangles would turn into unbounded ERDDAP
// downloads — a whole-world request is an accident or an attack either way.
const MAX_SPAN_DEGREES = 2;
const MIN_SPAN_DEGREES = 0.01;

export function parseBbox(value) {
  const parts = String(value).split(',');
  if (parts.length !== 4) throw new Error('bbox must be lonMin,latMin,lonMax,latMax');
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) throw new Error('bbox coordinates must be finite numbers');
  const [lonMin, latMin, lonMax, latMax] = numbers;
  if (lonMin < -180 || lonMax > 180 || latMin < -90 || latMax > 90) {
    throw new Error('bbox coordinates must be within WGS84 longitude/latitude ranges');
  }
  if (lonMin >= lonMax || latMin >= latMax) throw new Error('bbox minima must be less than maxima');
  if (lonMax - lonMin > MAX_SPAN_DEGREES || latMax - latMin > MAX_SPAN_DEGREES) {
    throw new Error(`bbox span must be at most ${MAX_SPAN_DEGREES}° per axis`);
  }
  if (lonMax - lonMin < MIN_SPAN_DEGREES || latMax - latMin < MIN_SPAN_DEGREES) {
    throw new Error(`bbox span must be at least ${MIN_SPAN_DEGREES}° per axis`);
  }
  return { lonMin, latMin, lonMax, latMax };
}

export function validateSlug(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug ?? ''))) {
    throw new Error('slug must contain only lowercase letters, numbers, and single hyphens');
  }
  return slug;
}

export function validateName(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length === 0) throw new Error('name must not be empty');
  return trimmed;
}
