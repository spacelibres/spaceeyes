export interface StarfieldSpec {
  readonly frame: "ICRF";
  readonly source: string;
  readonly positionsKm: readonly number[];
  readonly colorsRgb: readonly number[];
  readonly magnitudes: readonly number[];
  readonly absoluteMagnitudes: readonly number[];
}
export function snapshotStarfield(
  spec: StarfieldSpec,
): Readonly<StarfieldSpec> {
  const keys = [
    "frame",
    "source",
    "positionsKm",
    "colorsRgb",
    "magnitudes",
    "absoluteMagnitudes",
  ];
  if (
    !spec ||
    typeof spec !== "object" ||
    Reflect.ownKeys(spec).some(
      (k) => typeof k !== "string" || !keys.includes(k),
    ) ||
    spec.frame !== "ICRF" ||
    typeof spec.source !== "string" ||
    !spec.source.trim() ||
    spec.source.length > 1024
  )
    throw new Error("invalid starfield spec");
  const arrays = [
    spec.positionsKm,
    spec.colorsRgb,
    spec.magnitudes,
    spec.absoluteMagnitudes,
  ];
  if (
    arrays.some(
      (a) =>
        !Array.isArray(a) ||
        Array.from(a).some((v) => typeof v !== "number" || !Number.isFinite(v)),
    )
  )
    throw new Error("invalid starfield arrays");
  const n = spec.magnitudes.length;
  if (
    n < 1 ||
    n > 50000 ||
    spec.positionsKm.length !== 3 * n ||
    spec.colorsRgb.length !== 3 * n ||
    spec.absoluteMagnitudes.length !== n
  )
    throw new Error("invalid starfield count");
  if (spec.colorsRgb.some((v) => v < 0 || v > 1))
    throw new Error("invalid starfield color");
  if (spec.positionsKm.some((v) => Math.abs(v) > 1e30))
    throw new Error("starfield render coordinate budget");
  for (let i = 0; i < n; i++) {
    if (
      spec.positionsKm.slice(i * 3, i * 3 + 3).every((v) => v === 0) ||
      spec.colorsRgb.slice(i * 3, i * 3 + 3).every((v) => v === 0)
    )
      throw new Error("invalid starfield point");
  }
  return Object.freeze({
    frame: "ICRF",
    source: spec.source,
    positionsKm: Object.freeze([...spec.positionsKm]),
    colorsRgb: Object.freeze([...spec.colorsRgb]),
    magnitudes: Object.freeze([...spec.magnitudes]),
    absoluteMagnitudes: Object.freeze([...spec.absoluteMagnitudes]),
  });
}
