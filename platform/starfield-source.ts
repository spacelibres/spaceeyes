import { ResourceClient } from "./resource-client.ts";
import { decodeStarfield } from "./starfield.ts";
import type { PluginContext } from "./plugin-host.ts";
import type { StarfieldSpec } from "./starfield-contract.ts";
import catalog from "../validation/eyes-stars.json" with { type: "json" };

export type StarfieldProgress = {
  enabled: boolean;
  loading: boolean;
  readyLayers: number;
  totalLayers: number;
  pointCount: number;
  error: string;
};
type Entry = { file: string; sha256: string; bytes: number };
// Trusted data-plugin configuration. The public SDK does not accept source URLs.
export class StarfieldSource {
  #ctx: PluginContext;
  #entries: Entry[];
  #resources: ResourceClient;
  #cache = new Map<string, StarfieldSpec>();
  #published = new Set<string>();
  #errors = new Map<string, string>();
  #abort = new AbortController();
  #generation = 0;
  #closed = false;
  #enabled = false;
  #loading = false;
  #pending: Promise<void> = Promise.resolve();
  #update: (status: StarfieldProgress) => void;
  constructor(
    ctx: PluginContext,
    update: (status: StarfieldProgress) => void,
    options: { entries?: readonly Entry[]; fetch?: typeof fetch } = {},
  ) {
    this.#ctx = ctx;
    this.#update = update;
    this.#entries = [...(options.entries ?? catalog.files)].sort(
      (a, b) =>
        Number(b.file === "stars.0.bin") - Number(a.file === "stars.0.bin"),
    );
    if (
      this.#entries.length > 8 ||
      this.#entries.some(
        (entry) =>
          !/^(?:stars\.[0-5]|galaxies\.0)\.bin$/.test(entry.file) ||
          !/^[a-f0-9]{64}$/.test(entry.sha256),
      )
    )
      throw Error("Invalid starfield resource catalog");
    this.#resources = new ResourceClient(
      this.#entries.map((entry) => ({
        id: entry.file,
        path: `/api/starfield/${entry.file}`,
        maxBytes: entry.bytes,
      })),
      { fetch: options.fetch, cacheBytes: 0 },
    );
    ctx.onDispose(() => this.dispose());
  }
  status(): StarfieldProgress {
    return {
      enabled: this.#enabled,
      loading: this.#loading,
      readyLayers: this.#published.size,
      totalLayers: this.#entries.length,
      pointCount: [...this.#published].reduce(
        (sum, id) => sum + this.#cache.get(id)!.magnitudes.length,
        0,
      ),
      error: [...this.#errors]
        .map(([file, error]) => `${file}: ${error}`)
        .join("；"),
    };
  }
  #emit() {
    if (!this.#closed) this.#update(this.status());
  }
  enable(enabled: boolean): Promise<void> {
    if (this.#closed || this.#ctx.signal.aborted)
      return Promise.reject(Error("Starfield source closed"));
    if (enabled && this.#enabled) return this.#pending;
    const generation = ++this.#generation;
    this.#abort.abort();
    this.#abort = new AbortController();
    this.#enabled = enabled;
    this.#loading = enabled;
    this.#errors.clear();
    if (!enabled) {
      for (const id of this.#published) this.#ctx.visual.starfield(id, null);
      this.#published.clear();
      this.#emit();
      return Promise.resolve();
    }
    const signal = AbortSignal.any([this.#ctx.signal, this.#abort.signal]);
    const live = () =>
      !this.#closed && generation === this.#generation && !signal.aborted;
    this.#emit();
    let next = 0;
    this.#pending = Promise.all(
      Array.from({ length: 2 }, async () => {
        while (live() && next < this.#entries.length) {
          const entry = this.#entries[next++];
          try {
            if (this.#published.has(entry.file)) continue;
            let spec = this.#cache.get(entry.file);
            if (!spec) {
              const bytes = await this.#resources.read(entry.file, signal);
              if (!live()) return;
              const hash = [
                ...new Uint8Array(
                  await crypto.subtle.digest(
                    "SHA-256",
                    bytes.slice().buffer as ArrayBuffer,
                  ),
                ),
              ]
                .map((value) => value.toString(16).padStart(2, "0"))
                .join("");
              if (!live()) return;
              if (bytes.length !== entry.bytes || hash !== entry.sha256) {
                throw Error("Starfield SHA256/length mismatch");
              }
              spec = decodeStarfield(
                bytes,
                `NASA Eyes ${entry.file} SHA256 ${hash}`,
              );
              if (
                [...this.#cache.values()].reduce(
                  (sum, layer) => sum + layer.magnitudes.length,
                  0,
                ) +
                  spec.magnitudes.length >
                50000
              )
                throw Error("Starfield parsed cache point budget");
              this.#cache.set(entry.file, spec);
            }
            if (!live()) return;
            this.#ctx.visual.starfield(entry.file, spec);
            this.#published.add(entry.file);
            this.#emit();
          } catch (error) {
            if (!live()) return;
            this.#errors.set(entry.file, String(error));
            this.#emit();
          }
        }
      }),
    ).then(() => {
      if (live()) {
        this.#loading = false;
        this.#emit();
      }
    });
    return this.#pending;
  }
  async retry() {
    if (!this.#enabled) return this.enable(true);
    // Retain verified parsed layers; re-fetch only entries that did not succeed.
    this.#enabled = false;
    await this.enable(true);
  }
  dispose() {
    if (this.#closed) return;
    this.#closed = true;
    this.#generation++;
    this.#abort.abort();
    for (const id of this.#published) {
      // PluginHost may already have revoked the SDK; Rust releases session layers.
      try {
        this.#ctx.visual.starfield(id, null);
      } catch {}
    }
    this.#published.clear();
    this.#cache.clear();
    this.#resources.clear();
  }
}
