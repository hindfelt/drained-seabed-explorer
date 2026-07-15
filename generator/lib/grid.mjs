function bracket(axis, value) {
  const last = axis.length - 1;
  if (last < 0) return null;
  if (last === 0) return { lower: 0, upper: 0, t: 0 };

  if (value <= axis[0]) return { lower: 0, upper: 1, t: 0 };
  if (value >= axis[last]) return { lower: last - 1, upper: last, t: 1 };

  let lower = 0;
  let upper = last;
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (axis[middle] <= value) lower = middle;
    else upper = middle;
  }

  return {
    lower,
    upper,
    t: (value - axis[lower]) / (axis[upper] - axis[lower]),
  };
}

export function sampleGrid(grid, lat, lon) {
  const latBracket = bracket(grid.lats, lat);
  const lonBracket = bracket(grid.lons, lon);
  if (!latBracket || !lonBracket) return NaN;

  const { lower: lat0, upper: lat1, t: latT } = latBracket;
  const { lower: lon0, upper: lon1, t: lonT } = lonBracket;
  const nLon = grid.lons.length;
  const corners = [
    { lat: grid.lats[lat0], lon: grid.lons[lon0], value: grid.elevations[lat0 * nLon + lon0] },
    { lat: grid.lats[lat0], lon: grid.lons[lon1], value: grid.elevations[lat0 * nLon + lon1] },
    { lat: grid.lats[lat1], lon: grid.lons[lon0], value: grid.elevations[lat1 * nLon + lon0] },
    { lat: grid.lats[lat1], lon: grid.lons[lon1], value: grid.elevations[lat1 * nLon + lon1] },
  ];

  if (corners.every((corner) => Number.isFinite(corner.value))) {
    const south = corners[0].value * (1 - lonT) + corners[1].value * lonT;
    const north = corners[2].value * (1 - lonT) + corners[3].value * lonT;
    return south * (1 - latT) + north * latT;
  }

  let nearestValue = NaN;
  let nearestDistance = Infinity;
  for (const corner of corners) {
    if (!Number.isFinite(corner.value)) continue;
    const distance = (lat - corner.lat) ** 2 + (lon - corner.lon) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestValue = corner.value;
    }
  }
  return nearestValue;
}

export function mergeToPackGrid({ fine, coarse, bbox, nLat = 256, nLon = 256 }) {
  const elevations = new Float64Array(nLat * nLon);

  for (let i = 0; i < nLat; i++) {
    const lat = bbox.latMin + (bbox.latMax - bbox.latMin) * i / (nLat - 1);
    for (let j = 0; j < nLon; j++) {
      const lon = bbox.lonMin + (bbox.lonMax - bbox.lonMin) * j / (nLon - 1);
      const fineValue = fine ? sampleGrid(fine, lat, lon) : NaN;
      elevations[i * nLon + j] = Number.isFinite(fineValue)
        ? fineValue
        : sampleGrid(coarse, lat, lon);
    }
  }

  return { nLat, nLon, elevations };
}
