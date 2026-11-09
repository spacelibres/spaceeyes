import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { FloatType } from "three";
import assert from "node:assert/strict";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { readGalaxyManifest, readGalaxyHdr } from "../lib/galaxy-hdr-server.ts";
const dir = resolve(
    process.cwd().endsWith("web")
      ? ".cache/galaxy-lod"
      : "web/.cache/galaxy-lod",
  ),
  m = await readGalaxyManifest();
let tiles = 0,
  hdr = 0,
  zeros = 0,
  minimum = Infinity,
  maximum = 0;
for (const level of m.levels) {
  const buffers = new Map<string, Buffer>();
  for (const t of level.tiles) {
    const b = (await readGalaxyHdr(t.path.split("/")[1])).bytes;
    assert.equal(b.subarray(0, 8).toString("ascii"), "SEHDR01\0");
    assert.equal(b[12], 1);
    assert.equal(b[13], 1);
    assert.equal(b.readUInt16LE(14), 0);
    buffers.set(`${t.x}:${t.y}`, b);
    tiles++;
    for (let i = 16; i < b.length; i += 8)
      for (let c = 0; c < 3; c++) {
        const v = b.readUInt16LE(i + c * 2);
        assert.ok(v < 0x7c00);
        if (v === 0) zeros++;
        if (v > 0x3c00) hdr++;
        minimum = Math.min(minimum, v);
        maximum = Math.max(maximum, v);
      }
  }
  const pixel = (x: number, y: number) => {
    x = (x + level.width) % level.width;
    y = Math.max(0, Math.min(level.height - 1, y));
    const tx = Math.floor(x / 256),
      ty = Math.floor(y / 256),
      b = buffers.get(`${tx}:${ty}`)!,
      w = b.readUInt16LE(8);
    return b.subarray(
      16 + (((y % 256) + 2) * w + (x % 256) + 2) * 8,
      16 + (((y % 256) + 2) * w + (x % 256) + 2) * 8 + 8,
    );
  };
  for (const t of level.tiles) {
    const b = buffers.get(`${t.x}:${t.y}`)!,
      w = b.readUInt16LE(8),
      h = b.readUInt16LE(10);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2)
          assert.deepEqual(
            b.subarray(16 + (y * w + x) * 8, 16 + (y * w + x) * 8 + 8),
            pixel(t.x * 256 + x - 2, t.y * 256 + y - 2),
          );
  }
}
for (const kind of ["diffuse", "specular"] as const) {
  const b = (await readGalaxyHdr(m[kind].path.split("/")[1])).bytes;
  assert.equal(b.readUInt16LE(8), kind === "diffuse" ? 32 : 128);
  assert.equal(b.readUInt16LE(10), kind === "diffuse" ? 32 : 128);
  assert.equal(b[12], 6);
  assert.equal(b[13], kind === "diffuse" ? 1 : 8);
  for (let i = 16; i < b.length; i += 2) assert.ok(b.readUInt16LE(i) < 0x7c00);
}
assert.ok(zeros > 0, "NASA black pixels retain exact zero");
const source = await readFile(join(dir, "source.exr"));
assert.equal(
  createHash("sha256").update(source).digest("hex"),
  m.source.sha256,
);

function half(h: number) {
  const e = (h >> 10) & 31,
    m = h & 1023;
  return e ? 2 ** (e - 15) * (1 + m / 1024) : m * 2 ** -24;
}
const exr = new EXRLoader()
  .setDataType(FloatType)
  .parse(
    source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ),
  );
const cube = (await readGalaxyHdr("galaxy-specular.sehdr")).bytes;
let dot = 0,
  aa = 0,
  bb = 0,
  directionalSamples = 0;
for (let face = 0; face < 6; face++)
  for (let y = 8; y < 128; y += 16)
    for (let x = 8; x < 128; x += 16) {
      const cx = (x + 0.5) / 64 - 1,
        cy = 1 - (y + 0.5) / 64;
      const d = [
          [1, cy, -cx],
          [-1, cy, cx],
          [cx, 1, -cy],
          [cx, -1, cy],
          [cx, cy, 1],
          [-cx, cy, -1],
        ][face],
        len = Math.hypot(...d);
      const u = (0.5 + Math.atan2(d[2], d[0]) / (2 * Math.PI) + 1) % 1,
        v = 0.5 - Math.asin(d[1] / len) / Math.PI;
      const sx = Math.min(8191, Math.floor(u * 8192)),
        sy = Math.min(4095, Math.floor(v * 4096));
      for (let c = 0; c < 3; c++) {
        const a = half(
            cube.readUInt16LE(16 + ((face * 128 + y) * 128 + x) * 8 + c * 2),
          ),
          b = exr.data[((4095 - sy) * 8192 + sx) * 4 + c];
        dot += a * b;
        aa += a * a;
        bb += b * b;
      }
      directionalSamples++;
    }
const directionalCosine = dot / Math.sqrt(aa * bb);
assert.ok(
  directionalCosine > 0.9,
  "actual cube directional correspondence to NASA panorama",
);
const roughnessVariance: number[] = [];
let offset = 16;
for (let mip = 0; mip < 8; mip++) {
  const n = 128 >> mip,
    count = n * n * 6;
  let sum = 0,
    squares = 0;
  for (let i = 0; i < count; i++) {
    let v = 0;
    for (let c = 0; c < 3; c++)
      v += half(cube.readUInt16LE(offset + i * 8 + c * 2)) / 3;
    sum += v;
    squares += v * v;
  }
  roughnessVariance.push(squares / count - (sum / count) ** 2);
  offset += count * 8;
}
for (let mip = 1; mip < 8; mip++)
  assert.ok(
    roughnessVariance[mip] < roughnessVariance[mip - 1],
    "GGX roughness progressively removes high frequency variation",
  );

const audit = {
  directionalSamples,
  directionalCosine,
  roughnessVariance,
  source: m.source,
  tiles,
  hdrChannelsAbove1: hdr,
  sourceRangeNote:
    "Official NASA source RGB range is [0,1]; no artificial gain applied. Synthetic codec tests independently verify >1 retention.",
  exactZeroChannels: zeros,
  minHalfBits: minimum,
  maxHalfBits: maximum,
  gutters: "every edge pixel including longitude wrap and pole clamp verified",
  ibl: "Filament cmgen v1.79.0 1024 samples, no-mirror; diffuse32 and specular128 full8mips",
  passed: true,
};
await writeFile(join(dir, "audit.json.tmp"), JSON.stringify(audit, null, 2));
await rename(join(dir, "audit.json.tmp"), join(dir, "audit.json"));
console.log(JSON.stringify(audit, null, 2));
