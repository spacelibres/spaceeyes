import { NasaDynStore, nasaDynStore } from "./nasa-dyn-store.ts";

class ReadLane {
  #active = 0;
  #waiters: {
    signal: AbortSignal;
    abort: () => void;
    grant: () => void;
    foreground: () => boolean;
  }[] = [];
  readonly #limit: number;
  constructor(limit: number) {
    this.#limit = limit;
  }
  acquire(signal: AbortSignal, foreground: () => boolean): Promise<() => void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const waiter = {
        signal,
        foreground,
        abort: () => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(signal.reason);
        },
        grant: () => {
          signal.removeEventListener("abort", waiter.abort);
          this.#active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.#active--;
            const preferred = this.#waiters.findIndex((waiter) =>
              waiter.foreground(),
            );
            this.#waiters.splice(preferred < 0 ? 0 : preferred, 1)[0]?.grant();
          });
        },
      };
      if (this.#active < this.#limit) waiter.grant();
      else {
        this.#waiters.push(waiter);
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
    });
  }
}
/** Server-only exact upstream byte cache. Decoding and scientific review remain callers' responsibility. */
export class DynByteCache {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #ttl: number;
  readonly #responseBytes: number;
  readonly #store?: NasaDynStore;
  readonly #requests = new ReadLane(32);
  readonly #bodies = new ReadLane(4);
  #bytes = 0;
  #generation = 0;
  #entries = new Map<string, { bytes: Uint8Array; expires: number; local: boolean }>();
  #pending = new Map<
    string,
    {
      controller: AbortController;
      owners: Set<symbol>;
      foreground: boolean;
      promise: Promise<Uint8Array>;
    }
  >();
  constructor(
    options: {
      fetcher?: typeof fetch;
      now?: () => number;
      maxBytes?: number;
      maxEntries?: number;
      ttlMs?: number;
      maxResponseBytes?: number;
      store?: NasaDynStore;
    } = {},
  ) {
    const bounded = (value: number | undefined, fallback: number) => {
      const n = value ?? fallback;
      if (!Number.isSafeInteger(n) || n < 1 || n > fallback)
        throw Error("Invalid DYN cache budget");
      return n;
    };
    this.#fetch = options.fetcher ?? fetch;
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
    this.#maxBytes = bounded(options.maxBytes, 64 * 1024 * 1024);
    this.#maxEntries = bounded(options.maxEntries, 512);
    this.#ttl = bounded(options.ttlMs, 30000);
    this.#responseBytes = bounded(options.maxResponseBytes, 16 * 1024 * 1024);
  }
  get diagnostics() {
    return {
      entries: this.#entries.size,
      bytes: this.#bytes,
      pending: this.#pending.size,
    };
  }
  private drop(url: string) {
    const old = this.#entries.get(url);
    if (old) {
      this.#bytes -= old.bytes.length;
      this.#entries.delete(url);
    }
  }
  evict(url: string, invalidateLocal = true) {
    const retryUpstream = invalidateLocal && !!this.#entries.get(url)?.local && !!this.#store && !this.#store.offline;
    this.drop(url);
    if (invalidateLocal) this.#store?.invalidate(url);
    return retryUpstream;
  }
  clear() {
    this.#generation++;
    this.#entries.clear();
    this.#bytes = 0;
    for (const flow of this.#pending.values()) flow.controller.abort();
    this.#pending.clear();
  }
  async read(
    url: string,
    signal: AbortSignal,
    background = false,
  ): Promise<Uint8Array> {
    signal.throwIfAborted();
    const old = this.#entries.get(url);
    if (old && old.expires > this.#now()) {
      this.#entries.delete(url);
      this.#entries.set(url, old);
      return old.bytes.slice();
    }
    this.drop(url);
    let flow = this.#pending.get(url);
    if (!flow) {
      if (this.#pending.size >= (background ? 448 : 512))
        throw Error("DYN pending request budget");
      const controller = new AbortController(),
        generation = this.#generation;
      flow = {
        controller,
        owners: new Set<symbol>(),
        foreground: !background,
        promise: undefined!,
      };
      const current = flow;
      this.#pending.set(url, current);
      current.promise = Promise.resolve()
        .then(() =>
          this.#load(url, controller.signal, () => current.foreground),
        )
        .then(({ bytes, local }) => {
          controller.signal.throwIfAborted();
          if (
            generation !== this.#generation ||
            this.#pending.get(url) !== current
          )
            throw new DOMException("Cache cleared", "AbortError");
          if (bytes.length <= this.#maxBytes) {
            while (
              this.#entries.size >= this.#maxEntries ||
              this.#bytes + bytes.length > this.#maxBytes
            )
              this.drop(this.#entries.keys().next().value!);
            this.#entries.set(url, { bytes, local, expires: this.#now() + this.#ttl });
            this.#bytes += bytes.length;
          }
          return bytes;
        })
        .finally(() => {
          if (this.#pending.get(url) === current) this.#pending.delete(url);
        });
    }
    if (!background) flow.foreground = true;
    const current = flow,
      owner = Symbol();
    current.owners.add(owner);
    const ownerSignal = AbortSignal.any([signal, current.controller.signal]);
    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, bytes?: Uint8Array) => {
        if (settled) return;
        settled = true;
        ownerSignal.removeEventListener("abort", abort);
        current.owners.delete(owner);
        if (!current.owners.size && this.#pending.get(url) === current) {
          this.#pending.delete(url);
          current.controller.abort();
        }
        if (error !== undefined) reject(error);
        else resolve(bytes!.slice());
      };
      const abort = () =>
        finish(ownerSignal.reason ?? new DOMException("Aborted", "AbortError"));
      ownerSignal.addEventListener("abort", abort, { once: true });
      current.promise.then(
        (bytes) => finish(undefined, bytes),
        (error) => finish(error),
      );
      if (ownerSignal.aborted) abort();
    });
  }
  async #load(
    url: string,
    ownerSignal: AbortSignal,
    foreground: () => boolean,
  ) {
    const signal = AbortSignal.any([ownerSignal, AbortSignal.timeout(20000)]);
    signal.throwIfAborted();
    if (this.#store) {
      const local = await this.#store.read(url, signal);
      if (local) return { bytes: local, local: true };
      if (this.#store.offline) throw Error("local DYN unavailable");
    }
    const releaseRequest = await this.#requests.acquire(signal, foreground);
    try {
      const response = await this.#fetch(url, { signal, redirect: "error" });
      if (signal.aborted) {
        await response.body?.cancel();
        signal.throwIfAborted();
      }
      if (!response.ok || response.redirected) {
        await response.body?.cancel();
        throw Error(`NASA DYN HTTP ${response.status}`);
      }
      let releaseBody: () => void;
      try {
        releaseBody = await this.#bodies.acquire(signal, foreground);
      } catch (error) {
        await response.body?.cancel();
        throw error;
      }
      const reader = response.body?.getReader(),
        parts: Uint8Array[] = [];
      let length = 0;
      const abort = () => {
        void reader?.cancel(signal.reason).catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        while (reader) {
          const { done, value } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          length += value.length;
          if (length > this.#responseBytes) throw Error("DYN byte budget");
          parts.push(value);
        }
        signal.throwIfAborted();
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        if (this.#store) await this.#store.write(url, bytes, signal);
        return { bytes, local: false };
      } catch (error) {
        await reader?.cancel().catch(() => {});
        throw error;
      } finally {
        signal.removeEventListener("abort", abort);
        reader?.releaseLock();
        releaseBody();
      }
    } finally {
      releaseRequest();
    }
  }
}
const caches = new WeakMap<typeof fetch, DynByteCache>();
export function dynByteCacheFor(fetcher: typeof fetch): DynByteCache {
  let cache = caches.get(fetcher);
  if (!cache) {
    cache = new DynByteCache({ fetcher, ...(fetcher === fetch ? { store: nasaDynStore } : {}) });
    caches.set(fetcher, cache);
  }
  return cache;
}
