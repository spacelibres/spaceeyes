import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import sharp from "sharp";
import manifests from "../../validation/eyes-models.json" with { type: "json" };
import dependencies from "../../validation/eyes-dependencies.json" with { type: "json" };
import { getEyesDefinition } from "../../platform/eyes-catalog.ts";
import {
  convertEyesModel,
  selectEyesModelImages,
} from "./eyes-model-convert.ts";

const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const SOURCE = "https://eyes.nasa.gov/assets/static/";
const VERSION = "eyes-compatible-km-v2";
const dependencyRevision = digest(JSON.stringify(dependencies.files));
export type EyesAsset = { bytes: Uint8Array; mime: string; sha256: string };
type Job<T = EyesAsset> = {
  promise: Promise<T>;
  controller: AbortController;
  users: number;
};
function share<T>(
  jobs: Map<string, Job<T>>,
  key: string,
  work: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  let job = jobs.get(key);
  if (!job) {
    const controller = new AbortController();
    const promise = Promise.resolve().then(() =>
      work(AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])),
    );
    job = { controller, promise, users: 0 };
    jobs.set(key, job);
    const created = job;
    const remove = () => {
      if (jobs.get(key) === created) jobs.delete(key);
    };
    void promise.then(remove, remove);
  }
  const shared = job;
  shared.users++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener("abort", abort);
      if (--shared.users === 0) {
        shared.controller.abort();
        if (jobs.get(key) === shared) jobs.delete(key);
      }
      return true;
    };
    const abort = () => {
      if (release())
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    shared.promise.then(
      (value) => {
        if (release()) resolve(value);
      },
      (error) => {
        if (release()) reject(error);
      },
    );
  });
}

