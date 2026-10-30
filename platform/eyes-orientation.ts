export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
export interface OrientationRefs {
  position(id: string): Vec3;
  /** Source Entity.getVelocityAtTime: target track velocity in ICRF axes,
   * relative to its declared parent; do not add ancestor velocities here.
   * AlignController calls this directly, not getVelocityRelativeToEntity.
   */
  velocity(id: string): Vec3;
  orientation(id: string): Quat;
}
export interface AlignRule {
  type: "none" | "point" | "velocity" | "align";
  axis?: unknown;
  target?: string;
  targetAxis?: unknown;
}
export interface EntityAlignController {
  type: "align";
  primary?: AlignRule;
  secondary?: AlignRule;
  coverage?: readonly (number | string)[];
  joint?: string;
}
function fail(reason: string): never {
  throw Error("Orientation " + reason);
}
function vector(v: readonly number[]): Vec3 {
  if (v.length !== 3 || !v.every(Number.isFinite)) fail("invalid vector");
  return [v[0], v[1], v[2]];
}
const dot = (a: Vec3, b: Vec3) => a.reduce((n, x, i) => n + x * b[i], 0);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function unit(v: Vec3): Vec3 {
  const n = Math.hypot(...v);
  if (!Number.isFinite(n) || n < 1e-14) fail("zero vector or collinear axes");
  return v.map((x) => x / n) as unknown as Vec3;
}
export function normalizeOrientation(value: readonly number[]): Quat {
  if (value.length !== 4 || !value.every(Number.isFinite))
    fail("invalid quaternion");
  const n = Math.hypot(...value);
  if (!Number.isFinite(n) || n < 1e-14) fail("zero quaternion");
  return value.map((x) => x / n) as unknown as Quat;
}
function mult(a: Quat, b: Quat): Quat {
  const [w, x, y, z] = a,
    [W, X, Y, Z] = b;
  return normalizeOrientation([
    w * W - x * X - y * Y - z * Z,
    w * X + x * W + y * Z - z * Y,
    w * Y - x * Z + y * W + z * X,
    w * Z + x * Y - y * X + z * W,
  ]);
}
function rotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[1], q[2], q[3]],
    a = cross(u, v),
    b = cross(u, a);
  return v.map((x, i) => x + 2 * (q[0] * a[i] + b[i])) as unknown as Vec3;
}
function axis(value: unknown, fallback: Vec3): Vec3 {
  if (value === undefined) return fallback;
  if (!value || typeof value !== "object") fail("unknown axis");
  const a = value as {
    expression?: unknown;
    constructor?: unknown;
    values?: unknown;
  };
  if (typeof a.expression === "string") {
    const match = /^Pioneer\.Vector3\.([XYZ])Axis(Neg)?$/.exec(a.expression);
    if (!match) fail("unknown axis expression");
    const out = [0, 0, 0];
    out["XYZ".indexOf(match[1])] = match[2] ? -1 : 1;
    return out as unknown as Vec3;
  }
  if (a.constructor !== "Vector3" || !Array.isArray(a.values))
    fail("unknown axis constructor");
  const values = a.values.map((x) => {
    if (typeof x === "number") return x;
    if (x && typeof x === "object" && Object.keys(x).length === 1) {
      if (x.expression === "Math.sqrt(.5)") return Math.SQRT1_2;
      if (x.expression === "-Math.sqrt(.5)") return -Math.SQRT1_2;
    }
    return fail("unknown axis expression");
  });
  return unit(vector(values));
}
export function isEntityAlign(
  controller: unknown,
): controller is EntityAlignController {
  if (
    !controller ||
    typeof controller !== "object" ||
    (controller as EntityAlignController).type !== "align"
  )
    return false;
  const joint = (controller as EntityAlignController).joint;
  if (joint !== undefined && typeof joint !== "string") fail("invalid joint");
  return joint === undefined || joint === "";
}
function kind(rule?: AlignRule) {
  const type = rule?.type ?? "none";
  if (!["none", "point", "velocity", "align"].includes(type))
    fail("unsupported align type");
  return type;
}
export function entityAlignDependencies(
  c: EntityAlignController,
): readonly { id: string; state: "position" | "velocity" | "orientation" }[] {
  if (!isEntityAlign(c)) fail("joint controller is not entity orientation");
  const out: { id: string; state: "position" | "velocity" | "orientation" }[] =
    [];
  for (const rule of [c.primary, c.secondary]) {
    const type = kind(rule);
    if (type === "none") continue;
    if (!rule?.target || typeof rule.target !== "string")
      fail("missing target");
    const state =
      type === "point"
        ? "position"
        : type === "align"
          ? "orientation"
          : "velocity";
    if (!out.some((v) => v.id === rule.target && v.state === state))
      out.push({ id: rule.target, state });
  }
  return out;
}
export function applyEntityAlign(
  currentQuaternion: readonly number[],
  controller: EntityAlignController,
  selfPosition: Vec3,
  refs: OrientationRefs,
): Quat {
  if (!isEntityAlign(controller))
    fail("joint controller is not entity orientation");
  entityAlignDependencies(controller);
  let q = normalizeOrientation(currentQuaternion);
  const self = vector(selfPosition);
  const target = (
    rule: AlignRule | undefined,
    fallback: Vec3,
    defaultAxis: Vec3,
  ): Vec3 => {
    const type = kind(rule);
    if (type === "none") return fallback;
    const id = rule!.target!;
    if (type === "point") {
      const p = vector(refs.position(id));
      return unit(p.map((x, i) => x - self[i]) as unknown as Vec3);
    }
    if (type === "velocity") return unit(vector(refs.velocity(id)));
    return unit(
      rotate(
        normalizeOrientation(refs.orientation(id)),
        axis(rule!.targetAxis, defaultAxis),
      ),
    );
  };
  const local = axis(controller.primary?.axis, [1, 0, 0]);
  const from = unit(rotate(q, local));
  const to = target(controller.primary, from, [1, 0, 0]);
  const d = Math.max(-1, Math.min(1, dot(from, to)));
  if (d < 1 - 1e-14) {
    let turn: Quat;
    if (d < -1 + 1e-12) {
      const basis: Vec3 =
        Math.abs(from[0]) <= Math.abs(from[1]) &&
        Math.abs(from[0]) <= Math.abs(from[2])
          ? [1, 0, 0]
          : Math.abs(from[1]) <= Math.abs(from[2])
            ? [0, 1, 0]
            : [0, 0, 1];
      const a = unit(cross(from, basis));
      turn = [0, ...a];
    } else {
      const a = cross(from, to);
      turn = normalizeOrientation([1 + d, ...a]);
    }
    q = mult(turn, q);
  }
  if (kind(controller.secondary) !== "none") {
    const primary = unit(rotate(q, local)),
      secondary = rotate(q, axis(controller.secondary?.axis, [0, 1, 0]));
    const desired = target(controller.secondary, primary, [0, 1, 0]);
    const project = (v: Vec3) =>
      unit(
        v.map((x, i) => x - dot(v, primary) * primary[i]) as unknown as Vec3,
      );
    const a = project(secondary),
      b = project(desired);
    const angle = Math.atan2(dot(primary, cross(a, b)), dot(a, b));
    const sine = Math.sin(angle / 2);
    q = mult(
      [
        Math.cos(angle / 2),
        primary[0] * sine,
        primary[1] * sine,
        primary[2] * sine,
      ],
      q,
    );
  }
  return q;
}
