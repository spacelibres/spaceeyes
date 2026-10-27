// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import { normalizeQuat, rotateByQuat, vec3, type Vec3 } from "./math.js";
import type { DynPoint, OrbPoint } from "./parse.js";

const TWO_PI = Math.PI * 2;

/**
 * Solve Kepler's equation `M = E - e sin(E)` for elliptic elements.
 * This tight solver is for orbit geometry; the ephemeris evaluator keeps the
 * reference-compatible iteration limit and threshold separately.
 */
export function solveEccentricAnomaly(
  meanAnomaly: number,
  eccentricity: number,
): number {
  let mean = meanAnomaly % TWO_PI;
  if (mean > Math.PI) mean -= TWO_PI;
  if (mean < -Math.PI) mean += TWO_PI;

  let anomaly = mean;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const residual = anomaly - eccentricity * Math.sin(anomaly) - mean;
    const derivative = 1 - eccentricity * Math.cos(anomaly);
    const step = residual / derivative;
    anomaly -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return anomaly;
}

/** Position of an elliptic `orb` sample at `time`, in kilometers. */
export function orbPositionAt(point: OrbPoint, time: number): Vec3 | null {
  const { semiMajorAxis, eccentricity, meanAngularMotion, meanAnomalyAtEpoch } =
    point;
  if (
    !Number.isFinite(semiMajorAxis) ||
    !Number.isFinite(eccentricity) ||
    !Number.isFinite(meanAngularMotion) ||
    !Number.isFinite(meanAnomalyAtEpoch) ||
    semiMajorAxis <= 0 ||
    eccentricity < 0 ||
    eccentricity >= 1
  ) {
    return null;
  }
  const mean = meanAnomalyAtEpoch + meanAngularMotion * (time - point.time);
  if (!Number.isFinite(mean)) return null;
  const anomaly = solveEccentricAnomaly(mean, eccentricity);
  if (!Number.isFinite(anomaly)) return null;
  const cosine = Math.cos(anomaly);
  const sine = Math.sin(anomaly);
  const local = vec3(
    semiMajorAxis * (cosine - eccentricity),
    semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity) * sine,
    0,
  );
  const position = rotateByQuat(local, normalizeQuat(point.orientation));
  return Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z)
    ? position
    : null;
}

/**
 * Nearest sample epoch. `orb` elements are osculating at their own epoch, so
 * nearest-epoch propagation minimizes error for orbit-line rendering.
 */
export function nearestPoint<T extends DynPoint>(
  points: readonly T[],
  time: number,
): T | null {
  if (points.length === 0) return null;
  let lower = 0;
  let upper = points.length - 1;
  while (upper - lower > 1) {
    const middle = (lower + upper) >> 1;
    const candidate = points[middle];
    if (candidate === undefined) return null;
    if (candidate.time <= time) lower = middle;
    else upper = middle - 1;
  }
  const first = points[lower];
  const last = points[upper];
  if (first === undefined || last === undefined) return null;
  return Math.abs(first.time - time) <= Math.abs(last.time - time)
    ? first
    : last;
}
