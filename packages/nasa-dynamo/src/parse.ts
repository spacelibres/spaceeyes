// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import { DynReader } from "./reader.js";
import type { Quat, Vec3 } from "./math.js";

export const POINT_TYPES = ["orb", "pos", "lin", "ori", "quat"] as const;
export type PointType = (typeof POINT_TYPES)[number];

export const POINT_STRIDE: Readonly<Record<PointType, number>> = {
  orb: 72,
  pos: 56,
  lin: 32,
  ori: 64,
  quat: 40,
};

export interface OrbPoint {
  readonly kind: "orb";
  readonly time: number;
  readonly semiMajorAxis: number;
  readonly eccentricity: number;
  readonly meanAngularMotion: number;
  readonly meanAnomalyAtEpoch: number;
  readonly orientation: Quat;
}

export interface PosPoint {
  readonly kind: "pos";
  readonly time: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export interface LinPoint {
  readonly kind: "lin";
  readonly time: number;
  readonly position: Vec3;
}

export interface OriPoint {
  readonly kind: "ori";
  readonly time: number;
  readonly orientation: Quat;
  readonly angularVelocity: Vec3;
}

export interface QuatPoint {
  readonly kind: "quat";
  readonly time: number;
  readonly orientation: Quat;
}

export type DynPoint = OrbPoint | PosPoint | LinPoint | OriPoint | QuatPoint;

export interface DynHeader {
  readonly version: 1 | 2;
  readonly name: PointType;
  readonly pointType: PointType;
  readonly numberOfDigits: number;
  readonly gravitationalParameter1?: number;
  readonly gravitationalParameter2?: number;
}

export interface DynSegment {
  readonly index: number;
  readonly startTime: number;
  /** Version 2 infers the end from the next start; the last segment is open. */
  readonly endTime: number;
}

export interface DynFile {
  readonly header: DynHeader;
  readonly points: readonly DynPoint[];
  readonly segments: readonly DynSegment[];
  readonly interval: { readonly min: number; readonly max: number } | null;
}

export class DynParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DynParseError";
  }
}

export function isPointType(value: string): value is PointType {
  return (POINT_TYPES as readonly string[]).includes(value);
}

/** Parse an inline file or an index file (which carries no points). */
export function parseDyn(data: ArrayBuffer | Uint8Array): DynFile {
  const reader = new DynReader(data);
  const version = reader.readInt16();
  if (version !== 1 && version !== 2) {
    throw new DynParseError(`unsupported dynamo version ${version}`);
  }
  const name = reader.readName();
  if (!isPointType(name)) {
    throw new DynParseError(`invalid dynamo point type "${name}"`);
  }
  const numberOfDigits = version === 2 ? reader.readUint8() : 0;
  const base = { version, name, pointType: name, numberOfDigits } as const;
  const header: DynHeader =
    name === "orb"
      ? {
          ...base,
          gravitationalParameter1: reader.readFloat64(),
          gravitationalParameter2: reader.readFloat64(),
        }
      : base;

  const hasPoints = reader.readUint8();
  if (hasPoints === 0) {
    return {
      header,
      points: [],
      segments: readSegments(reader, version),
      interval: null,
    };
  }
  if (hasPoints !== 1) {
    throw new DynParseError(`invalid hasPoints flag ${hasPoints}`);
  }

  const count = reader.readInt32();
  if (count < 0) {
    throw new DynParseError(`negative point count ${count}`);
  }
  const stride = POINT_STRIDE[name];
  if (reader.remaining !== count * stride) {
    throw new DynParseError(
      `point block size mismatch: expected ${count * stride} bytes for ` +
        `${count} x ${name} (stride ${stride}), found ${reader.remaining}`,
    );
  }

  const points = readPoints(reader, name, count);
  let interval: { min: number; max: number } | null = null;
  if (count > 0) {
    const first = points[0];
    const last = points[count - 1];
    if (first === undefined || last === undefined) {
      throw new DynParseError("internal: point block is incomplete");
    }
    interval = { min: first.time, max: last.time };
  }
  return { header, points, segments: [], interval };
}

/** Parse a continuation segment, which carries records without a file header. */
export function parseDynSegment(
  data: ArrayBuffer | Uint8Array,
  type: PointType,
): readonly DynPoint[] {
  const reader = new DynReader(data);
  const hasPoints = reader.readUint8();
  if (hasPoints !== 1) {
    throw new DynParseError("segment file unexpectedly contains an index");
  }
  const count = reader.readInt32();
  if (count < 0) {
    throw new DynParseError(`negative point count ${count}`);
  }
  const stride = POINT_STRIDE[type];
  if (reader.remaining !== count * stride) {
    throw new DynParseError(
      `segment size mismatch: expected ${count * stride} bytes for ` +
        `${count} x ${type} (stride ${stride}), found ${reader.remaining}`,
    );
  }
  return readPoints(reader, type, count);
}

function readSegments(
  reader: DynReader,
  version: 1 | 2,
): readonly DynSegment[] {
  const count = reader.readInt32();
  if (count < 0) {
    throw new DynParseError(`negative segment count ${count}`);
  }
  const perSegment = version === 1 ? 16 : 8;
  if (reader.remaining !== count * perSegment) {
    throw new DynParseError(
      `segment table size mismatch: expected ${count * perSegment} bytes, ` +
        `found ${reader.remaining}`,
    );
  }
  const segments: DynSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const startTime = reader.readFloat64();
    const endTime =
      version === 1 ? reader.readFloat64() : Number.POSITIVE_INFINITY;
    segments.push({ index, startTime, endTime });
  }
  if (version === 2) {
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      const next = segments[index + 1];
      if (segment === undefined || next === undefined) {
        throw new DynParseError("internal: segment table is incomplete");
      }
      segments[index] = { ...segment, endTime: next.startTime };
    }
  }
  return segments;
}

function readPoints(
  reader: DynReader,
  type: PointType,
  count: number,
): readonly DynPoint[] {
  const points: DynPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    points.push(readPoint(reader, type));
  }
  return points;
}

function readPoint(reader: DynReader, type: PointType): DynPoint {
  const time = reader.readFloat64();
  switch (type) {
    case "orb":
      return {
        kind: "orb",
        time,
        semiMajorAxis: reader.readFloat64(),
        eccentricity: reader.readFloat64(),
        meanAngularMotion: reader.readFloat64(),
        meanAnomalyAtEpoch: reader.readFloat64(),
        orientation: readQuat(reader),
      };
    case "pos":
      return {
        kind: "pos",
        time,
        position: readVec3(reader),
        velocity: readVec3(reader),
      };
    case "lin":
      return { kind: "lin", time, position: readVec3(reader) };
    case "ori":
      return {
        kind: "ori",
        time,
        orientation: readQuat(reader),
        angularVelocity: readVec3(reader),
      };
    case "quat":
      return { kind: "quat", time, orientation: readQuat(reader) };
  }
}

function readVec3(reader: DynReader): Vec3 {
  return {
    x: reader.readFloat64(),
    y: reader.readFloat64(),
    z: reader.readFloat64(),
  };
}

/** `.dyn` quaternions are W-first, matching NASA's `set(w, x, y, z)`. */
function readQuat(reader: DynReader): Quat {
  const w = reader.readFloat64();
  const x = reader.readFloat64();
  const y = reader.readFloat64();
  const z = reader.readFloat64();
  return { x, y, z, w };
}
