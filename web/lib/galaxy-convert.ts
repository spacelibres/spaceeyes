/// <reference path="../types/three-exr.d.ts" />
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { FloatType } from "three";
// Server-only codec. Three is never used as a renderer or imported into browser code.
export function decodeGalaxy(bytes: Uint8Array) {
  if (bytes.length < 16 || bytes.length > 40 * 1024 * 1024)
    throw Error("EXR source budget");
  const result = new EXRLoader()
    .setDataType(FloatType)
    .parse(bytes.slice().buffer as ArrayBuffer);
  if (
    result.width !== 4096 ||
    result.height !== 2048 ||
    !(result.data instanceof Float32Array) ||
    result.data.length !== result.width * result.height * 4
  )
    throw Error("Unexpected galaxy EXR dimensions");
  return result;
}
export function toneMapGalaxy(
  data: Float32Array,
  width: number,
  height: number,
  exposure: number,
) {
  if (!Number.isFinite(exposure) || exposure <= 0 || exposure > 16)
    throw Error("Invalid galaxy exposure");
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 2048 ||
    data.length !== width * height * 4
  )
    throw Error("Galaxy pixel budget");
  const output = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      if (!Number.isFinite(data[i + c])) throw Error("Nonfinite galaxy pixel");
      const linear = Math.max(0, data[i + c]) * exposure;
      const mapped = linear / (1 + linear);
      const srgb =
        mapped <= 0.0031308
          ? mapped * 12.92
          : 1.055 * Math.pow(mapped, 1 / 2.4) - 0.055;
      output[i + c] = Math.round(srgb * 255);
    }
    output[i + 3] = 255;
  }
  return output;
}
