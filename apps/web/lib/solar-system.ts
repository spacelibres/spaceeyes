// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
/**
 * Solar-system catalog and display geometry only. Ephemeris parsing, evaluation,
 * orbit sampling and time conversion live in the Rust core; this module must not
 * gain astronomy math.
 */
export const DISPLAY_METRES_PER_KM = 1e-6;

export interface SolarBody {
  readonly id: string;
  readonly frame: string;
  readonly parentFrame: string;
  readonly path: string;
  readonly radiusM: number;
  readonly color: {
    readonly r: number;
    readonly g: number;
    readonly b: number;
  };
}

export const SUN = {
  id: "solar:sun",
  frame: "demo:root",
  radiusM: 6,
  color: { r: 1, g: 0.82, b: 0.35 },
} as const;

export const SOLAR_BODIES: readonly SolarBody[] = [
  {
    id: "solar:mercury",
    frame: "solar:mercury",
    parentFrame: "demo:root",
    path: "mercury/sun/orb/def.dyn",
    radiusM: 0.5,
    color: { r: 0.55, g: 0.5, b: 0.45 },
  },
  {
    id: "solar:venus",
    frame: "solar:venus",
    parentFrame: "demo:root",
    path: "venus/sun/orb/def.dyn",
    radiusM: 0.85,
    color: { r: 0.9, g: 0.78, b: 0.5 },
  },
  {
    id: "solar:earth",
    frame: "solar:earth",
    parentFrame: "demo:root",
    path: "earth/sun/orb/def.dyn",
    radiusM: 0.9,
    color: { r: 0.2, g: 0.45, b: 0.95 },
  },
  {
    id: "solar:moon",
    frame: "solar:moon",
    parentFrame: "solar:earth",
    path: "moon/earth/orb/def.dyn",
    radiusM: 0.3,
    color: { r: 0.75, g: 0.75, b: 0.75 },
  },
  {
    id: "solar:mars",
    frame: "solar:mars",
    parentFrame: "demo:root",
    path: "mars/sun/orb/def.dyn",
    radiusM: 0.7,
    color: { r: 0.85, g: 0.35, b: 0.2 },
  },
  {
    id: "solar:jupiter",
    frame: "solar:jupiter",
    parentFrame: "demo:root",
    path: "jupiter/sun/orb/def.dyn",
    radiusM: 2.2,
    color: { r: 0.8, g: 0.66, b: 0.46 },
  },
  {
    id: "solar:saturn",
    frame: "solar:saturn",
    parentFrame: "demo:root",
    path: "saturn/sun/orb/def.dyn",
    radiusM: 1.8,
    color: { r: 0.85, g: 0.75, b: 0.5 },
  },
  {
    id: "solar:uranus",
    frame: "solar:uranus",
    parentFrame: "demo:root",
    path: "uranus/sun/orb/def.dyn",
    radiusM: 1.3,
    color: { r: 0.55, g: 0.85, b: 0.9 },
  },
  {
    id: "solar:neptune",
    frame: "solar:neptune",
    parentFrame: "demo:root",
    path: "neptune/sun/orb/def.dyn",
    radiusM: 1.3,
    color: { r: 0.3, g: 0.45, b: 0.9 },
  },
];

/** Camera settings for the compressed solar-system view (far range in metres). */
export const SOLAR_CAMERA = {
  positionM: { x: 0, y: 0, z: 420 },
  nearM: 0.1,
  farM: 5000,
} as const;

/** Seconds since the caller-provided epoch, using the core's explicit instant. */
export function solarSeconds(instant: {
  readonly seconds: bigint;
  readonly nanos: number;
}): number {
  return Number(instant.seconds) + instant.nanos / 1_000_000_000;
}

export const SOLAR_NAMES: Readonly<Record<string, string>> = {
  "solar:sun": "太阳",
  "solar:mercury": "水星",
  "solar:venus": "金星",
  "solar:earth": "地球",
  "solar:moon": "月球",
  "solar:mars": "火星",
  "solar:jupiter": "木星",
  "solar:saturn": "土星",
  "solar:saturn-ring": "土星环",
  "solar:uranus": "天王星",
  "solar:neptune": "海王星",
};

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TubeMesh {
  readonly vertices: readonly {
    readonly positionM: Vec3;
    readonly normal: Vec3;
    readonly uv: { readonly x: number; readonly y: number };
  }[];
  readonly indices: readonly number[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const unit = (v: Vec3): Vec3 => {
  const n = length(v) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};

/**
 * Assemble a closed tube from core-provided display-space points. This is pure
 * geometry: no Kepler roots, epochs or ephemeris math are computed here.
 */
export function orbitTube(
  points: readonly Vec3[],
  width = 0.12,
): TubeMesh | null {
  if (points.length < 3) return null;
  const samples = points.length;
  const vertices: {
    positionM: Vec3;
    normal: Vec3;
    uv: { x: number; y: number };
  }[] = [];
  const indices: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const current = points[index]!;
    const previous = points[(index + samples - 1) % samples]!;
    const next = points[(index + 1) % samples]!;
    const tangent = unit(sub(next, previous));
    let side = cross(tangent, { x: 0, y: 0, z: 1 });
    if (length(side) < 1e-6) side = cross(tangent, { x: 1, y: 0, z: 0 });
    side = unit(side);
    const binormal = unit(cross(tangent, side));
    for (const [alongSide, alongBinormal] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      vertices.push({
        positionM: {
          x:
            current.x +
            (side.x * alongSide + binormal.x * alongBinormal) * width,
          y:
            current.y +
            (side.y * alongSide + binormal.y * alongBinormal) * width,
          z:
            current.z +
            (side.z * alongSide + binormal.z * alongBinormal) * width,
        },
        normal: tangent,
        uv: { x: 0, y: 0 },
      });
    }
  }
  for (let index = 0; index < samples; index += 1) {
    const start = index * 4;
    const end = ((index + 1) % samples) * 4;
    for (let side = 0; side < 4; side += 1) {
      const nextSide = (side + 1) % 4;
      indices.push(
        start + side,
        end + side,
        end + nextSide,
        start + side,
        end + nextSide,
        start + nextSide,
      );
    }
  }
  return { vertices, indices };
}
