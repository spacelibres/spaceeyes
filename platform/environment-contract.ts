export type EnvironmentLod = {
  readonly tileSize: 256;
  readonly border: 2;
  readonly levels: readonly {
    readonly level: number;
    readonly width: number;
    readonly height: number;
    readonly tiles: readonly {
      readonly x: number;
      readonly y: number;
      readonly assetId: string;
    }[];
  }[];
  readonly diffuseAssetId: string;
  readonly specularAssetId: string;
  readonly exposureEv: number;
  readonly blackLevel: number;
  readonly iblIntensity: number;
};
const asset = (v: unknown) =>
  typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(v);
function snapshotLod(lod: EnvironmentLod): EnvironmentLod {
  if (
    !lod ||
    Object.keys(lod).some(
      (k) =>
        ![
          "tileSize",
          "border",
          "levels",
          "diffuseAssetId",
          "specularAssetId",
          "exposureEv",
          "blackLevel",
          "iblIntensity",
        ].includes(k),
    ) ||
    lod.tileSize !== 256 ||
    lod.border !== 2 ||
    !asset(lod.diffuseAssetId) ||
    !asset(lod.specularAssetId) ||
    !Number.isFinite(lod.exposureEv) ||
    Math.abs(lod.exposureEv) > 6 ||
    !Number.isFinite(lod.blackLevel) ||
    lod.blackLevel < 0 ||
    lod.blackLevel > 0.02 ||
    !Number.isFinite(lod.iblIntensity) ||
    lod.iblIntensity < 0 ||
    lod.iblIntensity > 2 ||
    !Array.isArray(lod.levels) ||
    lod.levels.length !== 7
  )
    throw Error("invalid environment LOD");
  let count = 0;
  const levels = lod.levels.map((l, i) => {
    if (
      l.level !== i ||
      l.width !== 128 * 2 ** i ||
      l.height !== 64 * 2 ** i ||
      Object.keys(l).some(
        (k) => !["level", "width", "height", "tiles"].includes(k),
      ) ||
      !Array.isArray(l.tiles) ||
      l.tiles.length !== Math.ceil(l.width / 256) * Math.ceil(l.height / 256)
    )
      throw Error("invalid environment level");
    const seen = new Set<string>();
    const tiles = l.tiles.map(
      (t: { x: number; y: number; assetId: string }) => {
        const key = `${t.x}:${t.y}`;
        if (
          Object.keys(t).some((k) => !["x", "y", "assetId"].includes(k)) ||
          !Number.isInteger(t.x) ||
          !Number.isInteger(t.y) ||
          t.x < 0 ||
          t.y < 0 ||
          t.x >= Math.ceil(l.width / 256) ||
          t.y >= Math.ceil(l.height / 256) ||
          !asset(t.assetId) ||
          seen.has(key)
        )
          throw Error("invalid environment tile");
        seen.add(key);
        count++;
        return Object.freeze({ ...t });
      },
    );
    return Object.freeze({ ...l, tiles: Object.freeze(tiles) });
  });
  if (count > 1024) throw Error("environment tile budget");
  return Object.freeze({ ...lod, levels: Object.freeze(levels) });
}
export type EnvironmentSpec = {
  readonly lod?: EnvironmentLod;
  readonly assetId: string;
  readonly frame: "ICRF";
  readonly intensity: number;
};
export function snapshotEnvironment(
  spec: EnvironmentSpec,
): Readonly<EnvironmentSpec> {
  if (
    !spec ||
    typeof spec !== "object" ||
    Reflect.ownKeys(spec).some(
      (key) =>
        typeof key !== "string" ||
        !["assetId", "frame", "intensity", "lod"].includes(key),
    ) ||
    typeof spec.assetId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(spec.assetId) ||
    spec.frame !== "ICRF" ||
    !Number.isFinite(spec.intensity) ||
    spec.intensity < 0 ||
    spec.intensity > 4
  )
    throw Error("invalid environment");
  const lod = spec.lod === undefined ? undefined : snapshotLod(spec.lod);
  if (lod && lod.levels[0].tiles[0].assetId !== spec.assetId)
    throw Error("environment parent mismatch");
  return Object.freeze({ ...spec, ...(lod ? { lod } : {}) });
}
