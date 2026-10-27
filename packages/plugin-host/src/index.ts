// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

export {
  MAX_MANIFEST_FETCH_BYTES,
  PluginManifestError,
  normalizeOrigin,
  validateManifest,
} from "./manifest.js";
export type { PluginKind, PluginManifest } from "./manifest.js";

export { PluginPolicyError, authorize } from "./policy.js";
export type { HostPolicy, PluginGrant } from "./policy.js";

export { PluginHost, PluginHostError } from "./host.js";
export type {
  PluginContext,
  PluginFactory,
  PluginHostErrorCode,
  PluginInstance,
  PluginTransport,
} from "./host.js";

export {
  DYNAMO_ORIGIN,
  DYNAMO_PLUGIN_ID,
  createDynamoPlugin,
} from "./dynamo.js";
export type { DynamoPlugin } from "./dynamo.js";
