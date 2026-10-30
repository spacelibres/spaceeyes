import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { FloatType } from "three";
import { encodeSehdr, icrfCubeFaces } from "../lib/galaxy-hdr.ts";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL("../.cache/galaxy-lod/", import.meta.url));
await mkdir(dir, { recursive: true });
try {
  await readFile(join(dir, "source.exr"));
} catch {
  const response = await fetch(
    "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k.exr",
    { redirect: "error", signal: AbortSignal.timeout(180000) },
  );
  if (!response.ok || !response.body) throw Error("NASA download failed");
  const bytes = new Uint8Array(137307727);
  let offset = 0;
  const reader = response.body.getReader();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    const chunk = part.value;
    if (offset + chunk.length > bytes.length)
      throw Error("NASA download exceeds budget");
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (
    offset !== bytes.length ||
    createHash("sha256").update(bytes).digest("hex") !==
      "361d1961647af073b3b3e4aea4fca85f15b3c9d915e0c8c4befb02520dadd10a"
  )
    throw Error("NASA download identity");
  await writeFile(join(dir, "source.exr.tmp"), bytes);
  await rename(join(dir, "source.exr.tmp"), join(dir, "source.exr"));
}
const source = await readFile(join(dir, "source.exr"));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
if (
  source.length !== 137307727 ||
  sha(source) !==
    "361d1961647af073b3b3e4aea4fca85f15b3c9d915e0c8c4befb02520dadd10a"
)
  throw Error("NASA source identity mismatch");
const decoded = new EXRLoader()
  .setDataType(FloatType)
  .parse(
    source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ),
  );
if (
  decoded.width !== 8192 ||
  decoded.height !== 4096 ||
  !(decoded.data instanceof Float32Array)
)
  throw Error("NASA 8K dimensions");
async function atomic(name: string, data: Uint8Array | string) {
  await writeFile(join(dir, name + ".tmp"), data);
  await rename(join(dir, name + ".tmp"), join(dir, name));
}
const manifest: any = {
  schemaVersion: 1,
  source: {
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k.exr",
    sha256: sha(source),
    bytes: source.length,
    width: 8192,
    height: 4096,
  },
  tileSize: 256,
  border: 2,
  levels: [],
};
let pixels = decoded.data as Float32Array; // EXRLoader rows are bottom-up: convert once to top-down.
const top = new Float32Array(pixels.length);
for (let y = 0; y < 4096; y++)
  top.set(
    pixels.subarray((4095 - y) * 8192 * 4, (4096 - y) * 8192 * 4),
    y * 8192 * 4,
  );
pixels = top;
const levels = new Map<number, Float32Array>();
levels.set(6, pixels);
for (let l = 5; l >= 0; l--) {
  const w = 128 * 2 ** l,
    h = 64 * 2 ** l,
    prev = levels.get(l + 1)!;
  const p = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++)
        p[(y * w + x) * 4 + c] =
          (prev[(y * 2 * w * 2 + x * 2) * 4 + c] +
            prev[(y * 2 * w * 2 + x * 2 + 1) * 4 + c] +
            prev[((y * 2 + 1) * w * 2 + x * 2) * 4 + c] +
            prev[((y * 2 + 1) * w * 2 + x * 2 + 1) * 4 + c]) /
          4;
  levels.set(l, p);
}
for (let l = 0; l < 7; l++) {
  const width = 128 * 2 ** l,
    height = 64 * 2 ** l,
    p = levels.get(l)!,
    tiles = [];
  for (let y = 0; y < Math.ceil(height / 256); y++)
    for (let x = 0; x < Math.ceil(width / 256); x++) {
      const tw = Math.min(256, width - x * 256) + 4,
        th = Math.min(256, height - y * 256) + 4,
        t = new Float32Array(tw * th * 4);
      for (let j = 0; j < th; j++)
        for (let i = 0; i < tw; i++) {
          const sx = (((x * 256 + i - 2) % width) + width) % width,
            sy = Math.max(0, Math.min(height - 1, y * 256 + j - 2));
          for (let c = 0; c < 4; c++)
            t[(j * tw + i) * 4 + c] = Math.max(0, p[(sy * width + sx) * 4 + c]);
        }
      const bytes = encodeSehdr(tw, th, 1, 1, t),
        file = `galaxy-l${l}-${x}-${y}.sehdr`;
      await atomic(file, bytes);
      tiles.push({
        x,
        y,
        assetId: `galaxy:l${l}:${x}:${y}`,
        path: `deep-space/${file}`,
        sha256: sha(bytes),
        bytes: bytes.length,
      });
    }
  manifest.levels.push({ level: l, width, height, tiles });
  console.log("prepared level", l);
}
await atomic("tiles-manifest.json", JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest.source));
const cmgen =
  process.env.CMGEN ??
  join(dir, "bin", process.platform === "win32" ? "cmgen.exe" : "cmgen");
for (let mip = 0; mip < 8; mip++)
  execFileSync(
    cmgen,
    [
      "--quiet",
      "--format=exr",
      `--size=${128 >> mip}`,
      "--no-mirror",
      `--extract-blur=${mip / 7}`,
      `--extract=${join(dir, "specular-linear", String(mip))}`,
      join(dir, "source.exr"),
    ],
    { stdio: "inherit" },
  );
execFileSync(
  cmgen,
  [
    "--quiet",
    "--format=exr",
    "--size=32",
    "--no-mirror",
    `--ibl-irradiance=${join(dir, "diffuse")}`,
    join(dir, "source.exr"),
  ],
  { stdio: "inherit" },
);
for (const kind of ["diffuse", "specular"] as const) {
  const size = kind === "diffuse" ? 32 : 128,
    mips = kind === "diffuse" ? 1 : 8,
    parts: Float32Array[] = [];
  for (let mip = 0; mip < mips; mip++)
    for (const face of ["px", "nx", "py", "ny", "pz", "nz"]) {
      const b = await readFile(
        kind === "diffuse"
          ? join(dir, kind, "source", `i_${face}.exr`)
          : join(dir, "specular-linear", String(mip), "source", `${face}.exr`),
      );
      const d = new EXRLoader()
        .setDataType(FloatType)
        .parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      const n = size >> mip;
      if (d.width !== n || d.height !== n || !(d.data instanceof Float32Array))
        throw Error("cmgen output dimensions");
      const top = new Float32Array(n * n * 4);
      for (let y = 0; y < n; y++)
        top.set(
          d.data.subarray((n - 1 - y) * n * 4, (n - y) * n * 4),
          y * n * 4,
        );
      parts.push(top);
    }
  for (let mip = 0; mip < mips; mip++) {
    const oriented = icrfCubeFaces(
      parts.slice(mip * 6, mip * 6 + 6),
      size >> mip,
    );
    parts.splice(mip * 6, 6, ...oriented);
  }
  const p = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    p.set(part, offset);
    offset += part.length;
  }
  const bytes = encodeSehdr(size, size, 6, mips, p),
    file = `galaxy-${kind}.sehdr`;
  await atomic(file, bytes);
  manifest[kind] = {
    assetId: `galaxy:${kind}`,
    path: `deep-space/${file}`,
    sha256: sha(bytes),
    bytes: bytes.length,
  };
}
await atomic("manifest.json", JSON.stringify(manifest, null, 2));
