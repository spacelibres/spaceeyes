// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import {
  direction,
  isFiniteVec,
  mix,
  normalizeQuat,
  quatMultiply,
  quatScale,
  rotateByQuat,
  scale,
  slerpQuat,
  slerpVector,
  vec3,
  type Quat,
  type Vec3,
} from "./math.js";
import type {
  DynHeader,
  DynPoint,
  OrbPoint,
  OriPoint,
  PointType,
} from "./parse.js";

export interface EphemerisSource {
  readonly path: string;
  readonly segment: string | null;
}

export interface EphemerisWindow {
  readonly header: DynHeader;
  readonly points: readonly DynPoint[];
  readonly interval: { readonly min: number; readonly max: number };
  readonly source?: EphemerisSource;
}

export type EphemerisState =
  | {
      readonly status: "ready";
      readonly kind: "position";
      readonly position: Vec3;
      readonly velocity: Vec3;
    }
  | {
      readonly status: "ready";
      readonly kind: "orientation";
      readonly orientation: Quat;
      readonly angularVelocity: Vec3;
    }
  | {
      readonly status: "unavailable";
      readonly reason: "out-of-range" | "invalid-samples" | "unsupported-orbit";
    };

export interface EvaluateOptions {
  /** Omitted means the orbit is relative to its parent. */
  readonly body?: 1 | 2;
}

const unavailable = (
  reason: Extract<EphemerisState, { status: "unavailable" }>["reason"],
): EphemerisState => ({ status: "unavailable", reason });

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

function validSample(point: DynPoint): boolean {
  if (!Number.isFinite(point.time)) return false;
  if (point.kind === "pos") {
    return isFiniteVec(point.position) && isFiniteVec(point.velocity);
  }
  if (point.kind === "lin") return isFiniteVec(point.position);
  if (point.kind === "ori") {
    return (
      isFiniteVec(point.angularVelocity) &&
      Number.isFinite(quatScale(point.orientation)) &&
      quatScale(point.orientation) > 0
    );
  }
  if (point.kind === "quat") {
    return (
      Number.isFinite(quatScale(point.orientation)) &&
      quatScale(point.orientation) > 0
    );
  }
  return (
    Number.isFinite(point.semiMajorAxis) &&
    Number.isFinite(point.eccentricity) &&
    Number.isFinite(point.meanAngularMotion) &&
    Number.isFinite(point.meanAnomalyAtEpoch) &&
    Number.isFinite(quatScale(point.orientation)) &&
    quatScale(point.orientation) > 0
  );
}

/**
 * Project an `ori` sample to `time` using `q * conj(axisAngle(omega, dt))`,
 * matching the verified reference semantics.
 */
function projectOrientation(point: OriPoint, time: number): Quat {
  const first = normalizeQuat(point.orientation);
  const magnitude = Math.hypot(
    point.angularVelocity.x,
    point.angularVelocity.y,
    point.angularVelocity.z,
  );
  if (magnitude === 0) return first;
  const halfAngle = (magnitude * (time - point.time)) / 2;
  const axis = direction(point.angularVelocity);
  const sine = -Math.sin(halfAngle);
  const delta: Quat = {
    w: Math.cos(halfAngle),
    x: axis.x * sine,
    y: axis.y * sine,
    z: axis.z * sine,
  };
  return normalizeQuat(quatMultiply(first, delta));
}

const KEPLER_ITERATIONS = 20;
const KEPLER_TOLERANCE = 0.00174532925;

/**
 * Project osculating `orb` elements to `time`. The iteration limit and
 * tolerance are retained for differential compatibility with the reference,
 * not as a precision guarantee.
 */
