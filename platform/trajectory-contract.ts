export type TrajectoryConic = {
  semiLatusRectumKm: number;
  radialUnit: readonly [number, number, number];
  transverseUnit: readonly [number, number, number];
  eccentricityRadial: number;
  eccentricityTransverse: number;
};
/** Display intent only. Coordinates/epochs remain authored by the data plugin. */
export type TrajectoryStyle = {
  conic?: Readonly<TrajectoryConic>;
  originId?: string;
  colorRgba?: [number, number, number, number];
  kind?: "orbit" | "trail";
  trailDurationSeconds?: number;
  breakIndices?: readonly number[];
};
export function snapshotTrajectoryStyle(
  style: TrajectoryStyle,
  count: number,
): Readonly<TrajectoryStyle> {
  if (
    !style ||
    typeof style !== "object" ||
    Reflect.ownKeys(style).some(
      (k) =>
        typeof k !== "string" ||
        ![
          "conic",
          "originId",
          "colorRgba",
          "kind",
          "trailDurationSeconds",
          "breakIndices",
        ].includes(k),
    )
  )
    throw Error("invalid trajectory style");
  if (style.kind !== undefined && !["orbit", "trail"].includes(style.kind))
    throw Error("invalid trajectory kind");
  if (
    style.kind === "trail"
      ? !Number.isFinite(style.trailDurationSeconds) ||
        style.trailDurationSeconds! < 1 ||
        style.trailDurationSeconds! > 315576000
      : style.trailDurationSeconds !== undefined
  )
    throw Error("invalid trajectory window");
  if (
    style.breakIndices !== undefined &&
    (!Array.isArray(style.breakIndices) ||
      style.breakIndices.length > Math.max(0, count - 1) ||
      style.breakIndices.some(
        (v, i) =>
          !Number.isInteger(v) ||
          v < 1 ||
          v >= count ||
          (i > 0 && v <= style.breakIndices![i - 1]),
      ))
  )
    throw Error("invalid trajectory breaks");
  let conic: Readonly<TrajectoryConic> | undefined;
  if (style.conic !== undefined) {
    const c = style.conic;
    const unit = (v: readonly number[]) =>
      Array.isArray(v) &&
      v.length === 3 &&
      v.every(Number.isFinite) &&
      Math.abs(Math.hypot(...v) - 1) <= 1e-6;
    if (
      !c ||
      typeof c !== "object" ||
      Reflect.ownKeys(c).some(
        (k) =>
          typeof k !== "string" ||
          ![
            "semiLatusRectumKm",
            "radialUnit",
            "transverseUnit",
            "eccentricityRadial",
            "eccentricityTransverse",
          ].includes(k),
      ) ||
      count < 2 ||
      style.kind !== "orbit" ||
      (style.breakIndices?.length ?? 0) > 0 ||
      !Number.isFinite(c.semiLatusRectumKm) ||
      c.semiLatusRectumKm <= 0 ||
      c.semiLatusRectumKm > 1e15 ||
      !unit(c.radialUnit) ||
      !unit(c.transverseUnit) ||
      Math.abs(
        c.radialUnit.reduce((sum, v, i) => sum + v * c.transverseUnit[i], 0),
      ) > 1e-6 ||
      !Number.isFinite(c.eccentricityRadial) ||
      !Number.isFinite(c.eccentricityTransverse) ||
      Math.hypot(c.eccentricityRadial, c.eccentricityTransverse) >= 1
    )
      throw Error("invalid trajectory conic");
    conic = Object.freeze({
      ...c,
      radialUnit: Object.freeze([...c.radialUnit]) as readonly [
        number,
        number,
        number,
      ],
      transverseUnit: Object.freeze([...c.transverseUnit]) as readonly [
        number,
        number,
        number,
      ],
    });
  }
  return Object.freeze({
    ...style,
    ...(conic ? { conic } : {}),
    ...(style.breakIndices
      ? { breakIndices: Object.freeze([...style.breakIndices]) }
      : {}),
  });
}
