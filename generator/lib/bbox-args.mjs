// Shared user-input validation for region generation — used by both the CLI
// (generator/cli.mjs) and the dev API (generator/dev-api.mjs) so the two
// entry points reject bad input with identical messages.

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