function projectOrbit(
  point: OrbPoint,
  time: number,
): { readonly position: Vec3; readonly velocity: Vec3 } | null {
  const { eccentricity, semiMajorAxis, meanAngularMotion } = point;
  if (
    !Number.isFinite(semiMajorAxis) ||
    !Number.isFinite(eccentricity) ||
    !Number.isFinite(meanAngularMotion) ||
    !Number.isFinite(point.meanAnomalyAtEpoch) ||
    semiMajorAxis <= 0 ||
    eccentricity < 0 ||
    eccentricity === 1
  ) {
    return null;
  }
  const elliptic = eccentricity < 1;
  let mean = point.meanAnomalyAtEpoch + meanAngularMotion * (time - point.time);
  if (!Number.isFinite(mean)) return null;
  if (elliptic) {
    mean = ((mean + Math.PI) % (2 * Math.PI)) - Math.PI;
    if (mean < -Math.PI) mean += 2 * Math.PI;
  }
  let anomaly = elliptic
    ? eccentricity >= 0.8
      ? Math.sign(mean) * Math.PI
      : mean
    : Math.log((2 * Math.abs(mean)) / Math.E + 1.8) * (mean < 0 ? -1 : 1);
  let converged = false;
  for (let iteration = 0; iteration < KEPLER_ITERATIONS; iteration += 1) {
    const correction = elliptic
      ? (anomaly - eccentricity * Math.sin(anomaly) - mean) /
        (eccentricity * Math.cos(anomaly) - 1)
      : (anomaly - eccentricity * Math.sinh(anomaly) + mean) /
        (eccentricity * Math.cosh(anomaly) - 1);
    anomaly += correction;
    if (!Number.isFinite(anomaly)) return null;
    if (Math.abs(correction) < KEPLER_TOLERANCE) {
      converged = true;
      break;
    }
  }
  if (!converged) return null;

  const cosine = elliptic ? Math.cos(anomaly) : Math.cosh(anomaly);
  const sine = elliptic ? Math.sin(anomaly) : Math.sinh(anomaly);
  const minorRatio = Math.sqrt(
    elliptic
      ? 1 - eccentricity * eccentricity
      : eccentricity * eccentricity - 1,
  );
  // The reference stores a positive semi-major-axis magnitude for hyperbolas.
  const radius =
    (elliptic ? 1 : -1) * semiMajorAxis * (1 - eccentricity * cosine);
  const velocityScale =
    (meanAngularMotion * semiMajorAxis * semiMajorAxis) / radius;
  const orientation = normalizeQuat(point.orientation);
  const position = rotateByQuat(
    vec3(
      semiMajorAxis *
        (elliptic ? cosine - eccentricity : eccentricity - cosine),
      semiMajorAxis * minorRatio * sine,
      0,
    ),
    orientation,
  );
  const velocity = rotateByQuat(
    vec3(-velocityScale * sine, velocityScale * minorRatio * cosine, 0),
    orientation,
  );
  if (
    !isFiniteVec(position) ||
    !isFiniteVec(velocity) ||
    !Number.isFinite(velocityScale)
  ) {
    return null;
  }
  return { position, velocity };
}

/**
 * Evaluate one ephemeris window at an ET value.
 *
 * Valid queries are the intersection of window coverage and sample coverage.
 * Endpoints are accepted; there is no extrapolation or stale fallback.
 */
