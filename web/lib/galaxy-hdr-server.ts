import { open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
export type HdrAsset = {
  assetId: string;
  path: string;
  sha256: string;
  bytes: number;
};
export type GalaxyManifest = {
  schemaVersion: 1;
  source: {
    url: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
  };
  tileSize: 256;
  border: 2;
  levels: {
    level: number;
    width: number;
    height: number;
    tiles: (HdrAsset & { x: number; y: number })[];
  }[];
  diffuse: HdrAsset;
  specular: HdrAsset;
};
const directory = () =>
  resolve(
    process.cwd().endsWith("web")
      ? ".cache/galaxy-lod"
      : "web/.cache/galaxy-lod",
  );
async function bounded(path: string, max: number) {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > max) throw Error("HDR byte budget");
    const b = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < b.length) {
      const { bytesRead } = await handle.read(
        b,
        offset,
        b.length - offset,
        offset,
      );
      if (!bytesRead) throw Error("HDR truncated read");
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, offset)).bytesRead)
      throw Error("HDR growing resource");
    return b;
  } finally {
    await handle.close();
  }
}
export function validateGalaxyManifest(value: unknown): GalaxyManifest {
  const m = value as GalaxyManifest;
  if (
    !m ||
    m.schemaVersion !== 1 ||
    m.tileSize !== 256 ||
    m.border !== 2 ||
    !Array.isArray(m.levels) ||
    m.levels.length !== 7 ||
    m.source?.width !== 8192 ||
    m.source?.height !== 4096 ||
    m.source?.bytes !== 137307727 ||
    m.source?.sha256 !==
      "361d1961647af073b3b3e4aea4fca85f15b3c9d915e0c8c4befb02520dadd10a" ||
    m.source?.url !==
      "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k.exr"
  )
    throw Error("HDR manifest schema");
  const check = (a: HdrAsset, id: string, path: string, bytes: number) => {
    if (
      !a ||
      a.assetId !== id ||
      a.path !== path ||
      a.bytes !== bytes ||
      !/^[0-9a-f]{64}$/.test(a.sha256)
    )
      throw Error("HDR manifest asset");
  };
  for (let l = 0; l < 7; l++) {
    const level = m.levels[l],
      w = 128 * 2 ** l,
      h = 64 * 2 ** l,
      nx = Math.ceil(w / 256),
      ny = Math.ceil(h / 256);
    if (
      level.level !== l ||
      level.width !== w ||
      level.height !== h ||
      !Array.isArray(level.tiles) ||
      level.tiles.length !== nx * ny
    )
      throw Error("HDR manifest level");
    const seen = new Set<string>();
    for (const t of level.tiles) {
      if (
        !Number.isInteger(t.x) ||
        !Number.isInteger(t.y) ||
        t.x < 0 ||
        t.x >= nx ||
        t.y < 0 ||
        t.y >= ny ||
        seen.has(`${t.x}:${t.y}`)
      )
        throw Error("HDR manifest tile");
      seen.add(`${t.x}:${t.y}`);
      check(
        t,
        `galaxy:l${l}:${t.x}:${t.y}`,
        `deep-space/galaxy-l${l}-${t.x}-${t.y}.sehdr`,
        16 +
          (Math.min(256, w - t.x * 256) + 4) *
            (Math.min(256, h - t.y * 256) + 4) *
            8,
      );
    }
  }
  check(
    m.diffuse,
    "galaxy:diffuse",
    "deep-space/galaxy-diffuse.sehdr",
    16 + 32 * 32 * 6 * 8,
  );
  check(
    m.specular,
    "galaxy:specular",
    "deep-space/galaxy-specular.sehdr",
    16 + 131070 * 8,
  );
  return m;
}
export async function readGalaxyManifest(): Promise<GalaxyManifest> {
  return validateGalaxyManifest(
    JSON.parse(
      (await bounded(join(directory(), "manifest.json"), 1024 * 1024)).toString(
        "utf8",
      ),
    ),
  );
}
export async function readGalaxyHdr(file: string) {
  if (!/^galaxy-(?:l[0-6]-\d+-\d+|diffuse|specular)\.sehdr$/.test(file))
    throw Error("Unknown HDR asset");
  const m = await readGalaxyManifest();
  const a = [...m.levels.flatMap((l) => l.tiles), m.diffuse, m.specular].find(
    (a) => a.path === `deep-space/${file}`,
  );
  if (!a || a.bytes > 8 * 1024 * 1024) throw Error("Unknown HDR asset");
  const bytes = await bounded(join(directory(), file), a.bytes);
  if (
    bytes.length !== a.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== a.sha256
  )
    throw Error("HDR identity mismatch");
  return { bytes, sha256: a.sha256 };
}
