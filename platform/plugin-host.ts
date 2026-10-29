// Original SPACEEYES code, MIT. Trusted in-process plugin lifecycle only.
import type { CorePort } from "./core-port.ts";
import {
  snapshotState,
  targetId as validateTargetId,
  type ObjectState,
} from "./state-contract.ts";
import {
  snapshotVisual,
  type VisualSpec,
  type VisualStatus,
} from "./visual-contract.ts";
export type Capability =
  | "data.publish"
  | "camera.control"
  | "time.control"
  | "scene.visual";
export type PluginStatus =
  | "registered"
  | "starting"
  | "active"
  | "stopping"
  | "disabled"
  | "failed";
type Dispose = () => void | Promise<void>;
export interface PluginContext {
  readonly pluginId: string;
  readonly signal: AbortSignal;
  readonly camera: {
    view(mode: "overview" | "top" | "front" | "side" | "orbit"): void;
    focus(targetId: string): void;
  };
  readonly visual: {
    trajectory(targetId: string, points: [number, number, number][]): void;
    label(targetId: string, text: string): void;
    layers(layers: { labels: boolean; trajectories: boolean }): void;
    set(targetId: string, spec: VisualSpec): void;
    clear(targetId: string): void;
    status(targetId: string): Readonly<VisualStatus> | null;
  };
  readonly data: {
    publish(targetId: string, state: ObjectState): void;
    remove(targetId: string): void;
  };
  readonly time: {
    seek(epochTdbSeconds: number): void;
    setPlayback(playing: boolean, rate: number): void;
  };
  requireCapability(capability: Capability): void;
  onDispose(dispose: Dispose): void;
}
export interface PluginManifest {
  readonly id: string;
  readonly apiVersion: number;
  readonly capabilities: readonly string[];
}
export type Activate = (
  context: PluginContext,
) => void | Dispose | Promise<void | Dispose>;
type Session = {
  controller: AbortController;
  live: boolean;
  disposers: Dispose[];
};
type Entry = {
  manifest: PluginManifest;
  activate: Activate;
  state: PluginStatus;
  busy: boolean;
  session?: Session;
  pending?: Promise<void>;
};
const capabilities = new Set<string>([
  "data.publish",
  "camera.control",
  "time.control",
  "scene.visual",
]);

export class PluginHost {
  #entries = new Map<string, Entry>();
  #core: CorePort | undefined;
  #closed = false;
  #shutdownTask: Promise<void> | undefined;

  constructor(core?: CorePort) {
    this.#core = core;
  }

  register(manifest: PluginManifest, activate: Activate): void {
    if (this.#closed) throw new Error("plugin host closed");
    if (
      !manifest ||
      typeof manifest.id !== "string" ||
      !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(manifest.id) ||
      manifest.apiVersion !== 1 ||
      !Array.isArray(manifest.capabilities) ||
      !manifest.capabilities.every((value) => capabilities.has(value)) ||
      new Set(manifest.capabilities).size !== manifest.capabilities.length ||
      typeof activate !== "function"
    ) {
      throw new Error("invalid or incompatible plugin manifest");
    }
    if (this.#entries.has(manifest.id)) throw new Error("duplicate plugin id");
    const snapshot = Object.freeze({
      ...manifest,
      capabilities: Object.freeze([...manifest.capabilities]),
    });
    this.#entries.set(manifest.id, {
      manifest: snapshot,
      activate,
      state: "registered",
      busy: false,
    });
  }

  status(id: string): PluginStatus {
    return this.#entry(id).state;
  }

