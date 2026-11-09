/** NASA record positions are kilometres; return ICRF without a renderer basis conversion. */
export function decodeStarfield(
  bytes: Uint8Array | ArrayBuffer,
  source: string,
) {
  if (typeof source !== "string" || !source.trim() || source.length > 1024)
    throw new Error("Invalid starfield source");
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.byteLength < 4 || data.byteLength > 2 * 1024 * 1024)
    throw new Error("Starfield size budget");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength),
    count = view.getInt32(0, true);
  if (count < 1 || count > 50000 || data.length !== 4 + count * 23)
    throw new Error("Invalid starfield count or length");
  const positionsKm: number[] = [],
    colorsRgb: number[] = [],
    magnitudes: number[] = [],
    absoluteMagnitudes: number[] = [];
  const w = 0.9791532214288992,
    q = 0.2031230389823101,
    cos = 1 - 2 * q * q,
    sin = 2 * w * q;
  for (let i = 0; i < count; i++) {
    const o = 4 + i * 23,
      m = view.getFloat32(o, true),
      am = view.getFloat32(o + 4, true),
      r = view.getUint8(o + 8),
      g = view.getUint8(o + 9),
      b = view.getUint8(o + 10),
      a = view.getFloat32(o + 11, true),
      bb = view.getFloat32(o + 15, true),
      c = view.getFloat32(o + 19, true);
    if (
      ![m, am, a, bb, c].every(Number.isFinite) ||
      !(r || g || b) ||
      !(a || bb || c)
    )
      throw new Error("Invalid starfield record");
    positionsKm.push(c, -a * cos - bb * sin, -a * sin + bb * cos);
    colorsRgb.push(
      r / Math.max(r, g, b),
      g / Math.max(r, g, b),
      b / Math.max(r, g, b),
    );
    magnitudes.push(m);
    absoluteMagnitudes.push(am);
  }
  return {
    frame: "ICRF" as const,
    source,
    positionsKm,
    colorsRgb,
    magnitudes,
    absoluteMagnitudes,
  };
}
