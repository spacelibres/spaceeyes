import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { decodeGalaxy, toneMapGalaxy } from "./galaxy-convert.ts";
import manifest from "../../validation/galaxy-assets.json" with { type: "json" };
type Asset = { bytes: Uint8Array; sha256: string };
type Job = {
  controller: AbortController;
  users: number;
  promise: Promise<Asset>;
};
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export class GalaxyService {
  #job: Job | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  #directory: string;
  #fetch: typeof fetch;
  constructor(options: { directory?: string; fetch?: typeof fetch } = {}) {
    this.#directory = resolve(options.directory ?? ".cache/galaxy");
    this.#fetch = options.fetch ?? fetch;
  }
  get(file: string, signal: AbortSignal): Promise<Asset> {
    if (file === "milkyway-preview.webp") return this.get("milkyway.webp", signal).then(async asset => {
      signal.throwIfAborted();
      const bytes = await sharp(asset.bytes).resize(1024, 512).webp({quality: 85}).toBuffer();
      signal.throwIfAborted();
      return {bytes, sha256: hash(bytes)};
    });
    if (file !== "milkyway.webp")
      return Promise.reject(Error("Unknown galaxy asset"));
    if (signal.aborted) return Promise.reject(signal.reason);
    let job = this.#job;
    if (!job) {
      const controller = new AbortController();
      job = {
        controller,
        users: 0,
        promise: Promise.resolve(null as unknown as Asset),
      };
      const owned = job;
      const queued = this.#tail
        .catch(() => {})
        .then(() =>
          this.#read(
            AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
          ),
        );
      this.#tail = queued.catch(() => {});
      owned.promise = queued.finally(() => {
        if (this.#job === owned) this.#job = undefined;
      });
      this.#job = job;
    }
    const owned = job;
    owned.users++;
    return new Promise((resolve, reject) => {
      let done = false;
      const release = () => {
        if (done) return false;
        done = true;
        signal.removeEventListener("abort", abort);
        if (--owned.users === 0) {
          owned.controller.abort();
          if (this.#job === owned) this.#job = undefined;
        }
        return true;
      };
      const abort = () => {
        if (release()) reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      owned.promise.then(
        (asset) => {
          if (release())
            resolve({ bytes: asset.bytes.slice(), sha256: asset.sha256 });
        },
        (error) => {
          if (release()) reject(error);
        },
      );
    });
  }
  async #read(signal: AbortSignal): Promise<Asset> {
    signal.throwIfAborted();
    const path = join(
      this.#directory,
      `${manifest.sourceSha256}-${manifest.conversion}.webp`,
    );
    const metadataPath = path + ".json";
    try {
      const info = await stat(path);
      if (info.size > 8 * 1024 * 1024) throw Error("Galaxy cache budget");
      const bytes = await readFile(path),
        metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      signal.throwIfAborted();
      if (
        metadata.sourceSha256 === manifest.sourceSha256 &&
        metadata.conversion === manifest.conversion &&
        metadata.sha256 === hash(bytes)
      )
        return { bytes, sha256: metadata.sha256 };
    } catch {
      signal.throwIfAborted();
    }
    const response = await this.#fetch(manifest.source, {
      redirect: "error",
      cache: "no-store",
      signal,
    });
    if (!response.ok || response.redirected) {
      await response.body?.cancel();
      throw Error("Galaxy source HTTP error");
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error("Galaxy source empty");
    const source = new Uint8Array(manifest.sourceBytes);
    let offset = 0;
    const abort = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        const part = await reader.read();
        signal.throwIfAborted();
        if (part.done) break;
        if (offset + part.value.length > source.length)
          throw Error("Galaxy source byte budget");
        source.set(part.value, offset);
        offset += part.value.length;
      }
    } finally {
      signal.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (offset !== source.length || hash(source) !== manifest.sourceSha256)
      throw Error("Galaxy source identity mismatch");
    const decoded = decodeGalaxy(source);
    signal.throwIfAborted();
    const pixels = toneMapGalaxy(
      decoded.data,
      decoded.width,
      decoded.height,
      1,
    );
    // EXRLoader emits bottom-up rows; web image rows must put celestial north at the top.
    const bytes = await sharp(pixels, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    })
      .flip()
      .webp({ quality: 94 })
      .toBuffer();
    signal.throwIfAborted();
    if (bytes.length > 8 * 1024 * 1024)
      throw Error("Galaxy derived byte budget");
    const sha256 = hash(bytes);
    await mkdir(this.#directory, { recursive: true });
    signal.throwIfAborted();
    await writeFile(path, bytes);
    await writeFile(
      metadataPath,
      JSON.stringify({
        sourceSha256: manifest.sourceSha256,
        conversion: manifest.conversion,
        sha256,
        bytes: bytes.length,
      }),
    );
    return { bytes, sha256 };
  }
}
export const galaxyService = new GalaxyService();
