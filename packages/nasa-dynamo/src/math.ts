// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Quaternion with named components; `.dyn` files store them as w, x, y, z. */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const identityQuat = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

export function scale(value: Vec3, factor: number): Vec3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

export function mix(start: Vec3, end: Vec3, fraction: number): Vec3 {
  return {
    x: (1 - fraction) * start.x + fraction * end.x,
    y: (1 - fraction) * start.y + fraction * end.y,
    z: (1 - fraction) * start.z + fraction * end.z,
  };
}

export function isFiniteVec(value: Vec3): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

export function isFiniteQuat(value: Quat): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z) &&
    Number.isFinite(value.w)
  );
}

export function quatScale(value: Quat): number {
  return Math.max(
    Math.abs(value.w),
    Math.abs(value.x),
    Math.abs(value.y),
    Math.abs(value.z),
  );
}

export function quatLength(value: Quat): number {
  return Math.hypot(value.w, value.x, value.y, value.z);
}

/**
 * Normalize by the largest component first so subnormal or huge finite
 * quaternions keep their rotation instead of rounding or overflowing.
 */
export function normalizeQuat(value: Quat): Quat {
  const maximum = quatScale(value);
  if (!Number.isFinite(maximum) || maximum === 0) {
    throw new RangeError("cannot normalize an empty or non-finite quaternion");
  }
  const w = value.w / maximum;
  const x = value.x / maximum;
  const y = value.y / maximum;
  const z = value.z / maximum;
  const length = Math.hypot(w, x, y, z);
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

/** Active rotation of a vector by a unit quaternion. */
export function rotateByQuat(value: Vec3, quaternion: Quat): Vec3 {
  const { x, y, z, w } = quaternion;
  const tx = 2 * (y * value.z - z * value.y);
  const ty = 2 * (z * value.x - x * value.z);
  const tz = 2 * (x * value.y - y * value.x);
  return {
    x: value.x + w * tx + (y * tz - z * ty),
    y: value.y + w * ty + (z * tx - x * tz),
    z: value.z + w * tz + (x * ty - y * tx),
  };
}

/** Hamilton product; `a * b` applies `b` first when used as a rotation. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function quatConjugate(value: Quat): Quat {
  return { x: -value.x, y: -value.y, z: -value.z, w: value.w };
}

export function direction(value: Vec3): Vec3 {
  const maximum = Math.max(
    Math.abs(value.x),
    Math.abs(value.y),
    Math.abs(value.z),
  );
  if (!Number.isFinite(maximum) || maximum === 0) {
    throw new RangeError("cannot normalize an empty or non-finite vector");
  }
  const x = value.x / maximum;
  const y = value.y / maximum;
  const z = value.z / maximum;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

/** Shortest-path quaternion interpolation with the reference linear threshold. */
export function slerpQuat(start: Quat, end: Quat, fraction: number): Quat {
  const first = normalizeQuat(start);
  const last = normalizeQuat(end);
  const dot =
    first.w * last.w + first.x * last.x + first.y * last.y + first.z * last.z;
  const sign = dot < 0 ? -1 : 1;
  const angle = Math.acos(clamp(Math.abs(dot), 0, 1));
  const spherical = Math.abs(dot) <= 0.9995;
  const startWeight =
    sign *
    (spherical
      ? Math.sin((1 - fraction) * angle) / Math.sin(angle)
      : 1 - fraction);
  const endWeight = spherical
    ? Math.sin(fraction * angle) / Math.sin(angle)
    : fraction;
  return normalizeQuat({
    w: startWeight * first.w + endWeight * last.w,
    x: startWeight * first.x + endWeight * last.x,
    y: startWeight * first.y + endWeight * last.y,
    z: startWeight * first.z + endWeight * last.z,
  });
}

/**
 * Interpolate vector directions spherically while interpolating magnitudes
 * linearly. Exactly opposite directions fall back to the linear limit.
 */
export function slerpVector(start: Vec3, end: Vec3, fraction: number): Vec3 {
  const startLength = Math.hypot(start.x, start.y, start.z);
  const endLength = Math.hypot(end.x, end.y, end.z);
  if (startLength === 0 || endLength === 0) {
    return mix(start, end, fraction);
  }
  const first = direction(start);
  const last = direction(end);
  const cosine = clamp(
    first.x * last.x + first.y * last.y + first.z * last.z,
    -1,
    1,
  );
  const angle = Math.acos(cosine);
  if (angle <= 0.01745327777 || cosine < -1 + 1e-12) {
    return mix(start, end, fraction);
  }
  const startWeight = Math.sin((1 - fraction) * angle) / Math.sin(angle);
  const endWeight = Math.sin(fraction * angle) / Math.sin(angle);
  const length = (1 - fraction) * startLength + fraction * endLength;
  return {
    x: (first.x * startWeight + last.x * endWeight) * length,
    y: (first.y * startWeight + last.y * endWeight) * length,
    z: (first.z * startWeight + last.z * endWeight) * length,
  };
}
