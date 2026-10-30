import type { DecodedDyn, DynOrbRecord } from "./dyn-decoder.ts";
type V = [number, number, number];
function rotate(v: V, q: readonly number[]): V {
  const [w, x, y, z] = q;
  const t: V = [
    2 * (y * v[2] - z * v[1]),
    2 * (z * v[0] - x * v[2]),
    2 * (x * v[1] - y * v[0]),
  ];
  return [
    v[0] + w * t[0] + y * t[2] - z * t[1],
    v[1] + w * t[1] + z * t[0] - x * t[2],
    v[2] + w * t[2] + x * t[1] - y * t[0],
  ];
}
export function propagateState(
  r: DynOrbRecord,
  t: number,
): { position: V; velocity: V } {
  const e = r.eccentricity,
    a = r.semiMajorAxis;
  if (e < 0 || e === 1 || a === 0) throw Error("Unsupported degenerate orbit");
  if (e > 1) {
    const m = r.meanAnomalyAtEpoch + r.meanAngularMotion * (t - r.time);
    let h = Math.asinh(m / e);
    for (let i = 0; i < 100; i++) {
      const d = (e * Math.sinh(h) - h - m) / (e * Math.cosh(h) - 1);
      h -= d;
      if (Math.abs(d) < 1e-12) break;
    }
    const radius = -a * (1 - e * Math.cosh(h));
    const k = (r.meanAngularMotion * a * a) / radius;
    const position = rotate(
      [a * (e - Math.cosh(h)), a * Math.sqrt(e * e - 1) * Math.sinh(h), 0],
      r.orientation,
    );
    const velocity = rotate(
      [-k * Math.sinh(h), k * Math.sqrt(e * e - 1) * Math.cosh(h), 0],
      r.orientation,
    );
    if (![...position, ...velocity].every(Number.isFinite))
      throw Error("Invalid hyperbolic state");
    return { position, velocity };
  }
  if (a <= 0) throw Error("Invalid elliptic semi-major axis");
  let m = r.meanAnomalyAtEpoch + r.meanAngularMotion * (t - r.time);
  m =
    ((((m + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  let E = m;
  for (let i = 0; i < 20; i++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 0.00174532925) break;
  }
  const rate = r.meanAngularMotion / (1 - e * Math.cos(E));
  return {
    position: rotate(
      [a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), 0],
      r.orientation,
    ),
    velocity: rotate(
      [
        -a * Math.sin(E) * rate,
        a * Math.sqrt(1 - e * e) * Math.cos(E) * rate,
        0,
      ],
      r.orientation,
    ),
  };
}
/** Recovered Eyes algorithm; segment-interior errors of thousands of km are documented. */
export function evaluateOrb(d: DecodedDyn, t: number, body = 0): V {
  if (d.kind === "inline" && (d.type === "pos" || d.type === "lin")) {
    if (!Number.isFinite(t) || t < d.coverage.start || t > d.coverage.end)
      throw Error("Outside DYN coverage");
    let i = 0;
    while (i < d.records.length - 2 && d.records[i + 1].time <= t) i++;
    const a = d.records[i],
      b = d.records[i + 1],
      dt = b.time - a.time,
      u = (t - a.time) / dt;
    if (d.type === "lin")
      return a.position.map((v, j) => v + (b.position[j] - v) * u) as V;
    return a.position.map(
      (v, j) =>
        (2 * u * u * u - 3 * u * u + 1) * v +
        (u * u * u - 2 * u * u + u) * dt * a.velocity[j] +
        (-2 * u * u * u + 3 * u * u) * b.position[j] +
        (u * u * u - u * u) * dt * b.velocity[j],
    ) as V;
  }
  if (d.kind !== "inline" || d.type !== "orb")
    throw Error("Orb segment required");
  if (!Number.isFinite(t) || t < d.coverage.start || t > d.coverage.end)
    throw Error("Outside DYN coverage");
  let lo = 0,
    hi = d.records.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d.records[mid].time <= t) lo = mid;
    else hi = mid;
  }
  const a = d.records[lo],
    b = d.records[hi],
    u = (t - a.time) / (b.time - a.time),
    p = propagateState(a, t).position,
    q = propagateState(b, t).position;
  const mu1 = d.gravitationalParameter1!,
    mu2 = d.gravitationalParameter2!;
  const scale =
    body === 0
      ? 1
      : body === 1
        ? mu2 / (mu1 + mu2)
        : body === 2
          ? -mu1 / (mu1 + mu2)
          : NaN;
  if (!Number.isFinite(scale)) throw Error("Invalid body");
  return p.map((v, i) => (v + (q[i] - v) * u) * scale) as V;
}
/** Eyes OrbPoint blends propagated endpoint velocities, not the derivative of the blended positions. */
export function evaluateOrbVelocity(d: DecodedDyn, t: number): V {
  if (
    d.kind !== "inline" ||
    d.type !== "orb" ||
    !Number.isFinite(t) ||
    t < d.coverage.start ||
    t > d.coverage.end
  )
    throw Error("Outside DYN coverage");
  let lo = 0,
    hi = d.records.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d.records[mid].time <= t) lo = mid;
    else hi = mid;
  }
  const a = d.records[lo],
    b = d.records[hi],
    u = (t - a.time) / (b.time - a.time);
  const p = propagateState(a, t).velocity,
    q = propagateState(b, t).velocity;
  return p.map((v, i) => v + (q[i] - v) * u) as V;
}
/** Nonincremental recovered Eyes attitude: propagate both endpoints then slerp. */
export function evaluateOri(
  d: DecodedDyn,
  t: number,
): [number, number, number, number] {
  if (
    d.kind !== "inline" ||
    d.type !== "ori" ||
    t < d.coverage.start ||
    t > d.coverage.end
  )
    throw Error("Outside orientation coverage");
  const mul = (a: readonly number[], b: readonly number[]): number[] => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  let i = 0;
  while (i < d.records.length - 2 && d.records[i + 1].time <= t) i++;
  const a = d.records[i],
    b = d.records[i + 1];
  const advance = (r: typeof a) => {
    const w = r.angularVelocity,
      n = Math.hypot(...w),
      h = (-n * (t - r.time)) / 2,
      k = n ? Math.sin(h) / n : 0;
    return mul(r.orientation, [Math.cos(h), w[0] * k, w[1] * k, w[2] * k]);
  };
  const p = advance(a),
    q = advance(b),
    u = (t - a.time) / (b.time - a.time);
  let dot = p.reduce((v, x, j) => v + x * q[j], 0);
  if (dot < 0) {
    dot = -dot;
    for (let j = 0; j < 4; j++) q[j] *= -1;
  }
  dot = Math.min(1, dot);
  const angle = Math.acos(dot),
    s = Math.sin(angle);
  const out = p.map((x, j) =>
    s > 1e-8
      ? (x * Math.sin((1 - u) * angle) + q[j] * Math.sin(u * angle)) / s
      : x * (1 - u) + q[j] * u,
  );
  const n = Math.hypot(...out);
  if (!n) throw Error("Invalid quaternion");
  return out.map((v) => v / n) as [number, number, number, number];
}
