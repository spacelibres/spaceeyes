import { eyesDefinitions, parentAt } from "./eyes-catalog.ts";
import { propagateState } from "./dyn-evaluator.ts";
export function activeController(id: string, t: number, type: string) {
  return (eyesDefinitions[id]?.controllers ?? []).filter(
    (c) =>
      c.type === type &&
      (!c.coverage ||
        (t >= Number(c.coverage[0]) && t <= Number(c.coverage[1]))),
  );
}
export function rotateVector(
  v: readonly number[],
  q: readonly number[],
): [number, number, number] {
  const [w, x, y, z] = q;
  const [a, b, c] = v;
  const tx = 2 * (y * c - z * b),
    ty = 2 * (z * a - x * c),
    tz = 2 * (x * b - y * a);
  return [
    a + w * tx + y * tz - z * ty,
    b + w * ty + z * tx - x * tz,
    c + w * tz + x * ty - y * tx,
  ];
}
export function staticPosition(
  id: string,
  t: number,
  parentOrientation?: readonly number[],
): [number, number, number] | undefined {
  for (const c of activeController(id, t, "fixed")) {
    if (c.position?.constructor === "Vector3") {
      const rotates =
        c.relativeToEntity ||
        activeController(id, t, "rotateByEntityOrientation").length;
      if (rotates) {
        if (!parentOrientation)
          throw Error("Reference orientation unavailable");
        return rotateVector(c.position.values, parentOrientation);
      }
      return [...c.position.values] as [number, number, number];
    }
    if (c.llaOnSpheroid?.constructor === "LatLonAlt") {
      if (!parentOrientation)
        throw Error("Parent orientation unavailable for surface position");
      const parent = eyesDefinitions[parentAt(id, t) ?? ""];
      const sph = parent?.spheroid;
      if (!sph) throw Error("Parent spheroid unavailable");
      const [lat, lon, alt] = c.llaOnSpheroid.values;
      const a = sph.equatorialRadius,
        b = sph.polarRadius,
        e2 = 1 - (b * b) / (a * a),
        n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
      if (!sph.planetographic) {
        const radial =
          (a * b) /
          Math.sqrt(b * b * Math.cos(lat) ** 2 + a * a * Math.sin(lat) ** 2);
        return rotateVector(
          [
            (radial + alt) * Math.cos(lat) * Math.cos(lon),
            (radial + alt) * Math.cos(lat) * Math.sin(lon),
            (radial + alt) * Math.sin(lat),
          ],
          parentOrientation,
        );
      }
      return rotateVector(
        [
          (n + alt) * Math.cos(lat) * Math.cos(lon),
          (n + alt) * Math.cos(lat) * Math.sin(lon),
          (n * (1 - e2) + alt) * Math.sin(lat),
        ],
        parentOrientation,
      );
    }
  }
  const c = activeController(id, t, "orbitalElements").at(-1);
  if (c) {
    let q = c.orientation?.values;
    if (!q) {
      const O = c.longitudeOfAscendingNode / 2,
        i = c.inclination / 2,
        w = c.argumentOfPeriapsis / 2;
      q = [
        Math.cos(i) * Math.cos(O + w),
        Math.sin(i) * Math.cos(O - w),
        Math.sin(i) * Math.sin(O - w),
        Math.cos(i) * Math.sin(O + w),
      ];
    }
    return propagateState(
      {
        time: c.epoch,
        semiMajorAxis: c.semiMajorAxis,
        eccentricity: c.eccentricity,
        meanAngularMotion: c.meanAngularMotion,
        meanAnomalyAtEpoch: c.meanAnomalyAtEpoch,
        orientation: q,
      },
      t,
    ).position;
  }
  return undefined;
}
export function staticCoverage(
  id: string,
  t: number,
): [number, number] | undefined {
  const c = [
    ...activeController(id, t, "fixed").filter(
      (c) => c.position || c.llaOnSpheroid,
    ),
    ...activeController(id, t, "orbitalElements"),
  ].at(-1);
  return c
    ? [
        Number(c.coverage?.[0] ?? -Infinity),
        Number(c.coverage?.[1] ?? Infinity),
      ]
    : undefined;
}