export function evaluateEphemeris(
  window: EphemerisWindow,
  time: number,
  options: EvaluateOptions = {},
): EphemerisState {
  const { points, interval, header } = window;
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(interval.min) ||
    !Number.isFinite(interval.max) ||
    interval.min > interval.max ||
    points.length < 2
  ) {
    return unavailable("invalid-samples");
  }
  let previous = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (
      point.kind !== header.pointType ||
      !validSample(point) ||
      point.time <= previous
    ) {
      return unavailable("invalid-samples");
    }
    previous = point.time;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) {
    return unavailable("invalid-samples");
  }
  if (
    time < interval.min ||
    time > interval.max ||
    time < first.time ||
    time > last.time
  ) {
    return unavailable("out-of-range");
  }

  let lower = 0;
  let upper = points.length - 2;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    const candidate = points[middle];
    if (candidate === undefined) return unavailable("invalid-samples");
    if (candidate.time <= time) lower = middle;
    else upper = middle - 1;
  }
  const start = points[lower];
  const end = points[lower + 1];
  if (start === undefined || end === undefined) {
    return unavailable("invalid-samples");
  }
  const duration = end.time - start.time;
  if (!Number.isFinite(duration) || duration <= 0) {
    return unavailable("invalid-samples");
  }
  const fraction = clamp((time - start.time) / duration, 0, 1);

  let result: EphemerisState;
  if (start.kind === "pos" && end.kind === "pos") {
    const remaining = 1 - fraction;
    const square = fraction * fraction;
    const position = vec3(
      (1 + 2 * fraction) * remaining * remaining * start.position.x +
        duration * fraction * remaining * remaining * start.velocity.x +
        square * (3 - 2 * fraction) * end.position.x -
        duration * square * remaining * end.velocity.x,
      (1 + 2 * fraction) * remaining * remaining * start.position.y +
        duration * fraction * remaining * remaining * start.velocity.y +
        square * (3 - 2 * fraction) * end.position.y -
        duration * square * remaining * end.velocity.y,
      (1 + 2 * fraction) * remaining * remaining * start.position.z +
        duration * fraction * remaining * remaining * start.velocity.z +
        square * (3 - 2 * fraction) * end.position.z -
        duration * square * remaining * end.velocity.z,
    );
    const velocity = vec3(
      ((6 * (square - fraction)) / duration) * start.position.x +
        (3 * square - 4 * fraction + 1) * start.velocity.x -
        ((6 * (square - fraction)) / duration) * end.position.x +
        (3 * square - 2 * fraction) * end.velocity.x,
      ((6 * (square - fraction)) / duration) * start.position.y +
        (3 * square - 4 * fraction + 1) * start.velocity.y -
        ((6 * (square - fraction)) / duration) * end.position.y +
        (3 * square - 2 * fraction) * end.velocity.y,
      ((6 * (square - fraction)) / duration) * start.position.z +
        (3 * square - 4 * fraction + 1) * start.velocity.z -
        ((6 * (square - fraction)) / duration) * end.position.z +
        (3 * square - 2 * fraction) * end.velocity.z,
    );
    result = { status: "ready", kind: "position", position, velocity };
  } else if (start.kind === "lin" && end.kind === "lin") {
    const velocity = vec3(
      (end.position.x - start.position.x) / duration,
      (end.position.y - start.position.y) / duration,
      (end.position.z - start.position.z) / duration,
    );
    result = {
      status: "ready",
      kind: "position",
      position: mix(start.position, end.position, fraction),
      velocity,
    };
  } else if (start.kind === "quat" && end.kind === "quat") {
    result = {
      status: "ready",
      kind: "orientation",
      orientation: slerpQuat(start.orientation, end.orientation, fraction),
      angularVelocity: vec3(0, 0, 0),
    };
  } else if (start.kind === "ori" && end.kind === "ori") {
    const orientation = slerpQuat(
      projectOrientation(start, time),
      projectOrientation(end, time),
      fraction,
    );
    const interpolated = slerpVector(
      start.angularVelocity,
      end.angularVelocity,
      fraction,
    );
    result = {
      status: "ready",
      kind: "orientation",
      orientation,
      angularVelocity: rotateByQuat(scale(interpolated, -1), orientation),
    };
  } else if (start.kind === "orb" && end.kind === "orb") {
    const first = projectOrbit(start, time);
    const last = projectOrbit(end, time);
    if (first === null || last === null)
      return unavailable("unsupported-orbit");
    let factor = 1;
    if (options.body !== undefined) {
      const primary =
        header.gravitationalParameter1 ?? (options.body === 1 ? 0 : 1);
      const central =
        header.gravitationalParameter2 ?? (options.body === 1 ? 1 : 0);
      if (
        !Number.isFinite(primary) ||
        !Number.isFinite(central) ||
        primary < 0 ||
        central < 0 ||
        primary + central === 0
      ) {
        return unavailable("invalid-samples");
      }
      factor =
        options.body === 1
          ? central / (primary + central)
          : -primary / (primary + central);
    }
    result = {
      status: "ready",
      kind: "position",
      position: scale(mix(first.position, last.position, fraction), factor),
      velocity: scale(mix(first.velocity, last.velocity, fraction), factor),
    };
  } else {
    return unavailable("invalid-samples");
  }

  if (result.kind === "position") {
    return isFiniteVec(result.position) && isFiniteVec(result.velocity)
      ? result
      : unavailable("invalid-samples");
  }
  return Number.isFinite(quatScale(result.orientation)) &&
    quatScale(result.orientation) > 0 &&
    isFiniteVec(result.angularVelocity)
    ? result
    : unavailable("invalid-samples");
}

/** Build a window from a parsed inline file, or `null` when it carries none. */
export function windowFromFile(
  header: DynHeader,
  points: readonly DynPoint[],
  interval: { readonly min: number; readonly max: number } | null,
  source?: EphemerisSource,
): EphemerisWindow | null {
  if (interval === null) return null;
  return source === undefined
    ? { header, points, interval }
    : { header, points, interval, source };
}

/** Point types accepted by the evaluator, exposed for capability discovery. */
export const EVALUATED_POINT_TYPES: readonly PointType[] = [
  "orb",
  "pos",
  "lin",
  "ori",
  "quat",
];
