import { axis, type Vec3 } from "./eyes-orientation.ts";
export interface JointAim {
  joint: string;
  hingeAxis: Vec3;
  normalAxis: Vec3;
  targetDirectionIcrf: Vec3;
}
/** Compile the supported source controller subset without evaluating source expressions. */
export function compileJointAims(
  controllers: readonly any[],
  epoch: number,
  self: Vec3,
  position: (id: string) => Vec3,
): JointAim[] {
  const result: JointAim[] = [];
  const names = new Set<string>();
  for (const c of controllers) {
    if (c.type !== "align" || !c.joint) continue;
    if (
      c.coverage &&
      (epoch < Number(c.coverage[0]) || epoch > Number(c.coverage[1]))
    )
      continue;
    if (
      !Number.isFinite(epoch) ||
      c.primary?.type !== "none" ||
      c.secondary?.type !== "point" ||
      c.secondary.target !== "sun"
    )
      throw Error("Unsupported joint alignment");
    if (
      typeof c.joint !== "string" ||
      names.has(c.joint) ||
      result.length >= 32
    )
      throw Error("Joint budget or duplicate name");
    const hingeAxis = axis(c.primary.axis, [1, 0, 0]);
    const normalAxis = axis(c.secondary.axis, [0, 1, 0]);
    if (
      Math.abs(hingeAxis.reduce((sum, v, i) => sum + v * normalAxis[i], 0)) >
      1e-6
    )
      throw Error("Joint axes must be perpendicular");
    const target = position(c.secondary.target);
    const delta = target.map((v, i) => v - self[i]);
    const length = Math.hypot(...delta);
    if (!Number.isFinite(length) || length < 1e-14)
      throw Error("Joint target direction unavailable");
    names.add(c.joint);
    result.push({
      joint: c.joint,
      hingeAxis,
      normalAxis,
      targetDirectionIcrf: delta.map((v) => v / length) as unknown as Vec3,
    });
  }
  return result;
}
