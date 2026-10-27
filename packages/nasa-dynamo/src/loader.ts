// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import type { EphemerisSource } from "./evaluate.js";
import {
  DEFAULT_DYNAMO_CACHE_ENTRIES,
  DEFAULT_SEGMENT_BUCKET_SECONDS,
  MAX_DYNAMO_BYTES,
  MAX_DYNAMO_SEGMENTS,
} from "./limits.js";
import {
  parseDyn,
  parseDynSegment,
  type DynFile,
  type DynPoint,
  type DynSegment,
  type PointType,
} from "./parse.js";

/** Host-provided transport; the plugin never calls `fetch` itself. */
export interface DynamoTransport {
  fetchBytes(path: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface LoadedDynamo {
  readonly file: DynFile;
  readonly points: readonly DynPoint[];
  readonly interval: { readonly min: number; readonly max: number };
  readonly source: EphemerisSource;
  readonly relTo: string | null;
}

export type DynamoLoadErrorCode =
  | "fetch-failed"
  | "invalid-data"
  | "no-data"
  | "aborted";

export class DynamoLoadError extends Error {
  constructor(
    readonly code: DynamoLoadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DynamoLoadError";
  }
}

export interface DynamoLoaderOptions {
  readonly maxCacheEntries?: number;
  readonly maxSegments?: number;
  readonly bucketSeconds?: number;
}

class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("cache capacity must be a positive integer");
    }
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }
}

/** Parent body implied by a controller path, or `null` for orientation-only. */
export function referenceBodyOf(path: string): string | null {
  const parts = path.split("/");
  const segments = parts.slice(1).filter((part) => part !== "def.dyn");
  const first = segments[0];
  if (first === undefined) return null;
  if (first === "ori" || first === "quat") return null;
  if (/^[a-z][a-z0-9_]*$/.test(first) && !/^\d+$/.test(first)) return first;
  return null;
}

/** Continuation path such as `ganymede/jupiter/orb/122.dyn`. */
export function segmentPath(
  path: string,
  digits: number,
  index: number,
): string {
  if (!Number.isInteger(digits) || digits < 0 || digits > 12) {
    throw new RangeError(`invalid segment digit count ${digits}`);
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`invalid segment index ${index}`);
  }
  const slash = path.lastIndexOf("/");
  if (slash < 1) throw new RangeError(`invalid dynamo path "${path}"`);
  const name = String(index).padStart(digits, "0");
  return `${path.slice(0, slash)}/${name}.dyn`;
}

/** Last segment whose start is at or before `time`; the first before coverage. */
export function selectSegment(
  segments: readonly DynSegment[],
  time: number,
): DynSegment | null {
  const first = segments[0];
  if (first === undefined) return null;
  let chosen = first;
  for (const segment of segments) {
    if (segment.startTime <= time) chosen = segment;
    else break;
  }
  return chosen;
}

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) {
    throw new DynamoLoadError("aborted", "dynamo load aborted");
  }
};

/**
 * Host-agnostic loader for inline and segmented `/def.dyn` controllers.
 *
 * Only the segment covering the requested time is fetched. Indexes and loaded
 * windows are kept in bounded LRU caches; cancellation is checked around each
 * host fetch. The transport is responsible for network limits and permissions.
 */
export class DynamoSegmentLoader {
  private readonly indexCache: LruCache<string, DynFile>;
  private readonly windowCache: LruCache<string, LoadedDynamo>;
  private readonly maxSegments: number;
  private readonly bucketSeconds: number;

  constructor(
    private readonly transport: DynamoTransport,
    options: DynamoLoaderOptions = {},
  ) {
    this.indexCache = new LruCache(
      options.maxCacheEntries ?? DEFAULT_DYNAMO_CACHE_ENTRIES,
    );
    this.windowCache = new LruCache(
      options.maxCacheEntries ?? DEFAULT_DYNAMO_CACHE_ENTRIES,
    );
    this.maxSegments = options.maxSegments ?? MAX_DYNAMO_SEGMENTS;
    this.bucketSeconds =
      options.bucketSeconds ?? DEFAULT_SEGMENT_BUCKET_SECONDS;
  }

