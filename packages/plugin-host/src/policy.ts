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
  return authorizeRequest(
    manifest.capabilities,
    manifest.permissions.network.hosts,
    manifest.limits.maxFetchBytes,
    policy,
  );
}

/**
 * Re-authorize a wider grant. Expansion may not remove existing capabilities or
 * hosts, and every requested value still needs host policy approval. A denied
 * request leaves the caller's current grant untouched.
 */
export function authorizeExpansion(
  current: PluginGrant,
  requested: {
    readonly capabilities: readonly string[];
    readonly hosts: readonly string[];
  },
  policy: HostPolicy,
): PluginGrant {
  for (const capability of current.capabilities) {
    if (!requested.capabilities.includes(capability)) {
      throw new PluginPolicyError(`expansion cannot remove ${capability}`);
    }
  }
  const requestedHosts = requested.hosts.map(normalizeOrigin);
  for (const host of current.hosts) {
    if (!requestedHosts.includes(host)) {
      throw new PluginPolicyError(`expansion cannot remove ${host}`);
    }
  }
  return authorizeRequest(
    requested.capabilities,
    requested.hosts,
    current.maxFetchBytes,
    policy,
  );
}

function authorizeRequest(
  capabilities: readonly string[],
  hosts: readonly string[],
  requestedMaxFetchBytes: number,
  policy: HostPolicy,
): PluginGrant {
  if (
    !Number.isInteger(policy.maxFetchBytes) ||
    policy.maxFetchBytes < 1 ||
    policy.maxFetchBytes > 16 * 1024 * 1024
  ) {
    throw new PluginPolicyError("invalid host maxFetchBytes");
  }
  const uniqueCapabilities: string[] = [];
  for (const capability of capabilities) {
    if (typeof capability !== "string" || capability.trim() === "") {
      throw new PluginPolicyError("invalid capability");
    }
    if (uniqueCapabilities.includes(capability)) {
      throw new PluginPolicyError(`duplicate capability: ${capability}`);
    }
    if (!policy.allowedCapabilities.includes(capability)) {
      throw new PluginPolicyError(`capability not allowed: ${capability}`);
    }
    uniqueCapabilities.push(capability);
  }
  const allowedHosts = new Set(policy.allowedNetworkHosts.map(normalizeOrigin));
  const uniqueHosts: string[] = [];
  for (const host of hosts) {
    const origin = normalizeOrigin(host);
    if (uniqueHosts.includes(origin)) {
      throw new PluginPolicyError(`duplicate network host: ${origin}`);
    }
    if (!allowedHosts.has(origin)) {
      throw new PluginPolicyError(`network host not allowed: ${origin}`);
    }
    uniqueHosts.push(origin);
  }
  return Object.freeze({
    capabilities: Object.freeze(uniqueCapabilities),
    hosts: Object.freeze(uniqueHosts),
    maxFetchBytes: Math.min(requestedMaxFetchBytes, policy.maxFetchBytes),
  });
}