/** Server-owned resource policy. Object IDs are catalog keys, never URLs supplied by plugins. */
export class EyesAssetService {
  #fetch: typeof fetch;
  #directory: string;
  #jobs = new Map<string, Job>();
  #cacheJobs = new Map<string, Job<Uint8Array>>();
  #activeFiles = new Set<string>();
  #maintenance = Promise.resolve();
  #running = 0;
  #waiters: (() => void)[] = [];
  constructor(options: { fetch?: typeof fetch; cacheDirectory?: string } = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#directory = resolve(
      options.cacheDirectory ?? join(process.cwd(), ".cache/eyes-assets"),
    );
  }
  async #slot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (this.#running >= 2) {
      if (this.#waiters.length >= 64) throw Error("Asset request queue budget");
      await new Promise<void>((done) => this.#waiters.push(done));
    }
    this.#running++;
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      this.#running--;
      this.#waiters.shift()?.();
    }
  }
  async #cache(
    key: string,
    load: (signal: AbortSignal) => Promise<Uint8Array>,
    signal: AbortSignal,
    expected?: string,
  ): Promise<Uint8Array> {
    return share(
      this.#cacheJobs,
      key,
      async (sharedSignal) => {
        // Source bytes are independent of conversion revisions and are rechecked against pinned hashes.
        const namespace = key.startsWith("https:")
          ? "eyes-compatible-km-v1"
          : VERSION;
        const name = digest(namespace + key),
          file = join(this.#directory, name + ".bin");
        await mkdir(this.#directory, { recursive: true });
        this.#activeFiles.add(file);
        try {
          try {
            const [bytes, meta] = await Promise.all([
              readFile(file),
              readFile(file + ".json", "utf8"),
            ]);
            const hash = digest(bytes);
            if (
              hash === JSON.parse(meta).sha256 &&
              (!expected || hash === expected)
            ) {
              sharedSignal.throwIfAborted();
              return new Uint8Array(bytes);
            }
          } catch (error) {
            if (sharedSignal.aborted) throw error;
          }
          const bytes = await load(sharedSignal);
          sharedSignal.throwIfAborted();
          const hash = digest(bytes);
          if (expected && hash !== expected)
            throw Error("NASA resource SHA256 mismatch");
          await writeFile(file, bytes);
          await writeFile(
            file + ".json",
            JSON.stringify({
              sha256: hash,
              bytes: bytes.length,
              source: key,
              version: VERSION,
            }),
          );
          await this.#prune(file);
          return bytes;
        } finally {
          this.#activeFiles.delete(file);
        }
      },
      signal,
    );
  }
  async #prune(current: string) {
    const run = this.#maintenance
      .catch(() => {})
      .then(async () => {
        const files = await readdir(this.#directory);
        const entries = (
          await Promise.all(
            files
              .filter((x) => /^[a-f0-9]{64}\.bin$/.test(x))
              .map(async (name) => {
                const path = resolve(this.#directory, name);
                const info = await stat(path).catch(() => undefined);
                return info
                  ? { path, size: info.size, time: info.mtimeMs }
                  : undefined;
              }),
          )
        ).filter(
          (entry): entry is { path: string; size: number; time: number } =>
            entry !== undefined,
        );
        let size = entries.reduce((sum, x) => sum + x.size, 0);
        for (const entry of entries.sort((a, b) => a.time - b.time)) {
          if (size <= 3 * 1024 ** 3) break;
          if (entry.path === current || this.#activeFiles.has(entry.path))
            continue;
          if (!entry.path.startsWith(this.#directory + sep))
            throw Error("Cache path escape");
          await unlink(entry.path).catch(() => {});
          await unlink(entry.path + ".json").catch(() => {});
          size -= entry.size;
        }
      });
    this.#maintenance = run;
    await run;
  }
  async #read(url: string, signal: AbortSignal, expected?: string) {
    const parsed = new URL(url);
    if (
      parsed.origin !== "https://eyes.nasa.gov" ||
      !parsed.pathname.startsWith("/assets/static/") ||
      parsed.search ||
      parsed.hash
    )
      throw Error("Asset origin refused");
    const locked = (
      dependencies.files as Record<string, { sha256: string; bytes: number }>
    )[url];
    expected ??= locked?.sha256;
    if (!expected)
      throw Error("Resource is not in the pinned dependency registry");
    return this.#cache(
      url,
      async (signal) => {
        const response = await this.#fetch(url, { signal, redirect: "error" });
        if (!response.ok || response.redirected)
          throw Error(`NASA asset HTTP ${response.status}: ${url}`);
        const reader = response.body?.getReader();
        if (!reader) throw Error("Empty resource");
        const parts: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 64 * 1024 ** 2)
              throw Error("NASA resource byte budget");
            parts.push(value);
          }
        } catch (error) {
          await reader.cancel();
          throw error;
        } finally {
          reader.releaseLock();
        }
        const result = new Uint8Array(length);
        let at = 0;
        for (const part of parts) {
          result.set(part, at);
          at += part.length;
        }
        return result;
      },
      signal,
      expected,
    );
  }
  async #model(id: string, signal: AbortSignal): Promise<Uint8Array> {
    const definition = getEyesDefinition(id)!;
    const model = definition.model;
    if (!model) throw Error("No source model for object");
    const url = model.url.replace("$STATIC_ASSETS_URL", SOURCE.slice(0, -1));
    const pinned = manifests.rows.find((row) => row.url === url);
    if (!pinned?.sha256)
      throw Error("Model entry is not in the audited resource manifest");
    const transform = {
      scale: model.scale ?? 0.001,
      rotate: model.rotate ?? [],
      translate: model.translate ?? [0, 0, 0],
    };
    return this.#cache(
      JSON.stringify({
        url,
        transform,
        manifest: pinned.sha256,
        dependencyRevision,
      }),
      async (signal) => {
        const json = selectEyesModelImages(
          JSON.parse(
            new TextDecoder().decode(
              await this.#read(url, signal, pinned.sha256),
            ),
          ),
        );
        const resources: Record<string, Uint8Array> = {};
        const uris = [
          ...new Set<string>(
            [...(json.buffers ?? []), ...(json.images ?? [])].map(
              (x: any) => x.uri,
            ),
          ),
        ];
        for (const uri of uris) {
          if (
            typeof uri !== "string" ||
            !uri ||
            uri.startsWith("/") ||
            uri.includes("\\") ||
            uri.includes(":") ||
            uri.split("/").some((p) => p === ".." || p === ".")
          )
            throw Error("Model dependency path refused");
        }
        // Bounded dependency fetches; only declared manifest resources can enter the converter.
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(4, uris.length) }, async () => {
            while (next < uris.length) {
              const uri = uris[next++];
              resources[uri] = await this.#read(new URL(uri, url).href, signal);
            }
          }),
        );
        for (const buffer of json.buffers ?? [])
          if (resources[buffer.uri]?.length !== buffer.byteLength)
            throw Error("Model buffer length mismatch");
        const result = await convertEyesModel(json, resources, model);
        if (result.length > 256 * 1024 ** 2)
          throw Error("Converted model byte budget");
        return result;
      },
      signal,
    );
  }
  async #face(id: string, face: number, signal: AbortSignal) {
    const definition = getEyesDefinition(id)!;
    const color = definition.spheroidLOD?.textures?.color;
    if (!color?.url || !Array.isArray(color.sizes))
      throw Error("No source surface for object");
    const choices = color.sizes.filter((size: number) => size <= 512);
    const size = Math.max(...(choices.length ? choices : color.sizes));
    const path = color.url
      .replace("$SIZE", String(size))
      .replace("$FACE", String(face));
    if (path.includes("..") || path.includes(":") || path.startsWith("/"))
      throw Error("Surface path refused");
    return this.#cache(
      `${id}:face:${face}:${path}:${dependencyRevision}`,
      async (signal) =>
        new Uint8Array(
          await sharp(await this.#read(SOURCE + "maps/" + path, signal))
            .png()
            .toBuffer(),
        ),
      signal,
    );
  }
  async get(
    id: string,
    file: string,
    signal?: AbortSignal,
  ): Promise<EyesAsset> {
    signal?.throwIfAborted();
    if (!getEyesDefinition(id)) throw Error("Unknown NASA Eyes object");
    if (file !== "model.glb" && !/^face-[0-5]\.png$/.test(file))
      throw Error("Unknown resource path");
    const key = id + "/" + file;
    return share(
      this.#jobs,
      key,
      (deadline) =>
        this.#slot(deadline, async () => {
          const bytes =
            file === "model.glb"
              ? await this.#model(id, deadline)
              : await this.#face(id, Number(file[5]), deadline);
          return {
            bytes,
            mime: file === "model.glb" ? "model/gltf-binary" : "image/png",
            sha256: digest(bytes),
          };
        }),
      signal,
    );
  }
}
export const eyesAssets = new EyesAssetService();
