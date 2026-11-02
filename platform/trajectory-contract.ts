export const MAX_TRAIL_DURATION_SECONDS = 946080000;
export type TrajectoryConic = {
  semiLatusRectumKm: number;
  radialUnit: readonly [number, number, number];
  transverseUnit: readonly [number, number, number];
  eccentricityRadial: number;
  eccentricityTransverse: number;
};
/** Display intent only. Coordinates/epochs remain authored by the data plugin. */
export type TrajectoryStyle = {
  drawRangeTdbSeconds?: readonly [number, number];
  drawEpochTdbSeconds?: number;
  drawRelativeStart?: boolean;
  drawRelativeEnd?: boolean;
  conic?: Readonly<TrajectoryConic>;
  originId?: string;
  referenceOrientation?: boolean;
  visibleInterval?: "AlwaysVisible" | "DefaultVisibleFar";
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
          "referenceOrientation",
          "visibleInterval",
          "colorRgba",
          "kind",
          "trailDurationSeconds",
          "drawRangeTdbSeconds",
          "drawEpochTdbSeconds",
          "drawRelativeStart",
          "drawRelativeEnd",
          "breakIndices",
        ].includes(k),
    )
  )
    throw Error("invalid trajectory style");
  if (
    (style.referenceOrientation !== undefined &&
      typeof style.referenceOrientation !== "boolean") ||
    (style.referenceOrientation === true &&
      (typeof style.originId !== "string" || !style.originId)) ||
    (style.visibleInterval !== undefined &&
      !["AlwaysVisible", "DefaultVisibleFar"].includes(style.visibleInterval))
  )
    throw Error("invalid trajectory reference");
  if (
    (style.drawEpochTdbSeconds !== undefined &&
      !Number.isFinite(style.drawEpochTdbSeconds)) ||
    (style.drawRelativeStart !== undefined &&
      typeof style.drawRelativeStart !== "boolean") ||
    (style.drawRelativeEnd !== undefined &&
      typeof style.drawRelativeEnd !== "boolean") ||
    ((style.drawRelativeStart || style.drawRelativeEnd) &&
      (style.drawRangeTdbSeconds === undefined ||
        style.drawEpochTdbSeconds === undefined))
  )
    throw Error("invalid relative trajectory draw range");
  if (
    style.drawRangeTdbSeconds !== undefined &&
    (style.kind !== "trail" ||
      !Array.isArray(style.drawRangeTdbSeconds) ||
      style.drawRangeTdbSeconds.length !== 2 ||
      !style.drawRangeTdbSeconds.every(Number.isFinite) ||
      style.drawRangeTdbSeconds[0] >= style.drawRangeTdbSeconds[1])
  )
    throw Error("invalid trajectory draw range");
  if (style.kind !== undefined && !["orbit", "trail"].includes(style.kind))
    throw Error("invalid trajectory kind");
  if (
    style.kind === "trail"
      ? !Number.isFinite(style.trailDurationSeconds) ||
        style.trailDurationSeconds! < 1 ||
        style.trailDurationSeconds! > MAX_TRAIL_DURATION_SECONDS
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
    ...(style.drawRangeTdbSeconds
      ? {
          drawRangeTdbSeconds: Object.freeze([
            ...style.drawRangeTdbSeconds,
          ]) as readonly [number, number],
        }
      : {}),
    ...(conic ? { conic } : {}),
    ...(style.breakIndices
      ? { breakIndices: Object.freeze([...style.breakIndices]) }
      : {}),
  });
}
