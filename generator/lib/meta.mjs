function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Uses the common R-7/NumPy-style linear interpolation method: sort ascending,
// locate (n - 1) * q, then interpolate between the adjacent values.
function percentile(sortedValues, q) {
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (sortedValues.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;
  return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction;
}

function dateOnly(now) {
  const value = now ?? new Date().toISOString();
  if (typeof value !== 'string') throw new TypeError('now must be an ISO date string');
  return value.slice(0, 10);
}

export function buildMeta({ name, slug, bbox, packGrid, sources = [], now } = {}) {
  let minMeters = Infinity;
  let maxMeters = -Infinity;
  const seaElevations = [];
  for (const elevation of packGrid.elevations) {
    if (!Number.isFinite(elevation)) continue;
    minMeters = Math.min(minMeters, elevation);
    maxMeters = Math.max(maxMeters, elevation);
    if (elevation < 0) seaElevations.push(elevation);
  }

  if (minMeters === Infinity) {
    throw new Error('Cannot build metadata from a grid with no finite elevations');
  }

  if (seaElevations.length === 0) {
    throw new Error('Cannot derive sea color bands from a grid with no sea elevations');
  }
  seaElevations.sort((a, b) => a - b);

  const p25 = percentile(seaElevations, 0.25);
  const p50 = percentile(seaElevations, 0.5);
  const p75 = percentile(seaElevations, 0.75);

  const seaFactor = Math.min(3.5, 90 / Math.max(10, Math.abs(minMeters)));
  const landFactor = seaFactor / 2;
  const shelfEdge = clamp(p50 * seaFactor, -30, -12);
  const trenchStart = Math.min(p75 * seaFactor * 1.4, -45);

  // Thirty percent of the shelf-to-trench interval gives -31.9 for the
  // hand-tuned -22/-55 baseline, keeping this transition shelf-weighted.
  const midEdge = shelfEdge + (trenchStart - shelfEdge) * 0.3;
  // Preserve a 25-world-unit full-trench transition from the baseline.
  const trenchFull = trenchStart - 25;

  const saltEndpointA = p25 * seaFactor;
  const saltEndpointB = (p25 / 3) * seaFactor;
  const saltMin = Math.min(saltEndpointA, saltEndpointB);
  const saltMax = Math.max(saltEndpointA, saltEndpointB);

  // Land height is the observed maximum under land exaggeration. A 10-unit
  // floor avoids a degenerate tanh ceiling; 120 limits extreme terrain packs.
  // For Öresund: 38.9 * 0.9 = 35.01, close to the hand-tuned 33.5 baseline.
  const landCeiling = clamp(maxMeters * landFactor, 10, 120);

  const seenAttributions = new Set();
  const attributions = [];
  for (const source of sources) {
    const attribution = source?.attribution;
    if (typeof attribution === 'string' && !seenAttributions.has(attribution)) {
      seenAttributions.add(attribution);
      attributions.push(attribution);
    }
  }

  return {
    name,
    slug,
    bbox,
    grid: { nLat: packGrid.nLat, nLon: packGrid.nLon },
    scale: { seaFactor, landFactor, landCeiling },
    colorBands: {
      shelfEdge,
      midEdge,
      trenchStart,
      trenchFull,
      saltMin,
      saltMax,
    },
    stats: {
      minMeters,
      maxMeters,
      seaPercentiles: { p25, p50, p75 },
    },
    attributions,
    generatedAt: dateOnly(now),
  };
}
