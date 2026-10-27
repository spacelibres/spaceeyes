// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import {
  DynamoSegmentLoader,
  evaluateEphemeris,
  type LoadedDynamo,
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