  async load(
    path: string,
    atTime = 0,
    signal?: AbortSignal,
  ): Promise<LoadedDynamo> {
    throwIfAborted(signal);
    const key = `${path}@${this.bucketOf(atTime)}`;
    const cached = this.windowCache.get(key);
    if (cached !== undefined) return cached;
    const loaded = await this.loadWindow(path, atTime, signal);
    this.windowCache.set(key, loaded);
    return loaded;
  }

  private async loadWindow(
    path: string,
    atTime: number,
    signal: AbortSignal | undefined,
  ): Promise<LoadedDynamo> {
    const file = await this.loadIndex(path, signal);
    throwIfAborted(signal);
    const relTo = referenceBodyOf(path);

    if (file.segments.length === 0) {
      if (file.interval === null || file.points.length === 0) {
        throw new DynamoLoadError(
          "no-data",
          `dynamo file has no points: ${path}`,
        );
      }
      return {
        file,
        points: file.points,
        interval: file.interval,
        source: { path, segment: null },
        relTo,
      };
    }

    if (file.segments.length > this.maxSegments) {
      throw new DynamoLoadError(
        "invalid-data",
        `dynamo index has ${file.segments.length} segments; maximum is ${this.maxSegments}`,
      );
    }
    const chosen = selectSegment(file.segments, atTime);
    if (chosen === null) {
      throw new DynamoLoadError(
        "no-data",
        `dynamo index has no segments: ${path}`,
      );
    }
    const continuation = segmentPath(
      path,
      file.header.numberOfDigits,
      chosen.index,
    );
    const points = await this.loadSegment(
      continuation,
      file.header.pointType,
      signal,
    );
    const first = points[0];
    const last = points[points.length - 1];
    if (first === undefined || last === undefined) {
      throw new DynamoLoadError(
        "no-data",
        `dynamo segment has no points: ${continuation}`,
      );
    }
    return {
      file,
      points,
      interval: { min: first.time, max: last.time },
      source: { path, segment: String(chosen.index) },
      relTo,
    };
  }

  private async loadIndex(
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<DynFile> {
    const cached = this.indexCache.get(path);
    if (cached !== undefined) return cached;
    const bytes = await this.fetch(path, signal);
    let file: DynFile;
    try {
      file = parseDyn(bytes);
    } catch (error) {
      throw new DynamoLoadError(
        "invalid-data",
        `invalid dynamo index ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.indexCache.set(path, file);
    return file;
  }

  private async loadSegment(
    path: string,
    type: PointType,
    signal: AbortSignal | undefined,
  ): Promise<readonly DynPoint[]> {
    const bytes = await this.fetch(path, signal);
    try {
      return parseDynSegment(bytes, type);
    } catch (error) {
      throw new DynamoLoadError(
        "invalid-data",
        `invalid dynamo segment ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async fetch(
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    throwIfAborted(signal);
    let bytes: Uint8Array;
    try {
      bytes = await this.transport.fetchBytes(path, signal);
    } catch (error) {
      if (signal?.aborted === true) {
        throw new DynamoLoadError("aborted", "dynamo load aborted");
      }
      throw new DynamoLoadError(
        "fetch-failed",
        `dynamo fetch failed for ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    throwIfAborted(signal);
    if (bytes.byteLength === 0) {
      throw new DynamoLoadError(
        "invalid-data",
        `empty dynamo response: ${path}`,
      );
    }
    if (bytes.byteLength > MAX_DYNAMO_BYTES) {
      throw new DynamoLoadError(
        "invalid-data",
        `dynamo response is ${bytes.byteLength} bytes; maximum is ${MAX_DYNAMO_BYTES}`,
      );
    }
    return bytes;
  }

  private bucketOf(time: number): number {
    return Math.floor(time / this.bucketSeconds);
  }
}
