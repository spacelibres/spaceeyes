// Trusted host utility; catalog construction is not exposed to plugins.
export interface ResourceEntry { readonly id: string; readonly path: string; readonly maxBytes: number }
type Options = { fetch?: typeof globalThis.fetch; cacheBytes?: number };

export class ResourceClient {
  #catalog = new Map<string, Readonly<ResourceEntry>>();
  #cache = new Map<string, Uint8Array>();
  #bytes = 0;
  #generation = 0n;
  #budget: number;
  #fetch: typeof globalThis.fetch;

  constructor(entries: readonly ResourceEntry[], options: Options = {}) {
    this.#budget = options.cacheBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(this.#budget) || this.#budget < 0 || this.#budget > 256 * 1024 * 1024) throw new Error('invalid cache budget');
    if (entries.length > 4096) throw new Error('resource catalog budget');
    for (const entry of entries) {
      if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(entry.id) || this.#catalog.has(entry.id)) throw new Error('invalid or duplicate resource id');
      if (!/^\/[A-Za-z0-9._/-]+$/.test(entry.path) || entry.path.length > 512 ||
        entry.path.slice(1).split('/').some(part => !part || part === '.' || part === '..')) throw new Error('invalid resource path');
      if (!Number.isSafeInteger(entry.maxBytes) || entry.maxBytes < 1 || entry.maxBytes > 16 * 1024 * 1024) throw new Error('invalid resource size budget');
      this.#catalog.set(entry.id, Object.freeze({ ...entry }));
    }
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async read(id: string, signal?: AbortSignal): Promise<Uint8Array> {
    const generation = this.#generation;
    signal?.throwIfAborted();
    const entry = this.#catalog.get(id);
    if (!entry) throw new Error('unknown resource');
    const cached = this.#cache.get(id);
    if (cached) {
      this.#cache.delete(id); this.#cache.set(id, cached);
      return cached.slice();
    }
    const response = await this.#fetch(entry.path, { signal, redirect: 'error', credentials: 'same-origin' });
    if (generation !== this.#generation) { await response.body?.cancel(); throw new Error('resource request invalidated'); }
    if (signal?.aborted) { await response.body?.cancel(); signal.throwIfAborted(); }
    if (response.redirected) { await response.body?.cancel(); throw new Error('resource redirect refused'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`resource HTTP ${response.status}`); }
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > entry.maxBytes)) {
      await response.body?.cancel(); throw new Error('resource size limit');
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = response.body?.getReader();
    try {
      if (reader) while (true) {
        signal?.throwIfAborted();
        const chunk = await reader.read();
        signal?.throwIfAborted();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > entry.maxBytes) throw new Error('resource size limit');
        chunks.push(chunk.value);
      }
      if (declared !== null && Number(declared) !== length) throw new Error('resource size mismatch');
      signal?.throwIfAborted();
      if (generation !== this.#generation) throw new Error('resource request invalidated');
    } catch (error) {
      await reader?.cancel().catch(() => {});
      throw error;
    } finally { reader?.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (length <= this.#budget) {
      // Concurrent reads may finish in either order; account for an existing entry.
      const previous = this.#cache.get(id);
      if (previous) { this.#bytes -= previous.byteLength; this.#cache.delete(id); }
      while (this.#bytes + length > this.#budget && this.#cache.size) {
        const key = this.#cache.keys().next().value!;
        this.#bytes -= this.#cache.get(key)!.byteLength; this.#cache.delete(key);
      }
      this.#cache.set(id, bytes); this.#bytes += length;
    }
    return bytes.slice();
  }

  clear(): void { this.#generation++; this.#cache.clear(); this.#bytes = 0; }
}
