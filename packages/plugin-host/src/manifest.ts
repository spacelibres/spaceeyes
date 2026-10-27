// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

export type PluginKind = "data-source" | "compute";
export type ContributionKind = "panel" | "layer" | "command";
export interface PluginContribution {
  readonly id: string;
  readonly kind: ContributionKind;
  readonly title: string;
}

export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly kind: PluginKind;
  readonly capabilities: readonly string[];
  readonly permissions: {
    readonly network: { readonly hosts: readonly string[] };
  };
  readonly limits: { readonly maxFetchBytes: number };
  readonly contributions: readonly PluginContribution[];
}

export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginManifestError";
  }
}

const ID = /^[a-z][a-z0-9._-]{2,127}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const CAPABILITY = /^[a-z][a-z0-9._-]{0,127}$/;
const CONTRIBUTION_ID = /^[a-z][a-z0-9._-]{0,63}$/;
export const MAX_CONTRIBUTIONS = 16;
export const MAX_CONTRIBUTION_TITLE_CHARS = 128;
export const MAX_MANIFEST_FETCH_BYTES = 16 * 1024 * 1024;

/** Normalize an https origin; paths, credentials, queries and fragments are invalid. */
export function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PluginManifestError(`invalid origin "${value}"`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new PluginManifestError(
      `origin must be a bare https origin: "${value}"`,
    );
  }
  return url.origin;
}

function fail(message: string): never {
  throw new PluginManifestError(message);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function validateManifest(value: unknown): PluginManifest {
  const manifest = record(value, "manifest");
  const id = manifest.id;
  if (typeof id !== "string" || !ID.test(id)) fail("invalid plugin id");
  const version = manifest.version;
  if (typeof version !== "string" || !VERSION.test(version))
    fail("invalid plugin version");
  const kind = manifest.kind;
  if (kind !== "data-source" && kind !== "compute") fail("invalid plugin kind");
  const capabilities = manifest.capabilities;
  if (!Array.isArray(capabilities)) fail("capabilities must be an array");
  const normalizedCapabilities: string[] = [];
  for (const capability of capabilities) {
    if (typeof capability !== "string" || !CAPABILITY.test(capability)) {
      fail("invalid capability");
    }
    if (normalizedCapabilities.includes(capability))
      fail("duplicate capability");
    normalizedCapabilities.push(capability);
  }
  const permissions = record(manifest.permissions, "permissions");
  const network = record(permissions.network, "permissions.network");
  const hosts = network.hosts;
  if (!Array.isArray(hosts)) fail("permissions.network.hosts must be an array");
  const normalizedHosts: string[] = [];
  for (const host of hosts) {
    if (typeof host !== "string") fail("network host must be a string");
    const origin = normalizeOrigin(host);
    if (normalizedHosts.includes(origin)) fail("duplicate network host");
    normalizedHosts.push(origin);
  }
  const limits = record(manifest.limits, "limits");
  const maxFetchBytes = limits.maxFetchBytes;
  if (
    typeof maxFetchBytes !== "number" ||
    !Number.isInteger(maxFetchBytes) ||
    maxFetchBytes < 1 ||
    maxFetchBytes > MAX_MANIFEST_FETCH_BYTES
  ) {
    fail("invalid maxFetchBytes");
  }
  const rawContributions = manifest.contributions ?? [];
  if (!Array.isArray(rawContributions)) fail("contributions must be an array");
  if (rawContributions.length > MAX_CONTRIBUTIONS)
    fail("too many contributions");
  const contributions: PluginContribution[] = [];
  for (const value of rawContributions) {
    const entry = record(value, "contribution");
    const id = entry.id;
    if (typeof id !== "string" || !CONTRIBUTION_ID.test(id))
      fail("invalid contribution id");
    if (contributions.some((item) => item.id === id))
      fail("duplicate contribution id");
    const kind = entry.kind;
    if (kind !== "panel" && kind !== "layer" && kind !== "command")
      fail("invalid contribution kind");
    const title = entry.title;
    if (
      typeof title !== "string" ||
      title.trim() === "" ||
      [...title].length > MAX_CONTRIBUTION_TITLE_CHARS ||
      /[\u0000-\u001f\u007f]/.test(title)
    )
      fail("invalid contribution title");
    contributions.push(Object.freeze({ id, kind, title }));
  }
  return Object.freeze({
    id,
    version,
    kind,
    capabilities: Object.freeze(normalizedCapabilities),
    permissions: Object.freeze({
      network: Object.freeze({ hosts: Object.freeze(normalizedHosts) }),
    }),
    limits: Object.freeze({ maxFetchBytes }),
    contributions: Object.freeze(contributions),
  });
}
