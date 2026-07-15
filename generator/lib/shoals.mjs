const METERS_PER_DEGREE = 111_320;
const MINIMUM_SEPARATION_CELLS = 8;

export function findShoals(packGrid, bbox, { count = 4, minProminence = 5 } = {}) {
  const { nLat, nLon, elevations } = packGrid;
  const limit = Math.max(0, Math.floor(count));

  if (
    !(limit > 0)
    || !Number.isInteger(nLat)
    || !Number.isInteger(nLon)
    || nLat < 11
    || nLon < 11
    || !elevations
    || elevations.length < nLat * nLon
  ) {
    return [];
  }

  const candidates = [];

  for (let row = 5; row < nLat - 5; row++) {
    for (let col = 5; col < nLon - 5; col++) {
      const crest = elevations[row * nLon + col];
      if (!Number.isFinite(crest) || crest >= 0 || !isLocalMaximum(elevations, nLon, row, col, crest)) {
        continue;
      }

      const ringMean = meanFiveCellRing(elevations, nLon, row, col);
      const prominence = crest - ringMean;

      if (Number.isFinite(ringMean) && prominence >= minProminence) {
        candidates.push({ row, col, crest, prominence });
      }
    }
  }

  candidates.sort((a, b) => b.crest - a.crest || a.row - b.row || a.col - b.col);

  const selected = [];
  const minimumSeparationSquared = MINIMUM_SEPARATION_CELLS ** 2;
  for (const candidate of candidates) {
    const overlaps = selected.some(({ row, col }) => {
      const rowDistance = candidate.row - row;
      const colDistance = candidate.col - col;
      return rowDistance ** 2 + colDistance ** 2 < minimumSeparationSquared;
    });
    if (overlaps) continue;

    selected.push(candidate);
    if (selected.length === limit) break;
  }

  const cellSizeMeters = estimateCellSizeMeters(bbox, nLat, nLon);
  return selected.map(({ row, col, crest, prominence }) => ({
    id: `shoal-${row}-${col}`,
    name: null,
    latLon: [
      bbox.latMin + (bbox.latMax - bbox.latMin) * row / (nLat - 1),
      bbox.lonMin + (bbox.lonMax - bbox.lonMin) * col / (nLon - 1),
    ],
    crestMeters: crest,
    radiusMeters: contiguousCrestCellCount(
      elevations,
      nLat,
      nLon,
      row,
      col,
      crest - prominence / 2,
    ) * cellSizeMeters,
  }));
}

function isLocalMaximum(elevations, nLon, row, col, crest) {
  for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
    for (let colOffset = -1; colOffset <= 1; colOffset++) {
      if (rowOffset === 0 && colOffset === 0) continue;
      const neighbor = elevations[(row + rowOffset) * nLon + col + colOffset];
      if (!Number.isFinite(neighbor) || neighbor > crest) return false;
    }
  }
  return true;
}

function meanFiveCellRing(elevations, nLon, row, col) {
  let total = 0;
  let cells = 0;

  for (let rowOffset = -5; rowOffset <= 5; rowOffset++) {
    for (let colOffset = -5; colOffset <= 5; colOffset++) {
      if (Math.max(Math.abs(rowOffset), Math.abs(colOffset)) !== 5) continue;
      const elevation = elevations[(row + rowOffset) * nLon + col + colOffset];
      if (!Number.isFinite(elevation)) return NaN;
      total += elevation;
      cells++;
    }
  }

  return total / cells;
}

function estimateCellSizeMeters(bbox, nLat, nLon) {
  const latitudeSpacing = Math.abs(bbox.latMax - bbox.latMin) * METERS_PER_DEGREE / (nLat - 1);
  const middleLatitudeRadians = (bbox.latMin + bbox.latMax) * Math.PI / 360;
  const longitudeSpacing = Math.abs(bbox.lonMax - bbox.lonMin)
    * METERS_PER_DEGREE
    * Math.abs(Math.cos(middleLatitudeRadians))
    / (nLon - 1);

  // A lat/lon cell is generally rectangular. Its equal-area square side,
  // sqrt(north-south spacing × east-west spacing), is our scalar cell size.
  return Math.sqrt(latitudeSpacing * longitudeSpacing);
}

function contiguousCrestCellCount(elevations, nLat, nLon, startRow, startCol, threshold) {
  const visited = new Uint8Array(nLat * nLon);
  const stack = [[startRow, startCol]];
  let cells = 0;

  while (stack.length > 0) {
    const [row, col] = stack.pop();
    const index = row * nLon + col;
    if (visited[index]) continue;
    visited[index] = 1;

    const elevation = elevations[index];
    if (!Number.isFinite(elevation) || elevation >= 0 || elevation < threshold) continue;
    cells++;

    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
      for (let colOffset = -1; colOffset <= 1; colOffset++) {
        if (rowOffset === 0 && colOffset === 0) continue;
        const nextRow = row + rowOffset;
        const nextCol = col + colOffset;
        if (nextRow < 0 || nextRow >= nLat || nextCol < 0 || nextCol >= nLon) continue;
        if (!visited[nextRow * nLon + nextCol]) stack.push([nextRow, nextCol]);
      }
    }
  }

  return cells;
}
