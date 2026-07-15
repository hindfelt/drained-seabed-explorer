import { fetchErddapGrid } from '../lib/erddap.mjs';

export const meta = {
  name: 'emodnet-dtm-2024',
  coverage: 'europe',
  license: 'EMODnet — free reuse with attribution',
  attribution: 'Bathymetry © EMODnet Bathymetry Consortium',
};

export function covers(bbox) {
  return bbox.latMin > 25 && bbox.latMax < 73 && bbox.lonMin > -36 && bbox.lonMax < 43;
}

export async function fetchGrid(bbox, { fetchImpl = fetch } = {}) {
  return fetchErddapGrid('https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024', bbox, fetchImpl);
}
