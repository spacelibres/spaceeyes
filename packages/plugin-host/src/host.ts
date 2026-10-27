// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import {
  authorize,
  authorizeExpansion,
  type HostPolicy,
  type PluginGrant,
} from "./policy.js";
import {
  normalizeOrigin,
  validateManifest,
  type ContributionKind,
  type PluginManifest,
} from "./manifest.js";

export type PluginHostErrorCode =
  | "duplicate"
  | "unknown"
  | "denied"
  | "state"
  | "network"
  | "limit"
  | "aborted";

export class PluginHostError extends Error {
  constructor(
    readonly code: PluginHostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PluginHostError";
  }
}

/** Host-side network implementation; the plugin never calls `fetch` directly. */
export interface PluginTransport {
  request(
    origin: string,
    path: string,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}

export interface PluginContext {
  readonly signal: AbortSignal;
  request(
    origin: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
  log(message: string): void;
}

export interface PluginInstance {
  start(context: PluginContext): Promise<void>;
  stop(): Promise<void>;
}

export type PluginFactory = (context: PluginContext) => PluginInstance;

interface Entry {
  readonly manifest: PluginManifest;
  grant: PluginGrant;
  readonly factory: PluginFactory;
  controller?: AbortController | undefined;
  instance?: PluginInstance | undefined;
  enabled: boolean;
  revoked: boolean;
}

const MAX_PATH_BYTES = 512;

function combineSignals(signals: readonly AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function validatePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > MAX_PATH_BYTES ||
    !/^[A-Za-z0-9._/-]+$/.test(path) ||
    path.startsWith("/") ||
    path.includes("//") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new PluginHostError("denied", `invalid plugin fetch path "${path}"`);
  }
}

/**
 * Minimal in-process trusted host. It enforces manifest, capability, network,
 * size and lifecycle rules, but it is not a Worker/sandbox or a security
 * boundary against malicious in-process code.
 */
export class PluginHost {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly policy: HostPolicy,
    private readonly transport: PluginTransport,
    private readonly logger: (message: string) => void = () => {},
  ) {}

  install(manifestValue: unknown, factory: PluginFactory): PluginManifest {
    const manifest = validateManifest(manifestValue);
    if (this.entries.has(manifest.id)) {
      throw new PluginHostError(
        "duplicate",
        `plugin already installed: ${manifest.id}`,
      );
    }
    const grant = authorize(manifest, this.policy);
    this.entries.set(manifest.id, {
      manifest,
      grant,
      factory,
      enabled: false,
      revoked: false,
    });
    return manifest;
  }

  async enable(id: string): Promise<void> {
    const entry = this.entry(id);
    if (entry.revoked) {
      throw new PluginHostError("denied", `plugin revoked: ${id}`);
    }
    if (entry.enabled) return;
    const controller = new AbortController();
    const context = this.context(entry, controller);
    entry.controller = controller;
    entry.enabled = true;
    try {
      const instance = entry.factory(context);
      entry.instance = instance;
      await instance.start(context);
    } catch (error) {
      entry.enabled = false;
      entry.instance = undefined;
      entry.controller = undefined;
      controller.abort();
      throw new PluginHostError(
        "state",
        `plugin start failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async disable(id: string): Promise<void> {
    const entry = this.entry(id);
    if (!entry.enabled) return;
    entry.enabled = false;
    entry.controller?.abort();
    const instance = entry.instance;
    entry.instance = undefined;
    entry.controller = undefined;
    if (instance !== undefined) {
      try {
        await instance.stop();
      } catch (error) {
        this.logger(
          `[${id}] stop failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async revoke(id: string): Promise<void> {
    await this.disable(id);
    this.entry(id).revoked = true;
  }

  isEnabled(id: string): boolean {
    return this.entry(id).enabled;
  }

  /** Contributions of enabled, non-revoked plugins, namespaced by plugin id. */
  activeContributions(): readonly {
    pluginId: string;
    id: string;
    kind: ContributionKind;
    title: string;
  }[] {
    const result: {
      pluginId: string;
      id: string;
      kind: ContributionKind;
      title: string;
    }[] = [];
    for (const [pluginId, entry] of this.entries) {
      if (!entry.enabled || entry.revoked) continue;
      for (const contribution of entry.manifest.contributions) {
        result.push({
          pluginId,
          id: `${pluginId}:${contribution.id}`,
          kind: contribution.kind,
          title: contribution.title,
        });
      }
    }
    return result;
  }

  grant(id: string): PluginGrant {
    return this.entry(id).grant;
  }

  /**
   * Re-authorize a wider grant. The plugin must be stopped so the new grant is
   * applied on the next enable; a denied request leaves the old grant intact.
   */
  expandGrant(
    id: string,
    capabilities: readonly string[],
    hosts: readonly string[],
  ): PluginGrant {
    const entry = this.entry(id);
    if (entry.revoked) {
      throw new PluginHostError("denied", `plugin revoked: ${id}`);
    }
    if (entry.enabled) {
      throw new PluginHostError("state", "disable the plugin before expanding");
    }
    entry.grant = authorizeExpansion(
      entry.grant,
      { capabilities, hosts },
      this.policy,
    );
    return entry.grant;
  }

  private entry(id: string): Entry {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      throw new PluginHostError("unknown", `unknown plugin: ${id}`);
    }
    return entry;
  }

  private context(entry: Entry, controller: AbortController): PluginContext {
    const request = async (
      origin: string,
      path: string,
      signal?: AbortSignal,
    ): Promise<Uint8Array> => {
      if (controller.signal.aborted) {
        throw new PluginHostError("aborted", "plugin disabled");
      }
      const normalized = normalizeOrigin(origin);
      if (!entry.grant.hosts.includes(normalized)) {
        throw new PluginHostError(
          "denied",
          `network host not granted: ${normalized}`,
        );
      }
      validatePath(path);
      const combined = combineSignals(
        signal === undefined
          ? [controller.signal]
          : [controller.signal, signal],
      );
      let bytes: Uint8Array;
      try {
        bytes = await this.transport.request(normalized, path, combined);
      } catch (error) {
        if (combined.aborted) {
          throw new PluginHostError("aborted", "plugin fetch aborted");
        }
        throw new PluginHostError(
          "network",
          `plugin fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (combined.aborted) {
        throw new PluginHostError("aborted", "plugin fetch aborted");
      }
      if (bytes.byteLength > entry.grant.maxFetchBytes) {
        throw new PluginHostError(
          "limit",
          `plugin response exceeds ${entry.grant.maxFetchBytes} bytes`,
        );
      }
      return bytes;
    };
    return Object.freeze({
      signal: controller.signal,
      request,
      log: (message: string) => {
        if (!controller.signal.aborted) {
          this.logger(`[${entry.manifest.id}] ${message}`);
        }
      },
    });
  }
}
