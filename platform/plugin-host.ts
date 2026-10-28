// Original SPACEEYES code, MIT. Trusted in-process plugin lifecycle only.
import type { CorePort } from './core-port.ts';
export type Capability = 'data.publish' | 'camera.control';
export type PluginStatus = 'registered' | 'starting' | 'active' | 'stopping' | 'disabled' | 'failed';
type Dispose = () => void | Promise<void>;
export interface PluginContext {
  readonly pluginId: string;
  readonly signal: AbortSignal;
  readonly camera: { focus(targetId: string): void };
  requireCapability(capability: Capability): void;
  onDispose(dispose: Dispose): void;
}
export interface PluginManifest {
  readonly id: string;
  readonly apiVersion: number;
  readonly capabilities: readonly string[];
}
export type Activate = (context: PluginContext) => void | Dispose | Promise<void | Dispose>;
type Session = { controller: AbortController; live: boolean; disposers: Dispose[] };
type Entry = { manifest: PluginManifest; activate: Activate; state: PluginStatus; busy: boolean; session?: Session };
const capabilities = new Set<string>(['data.publish', 'camera.control']);

export class PluginHost {
  #entries = new Map<string, Entry>();
  #core: CorePort | undefined;

  constructor(core?: CorePort) { this.#core = core; }

  register(manifest: PluginManifest, activate: Activate): void {
    if (!manifest || typeof manifest.id !== 'string' || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(manifest.id) ||
      manifest.apiVersion !== 1 || !Array.isArray(manifest.capabilities) ||
      !manifest.capabilities.every(value => capabilities.has(value)) ||
      new Set(manifest.capabilities).size !== manifest.capabilities.length || typeof activate !== 'function') {
      throw new Error('invalid or incompatible plugin manifest');
    }
    if (this.#entries.has(manifest.id)) throw new Error('duplicate plugin id');
    const snapshot = Object.freeze({ ...manifest, capabilities: Object.freeze([...manifest.capabilities]) });
    this.#entries.set(manifest.id, { manifest: snapshot, activate, state: 'registered', busy: false });
  }

  status(id: string): PluginStatus { return this.#entry(id).state; }

  async enable(id: string, approved: readonly Capability[]): Promise<void> {
    const entry = this.#entry(id);
    if (entry.busy) throw new Error('plugin lifecycle busy');
    if (entry.state === 'active') return;
    const granted = new Set(approved);
    if (entry.manifest.capabilities.some(value => !granted.has(value as Capability))) {
      throw new Error('plugin permission not approved');
    }
    entry.busy = true;
    entry.state = 'starting';
    const session: Session = { controller: new AbortController(), live: true, disposers: [] };
    const sessionId = globalThis.crypto.randomUUID();
    const core = this.#core;
    if (core) session.disposers.push(() => core.releaseSession(sessionId));
    entry.session = session;
    const live = () => { if (!session.live) throw new Error('plugin session inactive'); };
    const requireCapability = (capability: Capability) => {
      live();
      if (!entry.manifest.capabilities.includes(capability) || !granted.has(capability)) {
        throw new Error('plugin permission denied');
      }
    };
    const context: PluginContext = Object.freeze({
      pluginId: id,
      signal: session.controller.signal,
      camera: Object.freeze({ focus(targetId: string) {
        requireCapability('camera.control');
        if (typeof targetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/.test(targetId)) {
          throw new Error('invalid target id');
        }
        if (!core) throw new Error('render core unavailable');
        core.focus(Object.freeze({ pluginId: id, sessionId, targetId }));
      } }),
      requireCapability,
      onDispose(dispose: Dispose) {
        live();
        if (typeof dispose !== 'function') throw new Error('invalid cleanup callback');
        session.disposers.push(dispose);
      },
    });
    try {
      core?.openSession(Object.freeze({ pluginId: id, sessionId,
        cameraControl: entry.manifest.capabilities.includes('camera.control') && granted.has('camera.control') }));
      const dispose = await entry.activate(context);
      if (dispose !== undefined) {
        if (typeof dispose !== 'function') throw new Error('invalid activation cleanup');
        session.disposers.push(dispose);
      }
      entry.state = 'active';
    } catch (error) {
      const cleanupErrors = await this.#release(session);
      entry.session = undefined;
      entry.state = 'failed';
      if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'activation and cleanup failed');
      throw error;
    } finally { entry.busy = false; }
  }

  async disable(id: string): Promise<void> {
    const entry = this.#entry(id);
    if (entry.busy) throw new Error('plugin lifecycle busy');
    if (!entry.session) return;
    entry.busy = true;
    entry.state = 'stopping';
    try {
      const errors = await this.#release(entry.session);
      entry.session = undefined;
      entry.state = errors.length ? 'failed' : 'disabled';
      if (errors.length) throw new AggregateError(errors, 'plugin cleanup failed');
    } finally { entry.busy = false; }
  }

  #entry(id: string): Entry {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error(`unknown plugin: ${id}`);
    return entry;
  }

  async #release(session: Session): Promise<unknown[]> {
    session.live = false;
    session.controller.abort();
    const errors: unknown[] = [];
    for (const dispose of session.disposers.splice(0).reverse()) {
      try { await dispose(); } catch (error) { errors.push(error); }
    }
    return errors;
  }
}
