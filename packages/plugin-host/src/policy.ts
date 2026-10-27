// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import { normalizeOrigin, type PluginManifest } from "./manifest.js";

export interface HostPolicy {
  readonly allowedCapabilities: readonly string[];
  readonly allowedNetworkHosts: readonly string[];
  readonly maxFetchBytes: number;
}

export interface PluginGrant {
  readonly capabilities: readonly string[];
  readonly hosts: readonly string[];
  readonly maxFetchBytes: number;
}

export class PluginPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginPolicyError";
  }
}

/**
 * Authorization is a host decision. Requested capabilities and hosts must be
 * subsets of the host policy; an empty grant is still a valid install.
 */
export function authorize(
  manifest: PluginManifest,
  policy: HostPolicy,
): PluginGrant {
  if (
    !Number.isInteger(policy.maxFetchBytes) ||
    policy.maxFetchBytes < 1 ||
    policy.maxFetchBytes > 16 * 1024 * 1024
  ) {
    throw new PluginPolicyError("invalid host maxFetchBytes");
  }
  for (const capability of manifest.capabilities) {
    if (!policy.allowedCapabilities.includes(capability)) {
      throw new PluginPolicyError(`capability not allowed: ${capability}`);
    }
  }
  const allowedHosts = new Set(policy.allowedNetworkHosts.map(normalizeOrigin));
  for (const host of manifest.permissions.network.hosts) {
    if (!allowedHosts.has(host)) {
      throw new PluginPolicyError(`network host not allowed: ${host}`);
    }
  }
  return Object.freeze({
    capabilities: Object.freeze([...manifest.capabilities]),
    hosts: Object.freeze([...manifest.permissions.network.hosts]),
    maxFetchBytes: Math.min(
      manifest.limits.maxFetchBytes,
      policy.maxFetchBytes,
    ),
  });
}
