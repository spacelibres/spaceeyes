// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

/** Ceiling for one `.dyn` file or continuation segment. */
export const MAX_DYNAMO_BYTES = 16 * 1024 * 1024;

/** Guard against an index that would require unbounded segment requests. */
export const MAX_DYNAMO_SEGMENTS = 4096;

/** Default bounded LRU entries for parsed indexes and loaded windows. */
export const DEFAULT_DYNAMO_CACHE_ENTRIES = 64;

/** Default coarse time bucket (~one quarter year) for segment reuse. */
export const DEFAULT_SEGMENT_BUCKET_SECONDS = 90 * 86400;
