export type VisualSpec =
  | {
      kind: "model";
      assetId: string;
      scene: number;
      scaleKmPerUnit: number;
      framingRadiusKm?: number;
    }
  | {
      kind: "sphere";
      ringAssets?: [string, string];
      ringInnerRadiusRatio?: number;
      ringOuterRadiusRatio?: number;
      textureAsset?: string | null;
      faceAssets?: [string, string, string, string, string, string];
      colorRgba?: [number, number, number, number];
      emissiveRgba?: [number, number, number, number];
      stellar?: { coronaIntensity: number; flowSpeed: number };
    };
export interface VisualStatus {
  revision: string;
  phase: "pending" | "loading" | "ready" | "failed" | "suspended";
  detail: string | null;
}

function assetId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(value)
  )
    throw new Error("invalid asset id");
  return value;
}

export function snapshotVisual(spec: VisualSpec): Readonly<VisualSpec> {
  if (!spec || typeof spec !== "object") throw new Error("invalid visual spec");
  const allowed =
    spec.kind === "model"
      ? ["kind", "assetId", "scene", "scaleKmPerUnit", "framingRadiusKm"]
      : [
          "kind",
          "textureAsset",
          "faceAssets",
          "ringAssets",
          "ringInnerRadiusRatio",
          "ringOuterRadiusRatio",
          "colorRgba",
          "emissiveRgba",
          "stellar",
        ];
  if (Object.keys(spec).some((key) => !allowed.includes(key)))
    throw new Error("invalid visual fields");
  if (spec.kind === "model") {
    if (
      spec.framingRadiusKm !== undefined &&
      (typeof spec.framingRadiusKm !== "number" ||
        !Number.isFinite(spec.framingRadiusKm) ||
        spec.framingRadiusKm <= 0 ||
        spec.framingRadiusKm > 1e12)
    )
      throw Error("invalid model framing radius");
    if (
      !Number.isSafeInteger(spec.scene) ||
      spec.scene < 0 ||
      spec.scene > 1023 ||
      !Number.isFinite(spec.scaleKmPerUnit) ||
      spec.scaleKmPerUnit <= 0
    )
      throw new Error("invalid model visual");
    return Object.freeze({
      kind: "model",
      assetId: assetId(spec.assetId),
      scene: spec.scene,
      scaleKmPerUnit: spec.scaleKmPerUnit,
      ...(spec.framingRadiusKm !== undefined
        ? { framingRadiusKm: spec.framingRadiusKm }
        : {}),
    });
  }
  if (spec.kind === "sphere") {
    if (
      spec.stellar !== undefined &&
      (!spec.stellar ||
        typeof spec.stellar !== "object" ||
        Reflect.ownKeys(spec.stellar).some(
          (key) =>
            typeof key !== "string" ||
            !["coronaIntensity", "flowSpeed"].includes(key),
        ) ||
        !Number.isFinite(spec.stellar.coronaIntensity) ||
        spec.stellar.coronaIntensity < 0 ||
        spec.stellar.coronaIntensity > 4 ||
        !Number.isFinite(spec.stellar.flowSpeed) ||
        spec.stellar.flowSpeed < 0 ||
        spec.stellar.flowSpeed > 2)
    )
      throw Error("invalid stellar effect");
    if (
      spec.faceAssets !== undefined &&
      (!Array.isArray(spec.faceAssets) ||
        spec.faceAssets.length !== 6 ||
        spec.textureAsset != null)
    )
      throw new Error("invalid face assets");
    if (spec.ringAssets !== undefined) {
      if (
        !Array.isArray(spec.ringAssets) ||
        spec.ringAssets.length !== 2 ||
        !Number.isFinite(spec.ringInnerRadiusRatio) ||
        !Number.isFinite(spec.ringOuterRadiusRatio) ||
        spec.ringInnerRadiusRatio! < 1 ||
        spec.ringInnerRadiusRatio! >= spec.ringOuterRadiusRatio! ||
        spec.ringOuterRadiusRatio! > 10
      )
        throw new Error("invalid ring visual");
    } else if (
      spec.ringInnerRadiusRatio !== undefined ||
      spec.ringOuterRadiusRatio !== undefined
    )
      throw new Error("invalid ring radii");
    const faceAssets = spec.faceAssets?.map(assetId) as
      | [string, string, string, string, string, string]
      | undefined;
    for (const c of [spec.colorRgba, spec.emissiveRgba])
      if (
        c !== undefined &&
        (!Array.isArray(c) ||
          c.length !== 4 ||
          c.some((n) => !Number.isFinite(n) || n < 0 || n > 1))
      )
        throw new Error("invalid sphere color");
    return Object.freeze({
      kind: "sphere",
      ...(spec.stellar ? { stellar: Object.freeze({ ...spec.stellar }) } : {}),
      ...(spec.ringAssets
        ? {
            ringAssets: Object.freeze(
              spec.ringAssets.map(assetId),
            ) as unknown as [string, string],
            ringInnerRadiusRatio: spec.ringInnerRadiusRatio,
            ringOuterRadiusRatio: spec.ringOuterRadiusRatio,
          }
        : {}),
      ...(faceAssets
        ? {
            faceAssets: Object.freeze(faceAssets) as unknown as [
              string,
              string,
              string,
              string,
              string,
              string,
            ],
          }
        : {}),
      textureAsset:
        spec.textureAsset == null ? null : assetId(spec.textureAsset),
      ...(spec.colorRgba
        ? {
            colorRgba: Object.freeze([...spec.colorRgba]) as unknown as [
              number,
              number,
              number,
              number,
            ],
          }
        : {}),
      ...(spec.emissiveRgba
        ? {
            emissiveRgba: Object.freeze([...spec.emissiveRgba]) as unknown as [
              number,
              number,
              number,
              number,
            ],
          }
        : {}),
    });
  }
  throw new Error("invalid visual kind");
}