  async enable(id: string, approved: readonly Capability[]): Promise<void> {
    if (this.#closed) throw new Error("plugin host closed");
    const entry = this.#entry(id);
    if (entry.busy) throw new Error("plugin lifecycle busy");
    const operation = this.#enable(id, approved);
    entry.pending = operation;
    try {
      await operation;
    } finally {
      entry.pending = undefined;
    }
  }

  async #enable(id: string, approved: readonly Capability[]): Promise<void> {
    const entry = this.#entry(id);
    if (entry.busy) throw new Error("plugin lifecycle busy");
    if (entry.state === "active") return;
    const granted = new Set(approved);
    if (
      entry.manifest.capabilities.some(
        (value) => !granted.has(value as Capability),
      )
    ) {
      throw new Error("plugin permission not approved");
    }
    entry.busy = true;
    entry.state = "starting";
    const session: Session = {
      controller: new AbortController(),
      live: true,
      disposers: [],
    };
    const sessionId = globalThis.crypto.randomUUID();
    const core = this.#core;
    if (core) session.disposers.push(() => core.releaseSession(sessionId));
    entry.session = session;
    const live = () => {
      if (!session.live || this.#closed)
        throw new Error("plugin session inactive");
    };
    const requireCapability = (capability: Capability) => {
      live();
      if (
        !entry.manifest.capabilities.includes(capability) ||
        !granted.has(capability)
      ) {
        throw new Error("plugin permission denied");
      }
    };
    const context: PluginContext = Object.freeze({
      pluginId: id,
      signal: session.controller.signal,
      visual: Object.freeze({
        trajectory(targetId: string, points: [number, number, number][]) {
          requireCapability("scene.visual");
          validateTargetId(targetId);
          if (
            !Array.isArray(points) ||
            points.length > 4096 ||
            points.some(
              (p) =>
                !Array.isArray(p) ||
                p.length !== 3 ||
                !p.every(Number.isFinite),
            )
          )
            throw new Error("invalid trajectory");
          if (!core?.trajectory) throw new Error("trajectory unavailable");
          core.trajectory({
            pluginId: id,
            sessionId,
            targetId,
            points: points.map((p) => [...p]),
          });
        },
        label(targetId: string, text: string) {
          requireCapability("scene.visual");
          validateTargetId(targetId);
          if (
            typeof text !== "string" ||
            [...text].length > 256 ||
            /[\x00-\x1f\x7f]/.test(text)
          )
            throw new Error("invalid label");
          if (!core?.label) throw new Error("label unavailable");
          core.label({ pluginId: id, sessionId, targetId, text });
        },
        layers(layers: { labels: boolean; trajectories: boolean }) {
          requireCapability("scene.visual");
          if (
            !layers ||
            typeof layers.labels !== "boolean" ||
            typeof layers.trajectories !== "boolean"
          )
            throw new Error("invalid layers");
          if (!core?.layers) throw new Error("layers unavailable");
          core.layers({
            pluginId: id,
            sessionId,
            labels: layers.labels,
            trajectories: layers.trajectories,
          });
        },
        set(targetId: string, spec: VisualSpec) {
          requireCapability("scene.visual");
          validateTargetId(targetId);
          const snapshot = snapshotVisual(spec);
          if (!core?.setVisual) throw new Error("visual core unavailable");
          core.setVisual(
            Object.freeze({
              pluginId: id,
              sessionId,
              targetId,
              spec: snapshot,
            }),
          );
        },
        clear(targetId: string) {
          requireCapability("scene.visual");
          validateTargetId(targetId);
          if (!core?.setVisual) throw new Error("visual core unavailable");
          core.setVisual(
            Object.freeze({ pluginId: id, sessionId, targetId, spec: null }),
          );
        },
        status(targetId: string) {
          requireCapability("scene.visual");
          validateTargetId(targetId);
          if (!core?.visualStatus) throw new Error("visual core unavailable");
          const result = core.visualStatus(
            Object.freeze({ pluginId: id, sessionId, targetId }),
          );
          return result ? Object.freeze({ ...result }) : null;
        },
      }),
      camera: Object.freeze({
        view(mode: "overview" | "top" | "front" | "side" | "orbit") {
          requireCapability("camera.control");
          if (!core?.cameraView) throw new Error("camera view unavailable");
          core.cameraView({ pluginId: id, sessionId, mode });
        },
        focus(targetId: string) {
          requireCapability("camera.control");
          validateTargetId(targetId);
          if (!core) throw new Error("render core unavailable");
          core.focus(Object.freeze({ pluginId: id, sessionId, targetId }));
        },
      }),
      data: Object.freeze({
        publish(targetId: string, state: ObjectState) {
          requireCapability("data.publish");
          validateTargetId(targetId);
          const snapshot = snapshotState(state);
          if (!core?.publishObject) throw new Error("data core unavailable");
          core.publishObject(
            Object.freeze({
              pluginId: id,
              sessionId,
              targetId,
              state: snapshot,
            }),
          );
        },
        remove(targetId: string) {
          requireCapability("data.publish");
          validateTargetId(targetId);
          if (!core?.removeObject) throw new Error("data core unavailable");
          core.removeObject(
            Object.freeze({ pluginId: id, sessionId, targetId }),
          );
        },
      }),
      time: Object.freeze({
        seek(epochTdbSeconds: number) {
          requireCapability("time.control");
          if (!Number.isFinite(epochTdbSeconds))
            throw new Error("invalid time");
          if (!core?.seek) throw new Error("time core unavailable");
          core.seek(
            Object.freeze({ pluginId: id, sessionId, epochTdbSeconds }),
          );
        },
        setPlayback(playing: boolean, rate: number) {
          requireCapability("time.control");
          if (typeof playing !== "boolean" || !Number.isFinite(rate))
            throw new Error("invalid time playback");
          if (!core?.setPlayback) throw new Error("time core unavailable");
          core.setPlayback(
            Object.freeze({ pluginId: id, sessionId, playing, rate }),
          );
        },
      }),
      requireCapability,
      onDispose(dispose: Dispose) {
        live();
        if (typeof dispose !== "function")
          throw new Error("invalid cleanup callback");
        session.disposers.push(dispose);
      },
    });
    try {
      core?.openSession(
        Object.freeze({
          pluginId: id,
          sessionId,
          cameraControl:
            entry.manifest.capabilities.includes("camera.control") &&
            granted.has("camera.control"),
          dataPublish:
            entry.manifest.capabilities.includes("data.publish") &&
            granted.has("data.publish"),
          timeControl:
            entry.manifest.capabilities.includes("time.control") &&
            granted.has("time.control"),
          visualControl:
            entry.manifest.capabilities.includes("scene.visual") &&
            granted.has("scene.visual"),
        }),
      );
      const dispose = await entry.activate(context);
      if (dispose !== undefined) {
        if (typeof dispose !== "function")
          throw new Error("invalid activation cleanup");
        session.disposers.push(dispose);
      }
      entry.state = "active";
    } catch (error) {
      const cleanupErrors = await this.#release(session);
      entry.session = undefined;
      entry.state = "failed";
      if (cleanupErrors.length)
        throw new AggregateError(
          [error, ...cleanupErrors],
          "activation and cleanup failed",
        );
      throw error;
    } finally {
      entry.busy = false;
    }
  }

  async disable(id: string): Promise<void> {
    const entry = this.#entry(id);
    if (entry.busy) throw new Error("plugin lifecycle busy");
    const operation = this.#disable(id);
    entry.pending = operation;
    try {
      await operation;
    } finally {
      entry.pending = undefined;
    }
  }

  async #disable(id: string): Promise<void> {
    const entry = this.#entry(id);
    if (entry.busy) throw new Error("plugin lifecycle busy");
    if (!entry.session) return;
    entry.busy = true;
    entry.state = "stopping";
    try {
      const errors = await this.#release(entry.session);
      entry.session = undefined;
      entry.state = errors.length ? "failed" : "disabled";
      if (errors.length)
        throw new AggregateError(errors, "plugin cleanup failed");
    } finally {
      entry.busy = false;
    }
  }

  #entry(id: string): Entry {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error(`unknown plugin: ${id}`);
    return entry;
  }

  shutdown(): Promise<void> {
    if (this.#shutdownTask) return this.#shutdownTask;
    this.#closed = true;
    this.#shutdownTask = this.#shutdown();
    return this.#shutdownTask;
  }

  async #shutdown(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const entry of this.#entries.values()) {
      if (entry.pending) pending.push(entry.pending);
      if (entry.session) {
        entry.session.live = false;
        entry.session.controller.abort();
      }
    }
    const completed = await Promise.allSettled(pending);
    const errors = completed.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    for (const id of this.#entries.keys()) {
      try {
        await this.disable(id);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "plugin host shutdown failed");
  }

  async #release(session: Session): Promise<unknown[]> {
    session.live = false;
    session.controller.abort();
    const errors: unknown[] = [];
    for (const dispose of session.disposers.splice(0).reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }
}
