import { fetchErddapGrid } from '../lib/erddap.mjs';

export const meta = {
  name: 'gebco-2020',
  coverage: 'global',
  license: 'GEBCO grid — free to use',
  attribution: 'Bathymetry © GEBCO Compilation Group',
};

export async function fetchGrid(bbox, { fetchImpl = fetch } = {}) {
  return fetchErddapGrid('https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020', bbox, fetchImpl);
}
