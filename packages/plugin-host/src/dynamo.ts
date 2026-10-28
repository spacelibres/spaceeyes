// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import {
  DynamoSegmentLoader,
  NASA_DYNAMO_MANIFEST,
} from "@spaceeyes/nasa-dynamo";
import type { PluginContext, PluginInstance } from "./host.js";
import type { PluginManifest } from "./manifest.js";

export const DYNAMO_ORIGIN = "https://eyes.nasa.gov";
export const DYNAMO_PLUGIN_ID = NASA_DYNAMO_MANIFEST.id;

export interface DynamoPlugin {
  readonly manifest: PluginManifest;
  readonly factory: (context: PluginContext) => PluginInstance;
  /** Raw bytes fetcher for the current instance; the core owns parsing. */
  bytes():
    | ((path: string, signal?: AbortSignal) => Promise<Uint8Array>)
    | undefined;
  /** Legacy parsed loader, retained for the migration oracle and tests only. */
  loader(): DynamoSegmentLoader | undefined;
}

/**
 * Adapter from the pure DYN package to the host context. The plugin never sees
 * the real transport; it can only request its declared NASA origin. The browser
 * now uses `bytes()` and asks the Rust core to parse/evaluate.
 */
export function createDynamoPlugin(): DynamoPlugin {
  let loader: DynamoSegmentLoader | undefined;
  let fetcher:
    | ((path: string, signal?: AbortSignal) => Promise<Uint8Array>)
    | undefined;
  const manifest: PluginManifest = {
    id: NASA_DYNAMO_MANIFEST.id,
    version: NASA_DYNAMO_MANIFEST.version,
    kind: "data-source",
    capabilities: [...NASA_DYNAMO_MANIFEST.queries],
    permissions: {
      network: { hosts: [...NASA_DYNAMO_MANIFEST.permissions.network.hosts] },
    },
    limits: { maxFetchBytes: NASA_DYNAMO_MANIFEST.limits.maxFileBytes },
    contributions: [],
  };
  return {
    manifest,
    factory: (context) => ({
      start: async () => {
        fetcher = (path, signal) =>
          context.request(DYNAMO_ORIGIN, path, signal);
        loader = new DynamoSegmentLoader({
          fetchBytes: (path, signal) =>
            context.request(DYNAMO_ORIGIN, path, signal),
        });
      },
      stop: async () => {
        loader = undefined;
        fetcher = undefined;
      },
    }),
    bytes: () => fetcher,
    loader: () => loader,
  };
}
