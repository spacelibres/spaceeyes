// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

export {
  DynParseError,
  POINT_STRIDE,
  POINT_TYPES,
  isPointType,
  parseDyn,
  parseDynSegment,
} from "./parse.js";
export type {
  DynFile,
  DynHeader,
  DynPoint,
  DynSegment,
  LinPoint,
  OrbPoint,
  OriPoint,
  PointType,
  PosPoint,
  QuatPoint,
} from "./parse.js";

export {
  direction,
  identityQuat,
  isFiniteQuat,
  isFiniteVec,
  mix,
  normalizeQuat,
  quatConjugate,
  quatLength,
  quatMultiply,
  quatScale,
  rotateByQuat,
  scale,
  slerpQuat,
  slerpVector,
  vec3,
} from "./math.js";
export type { Quat, Vec3 } from "./math.js";

export { nearestPoint, orbPositionAt, solveEccentricAnomaly } from "./orbit.js";
export {
  EVALUATED_POINT_TYPES,
  evaluateEphemeris,
  windowFromFile,
} from "./evaluate.js";
export type {
  EphemerisSource,
  EphemerisState,
  EphemerisWindow,
  EvaluateOptions,
} from "./evaluate.js";
export {
  MAX_DYNAMO_BYTES,
  DEFAULT_DYNAMO_CACHE_ENTRIES,
  DEFAULT_SEGMENT_BUCKET_SECONDS,
  MAX_DYNAMO_SEGMENTS,
} from "./limits.js";
export {
  DynamoLoadError,
  DynamoSegmentLoader,
  referenceBodyOf,
  segmentPath,
  selectSegment,
} from "./loader.js";
export type {
  DynamoLoadErrorCode,
  DynamoLoaderOptions,
  DynamoTransport,
  LoadedDynamo,
} from "./loader.js";
export {
  NASA_DYNAMO_MANIFEST,
  NasaDynamoPlugin,
  PLUGIN_ID,
  PLUGIN_VERSION,
} from "./plugin.js";
export type { DynamoPluginManifest } from "./plugin.js";
