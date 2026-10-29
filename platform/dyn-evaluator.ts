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
function propagate(r: DynOrbRecord, t: number): V {
  const e = r.eccentricity,
    a = r.semiMajorAxis;
  if (e < 0 || e >= 1 || a <= 0) throw Error("Unsupported nonelliptic orbit");
  let m = r.meanAnomalyAtEpoch + r.meanAngularMotion * (t - r.time);
  m =
    ((((m + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  let E = m;
  for (let i = 0; i < 20; i++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 0.00174532925) break;
  }
  return rotate(
    [a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), 0],
    r.orientation,
  );
}
/** Recovered Eyes algorithm; segment-interior errors of thousands of km are documented. */
export function evaluateOrb(d: DecodedDyn, t: number, body = 0): V {
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
    p = propagate(a, t),
    q = propagate(b, t);
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
