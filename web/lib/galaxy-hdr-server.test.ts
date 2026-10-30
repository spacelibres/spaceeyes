import test from "node:test";
import assert from "node:assert/strict";
import { validateGalaxyManifest } from "./galaxy-hdr-server.ts";
function fixture() {
  const hash = "a".repeat(64),
    asset = (assetId: string, path: string, bytes: number) => ({
      assetId,
      path,
      bytes,
      sha256: hash,
    });
  return {
    schemaVersion: 1,
    tileSize: 256,
    border: 2,
    source: {
      url: "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k.exr",
      sha256:
        "361d1961647af073b3b3e4aea4fca85f15b3c9d915e0c8c4befb02520dadd10a",
      bytes: 137307727,
      width: 8192,
      height: 4096,
    },
    levels: Array.from({ length: 7 }, (_, level) => {
      const width = 128 * 2 ** level,
        height = 64 * 2 ** level,
        tiles = [];
      for (let y = 0; y < Math.ceil(height / 256); y++)
        for (let x = 0; x < Math.ceil(width / 256); x++)
          tiles.push({
            x,
            y,
            ...asset(
              `galaxy:l${level}:${x}:${y}`,
              `deep-space/galaxy-l${level}-${x}-${y}.sehdr`,
              16 +
                (Math.min(256, width - x * 256) + 4) *
                  (Math.min(256, height - y * 256) + 4) *
                  8,
            ),
          });
      return { level, width, height, tiles };
    }),
    diffuse: asset("galaxy:diffuse", "deep-space/galaxy-diffuse.sehdr", 49168),
    specular: asset(
      "galaxy:specular",
      "deep-space/galaxy-specular.sehdr",
      1048576,
    ),
  };
}
test("manifest enforces NASA identity, seven grids and exact bounded resources", () => {
  assert.equal(validateGalaxyManifest(fixture()).levels.length, 7);
  for (const mutate of [
    (m: any) => (m.source.width = 4096),
    (m: any) => m.levels.pop(),
    (m: any) => (m.levels[6].tiles[1] = m.levels[6].tiles[0]),
    (m: any) => (m.diffuse.path = "../source.exr"),
    (m: any) => (m.specular.bytes = 1),
  ]) {
    const m = fixture();
    mutate(m);
    assert.throws(() => validateGalaxyManifest(m));
  }
});
