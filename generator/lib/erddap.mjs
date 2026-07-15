export function parseErddapGrid(json) {
  const { columnNames, rows } = json.table;
  const iLat = columnNames.indexOf('latitude');
  const iLon = columnNames.indexOf('longitude');
  const iEl = columnNames.indexOf('elevation');
  const lats = [...new Set(rows.map((r) => r[iLat]))].sort((a, b) => a - b);
  const lons = [...new Set(rows.map((r) => r[iLon]))].sort((a, b) => a - b);
  const latIdx = new Map(lats.map((v, i) => [v, i]));
  const lonIdx = new Map(lons.map((v, i) => [v, i]));
  const elevations = new Float64Array(lats.length * lons.length).fill(NaN);
  for (const r of rows) {
    const el = r[iEl];
    elevations[latIdx.get(r[iLat]) * lons.length + lonIdx.get(r[iLon])] =
      el == null ? NaN : el;
  }
  return { lats, lons, elevations };
}

export async function fetchErddapGrid(datasetUrl, bbox, fetchImpl) {
  const url = `${datasetUrl}.json?elevation[(${bbox.latMin}):(${bbox.latMax})][(${bbox.lonMin}):(${bbox.lonMax})]`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`ERDDAP ${res.status ?? 'error'} for ${url}`);
  return parseErddapGrid(await res.json());
}
