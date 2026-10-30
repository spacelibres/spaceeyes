/** Display intent only. Coordinates/epochs remain authored by the data plugin. */
export type TrajectoryStyle = {
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
  return Object.freeze({
    ...style,
    ...(style.breakIndices
      ? { breakIndices: Object.freeze([...style.breakIndices]) }
      : {}),
  });
}
