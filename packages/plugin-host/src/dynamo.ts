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
  /** Loader for the currently enabled instance, or `undefined` when stopped. */
  loader(): DynamoSegmentLoader | undefined;
}

/**
 * Adapter from the pure DYN package to the host context. The plugin never sees
 * the real transport; it can only request its declared NASA origin.
 */
export function createDynamoPlugin(): DynamoPlugin {
  let loader: DynamoSegmentLoader | undefined;
  const manifest: PluginManifest = {
    id: NASA_DYNAMO_MANIFEST.id,
    version: NASA_DYNAMO_MANIFEST.version,
    kind: "data-source",
    capabilities: [...NASA_DYNAMO_MANIFEST.queries],
    permissions: {
      network: { hosts: [...NASA_DYNAMO_MANIFEST.permissions.network.hosts] },
    },
    limits: { maxFetchBytes: NASA_DYNAMO_MANIFEST.limits.maxFileBytes },
  };
  return {
    manifest,
    factory: (context) => ({
      start: async () => {
        loader = new DynamoSegmentLoader({
          fetchBytes: (path, signal) =>
            context.request(DYNAMO_ORIGIN, path, signal),
        });
      },
      stop: async () => {
        loader = undefined;
      },
    }),
    loader: () => loader,
  };
}
