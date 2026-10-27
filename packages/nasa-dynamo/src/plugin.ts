// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import {
  evaluateEphemeris,
  windowFromFile,
  type EphemerisSource,
  type EphemerisState,
  type EvaluateOptions,
} from "./evaluate.js";
import { MAX_DYNAMO_BYTES } from "./limits.js";
import {
  POINT_TYPES,
  parseDyn,
  parseDynSegment,
  type DynFile,
  type DynPoint,
  type PointType,
} from "./parse.js";

export const PLUGIN_ID = "spaceeyes.nasa.dynamo";
export const PLUGIN_VERSION = "0.0.1";

/** Ceiling for one `.dyn` file or continuation segment. */
export { MAX_DYNAMO_BYTES };
const MAX_SOURCE_PATH = 512;
const MAX_SEGMENT_LABEL = 128;

export interface DynamoPluginManifest {
  readonly id: string;
  readonly version: string;
  readonly kind: "data-source";
  readonly pointTypes: readonly PointType[];
  readonly queries: readonly string[];
  readonly permissions: {
    readonly network: {
      readonly hosts: readonly string[];
      readonly viaHostProxy: true;
    };
  };
  readonly limits: {
    readonly maxFileBytes: number;
  };
}

/**
 * Declarative surface only. The library performs no network access; a host
 * must fetch through its permission proxy and pass bytes to `loadFile`.
 */
export const NASA_DYNAMO_MANIFEST: DynamoPluginManifest = {
  id: PLUGIN_ID,
  version: PLUGIN_VERSION,
  kind: "data-source",
  pointTypes: POINT_TYPES,
  queries: ["ephemeris.window", "ephemeris.evaluate"],
  permissions: {
    network: {
      hosts: ["https://eyes.nasa.gov"],
      viaHostProxy: true,
    },
  },
  limits: {
    maxFileBytes: MAX_DYNAMO_BYTES,
  },
};

function checkBytes(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) {
    throw new RangeError("dynamo input is empty");
  }
  if (bytes.byteLength > MAX_DYNAMO_BYTES) {
    throw new RangeError(
      `dynamo input is ${bytes.byteLength} bytes; maximum is ${MAX_DYNAMO_BYTES}`,
    );
  }
}

function checkSource(source: EphemerisSource): void {
  if (source.path.length === 0 || source.path.length > MAX_SOURCE_PATH) {
    throw new RangeError(
      `dynamo source path must be 1..${MAX_SOURCE_PATH} characters`,
    );
  }
  if (source.segment !== null && source.segment.length > MAX_SEGMENT_LABEL) {
    throw new RangeError(
      `dynamo segment label exceeds ${MAX_SEGMENT_LABEL} characters`,
    );
  }
}

/**
 * Pure data-source plugin. Parsing, evaluation and manifest are independent of
 * the host; network permission is enforced by the future host proxy (P03).
 */
export class NasaDynamoPlugin {
  readonly manifest = NASA_DYNAMO_MANIFEST;

  /** Parse an inline or index file received from the host proxy. */
  loadFile(bytes: Uint8Array, source: EphemerisSource): DynFile {
    checkBytes(bytes);
    checkSource(source);
    return parseDyn(bytes);
  }

  /** Parse one continuation segment; the index file supplies header semantics. */
  loadSegment(bytes: Uint8Array, type: PointType): readonly DynPoint[] {
    checkBytes(bytes);
    if (!POINT_TYPES.includes(type)) {
      throw new RangeError(`unsupported dynamo point type "${type}"`);
    }
    return parseDynSegment(bytes, type);
  }

  /** Evaluate a parsed file at an ET value (seconds, caller-owned epoch). */
  evaluate(
    file: DynFile,
    time: number,
    options: EvaluateOptions = {},
  ): EphemerisState {
    const window = windowFromFile(file.header, file.points, file.interval, {
      path: "",
      segment: null,
    });
    if (window === null) {
      return { status: "unavailable", reason: "invalid-samples" };
    }
    return evaluateEphemeris(window, time, options);
  }
}
