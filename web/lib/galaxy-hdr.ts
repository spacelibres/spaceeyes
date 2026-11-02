const bits = new DataView(new ArrayBuffer(4));
function half(v: number) {
  bits.setFloat32(0, v, false);
  const n = bits.getUint32(0, false),
    e = ((n >>> 23) & 255) - 127 + 15,
    m = n & 0x7fffff;
  if (e <= 0) return e < -10 ? 0 : Math.round((m | 0x800000) / 2 ** (14 - e));
  return Math.min(0x7bff, (e << 10) + Math.round(m / 8192));
}
// Filament's panorama longitude is atan2(x,z); the scientific sky uses atan2(z,x).
// Swap cube X/Z coordinates exactly, preserving texels rather than resampling.
export function icrfCubeFaces(
  faces: Float32Array[],
  n: number,
): Float32Array[] {
  return [4, 5, 2, 3, 0, 1].map((source, face) => {
    const out = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const sx = face === 2 ? y : face === 3 ? n - 1 - y : n - 1 - x,
          sy = face === 2 ? x : face === 3 ? n - 1 - x : y;
        out.set(
          faces[source].subarray((sy * n + sx) * 4, (sy * n + sx) * 4 + 4),
          (y * n + x) * 4,
        );
      }
    return out;
  });
}
export function encodeSehdr(
  width: number,
  height: number,
  faces: number,
  mips: number,
  pixels: Float32Array,
): Buffer {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8196 ||
    height > 4100 ||
    ![1, 6].includes(faces) ||
    !Number.isInteger(mips) ||
    mips < 1 ||
    mips > 14
  )
    throw Error("SEHDR dimensions");
  if (
    (faces === 1 && mips !== 1) ||
    (faces === 6 &&
      (width !== height ||
        (width & (width - 1)) !== 0 ||
        mips > Math.log2(width) + 1))
  )
    throw Error("SEHDR cube layout");
  let count = 0;
  for (let m = 0; m < mips; m++)
    count += Math.max(1, width >> m) * Math.max(1, height >> m) * faces * 4;
  if (pixels.length !== count) throw Error("SEHDR pixel count");
  const out = Buffer.alloc(16 + count * 2);
  out.write("SEHDR01\0", 0, "ascii");
  out.writeUInt16LE(width, 8);
  out.writeUInt16LE(height, 10);
  out[12] = faces;
  out[13] = mips;
  for (let i = 0; i < count; i++) {
    const v = pixels[i];
    if (!Number.isFinite(v) || v < 0 || v > 65504) throw Error("SEHDR range");
    out.writeUInt16LE(half(v), 16 + i * 2);
  }
  return out;
}
