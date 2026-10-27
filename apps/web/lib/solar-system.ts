// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import {
  DynamoSegmentLoader,
  evaluateEphemeris,
  nearestPoint,
  orbPositionAt,
  type LoadedDynamo,
  type OrbPoint,
  type Vec3,
} from "@spaceeyes/nasa-dynamo";

/**
 * Display-only scale. Scientific positions stay in kilometers inside the data
 * source; the scene compresses 1 km to 1e-6 m so 1 AU is about 150 m.
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

/** Position in display metres, or `null` when the window cannot answer. */
export function solarPosition(
  loaded: LoadedDynamo,
  timeEt: number,
): Vec3 | null {
  const state = evaluateEphemeris(
    {
      header: loaded.file.header,
      points: loaded.points,
      interval: loaded.interval,
    },
    timeEt,
  );
  if (state.status !== "ready" || state.kind !== "position") return null;
  const factor = 1000 * DISPLAY_METRES_PER_KM;
  return {
    x: state.position.x * factor,
    y: state.position.y * factor,
    z: state.position.z * factor,
  };
}

export interface OrbitMesh {
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
 * Display-only osculating orbit tube at the sample epoch nearest `timeEt`.
 * It is not propagated across the whole epoch and must not be read as a
 * scientific ephemeris.
 */
export function orbitMesh(
  loaded: LoadedDynamo,
  timeEt: number,
): OrbitMesh | null {
  if (loaded.file.header.pointType !== "orb") return null;
  const points = loaded.points.filter(
    (point): point is OrbPoint => point.kind === "orb",
  );
  if (points.length < 2) return null;
  const sample = nearestPoint(points, timeEt);
  if (!sample) return null;
  const motion = Math.abs(sample.meanAngularMotion);
  if (!(motion > 0) || sample.eccentricity >= 1) return null;
  const period = (2 * Math.PI) / motion;
  const scale = 1000 * DISPLAY_METRES_PER_KM;
  const samples = 160;
  const width = 0.12;
  const ring: Vec3[] = [];
  for (let index = 0; index < samples; index += 1) {
    const position = orbPositionAt(sample, timeEt + (period * index) / samples);
    if (!position) return null;
    ring.push({
      x: position.x * scale,
      y: position.y * scale,
      z: position.z * scale,
    });
  }
  const vertices: {
    positionM: Vec3;
    normal: Vec3;
    uv: { x: number; y: number };
  }[] = [];
  const indices: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const current = ring[index]!;
    const previous = ring[(index + samples - 1) % samples]!;
    const next = ring[(index + 1) % samples]!;
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

/** Host-proxied loader. The route allowlists NASA paths and caps the size. */
export function createSolarLoader(): DynamoSegmentLoader {
  return new DynamoSegmentLoader({
    async fetchBytes(path: string, signal?: AbortSignal): Promise<Uint8Array> {
      const response = await fetch(`/api/dynamo/${path}`, {
        cache: "no-store",
        signal: signal ?? AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`星历请求失败（${response.status}）：${path}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  });
}
