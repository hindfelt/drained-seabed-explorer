const NODATA = -32768;

export function encodeBathy(elevations) {
  const out = Buffer.allocUnsafe(elevations.length * 2);
  for (let i = 0; i < elevations.length; i++) {
    const m = elevations[i];
    const decimeters = Number.isFinite(m)
      ? Math.max(-32767, Math.min(32767, Math.round(m * 10)))
      : NODATA;
    out.writeInt16LE(decimeters, i * 2);
  }
  return out;
}

export function decodeBathy(buf) {
  const byteLength = buf.byteLength ?? buf.length;
  const view = new DataView(buf.buffer ?? buf, buf.byteOffset ?? 0, byteLength);
  const out = new Float64Array(byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    const decimeters = view.getInt16(i * 2, true);
    out[i] = decimeters === NODATA ? NaN : decimeters / 10;
  }
  return out;
}
