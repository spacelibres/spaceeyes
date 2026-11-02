import { createHash } from "node:crypto";
import manifest from "../../validation/eyes-stars.json" with { type: "json" };
export const starfieldFiles = manifest.files;
type Entry = { file: string; bytes: number; sha256: string };
type Subscriber = {
  resolve: (bytes: Uint8Array) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
};
type Job = {
  entry: Entry;
  fetcher: typeof fetch;
  controller: AbortController;
  subscribers: Set<Subscriber>;
  started: boolean;
};
export class StarfieldService {
  private cache = new Map<string, Uint8Array>();
  private jobs = new Map<string, Job>();
  private active = 0;
  private entries: readonly Entry[];
  constructor(entries: readonly Entry[] = starfieldFiles) {
    this.entries = entries;
  }
  get(
    file: string,
    signal: AbortSignal,
    fetcher: typeof fetch = fetch,
  ): Promise<Uint8Array> {
    const entry = this.entries.find((e) => e.file === file);
    if (
      !entry ||
      !/^([a-z]+)\.\d+\.bin$/.test(file) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      entry.bytes > 2097152
    )
      return Promise.reject(new Error("Unknown starfield"));
    if (signal.aborted) return Promise.reject(signal.reason);
    const hit = this.cache.get(file);
    if (hit) return Promise.resolve(hit.slice());
    let job = this.jobs.get(file);
    if (!job) {
      job = {
        entry,
        fetcher,
        controller: new AbortController(),
        subscribers: new Set(),
        started: false,
      };
      this.jobs.set(file, job);
    }
    const current = job;
    const promise = new Promise<Uint8Array>((resolve, reject) => {
      const abort = () => {
        current.subscribers.delete(subscriber);
        subscriber.cleanup();
        reject(signal.reason);
        if (!current.subscribers.size) {
          if (this.jobs.get(file) === current) this.jobs.delete(file);
          current.controller.abort();
          this.pump();
        }
      };
      const subscriber: Subscriber = {
        resolve,
        reject,
        cleanup: () => signal.removeEventListener("abort", abort),
      };
      current.subscribers.add(subscriber);
      signal.addEventListener("abort", abort, { once: true });
    });
    this.pump();
    return promise;
  }
  private pump() {
    for (const job of this.jobs.values()) {
      if (this.active >= 2) break;
      if (job.started || !job.subscribers.size) continue;
      job.started = true;
      this.active++;
      void this.read(job)
        .then(
          (bytes) => {
            if (this.jobs.get(job.entry.file) === job)
              this.jobs.delete(job.entry.file);
            for (const s of job.subscribers) {
              s.cleanup();
              s.resolve(bytes.slice());
            }
          },
          (error) => {
            if (this.jobs.get(job.entry.file) === job)
              this.jobs.delete(job.entry.file);
            for (const s of job.subscribers) {
              s.cleanup();
              s.reject(error);
            }
          },
        )
        .finally(() => {
          job.subscribers.clear();
          if (this.jobs.get(job.entry.file) === job)
            this.jobs.delete(job.entry.file);
          this.active--;
          this.pump();
        });
    }
  }
  private async read(job: Job) {
    const { entry } = job,
      signal = AbortSignal.any([
        job.controller.signal,
        AbortSignal.timeout(20000),
      ]);
    const response = await job.fetcher(
      "https://eyes.nasa.gov/assets/static/stars/" + entry.file,
      { redirect: "error", cache: "no-store", signal },
    );
    if (!response.ok || response.redirected) {
      await response.body?.cancel();
      throw new Error("Starfield HTTP error");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty starfield");
    const abort = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    const bytes = new Uint8Array(entry.bytes);
    let offset = 0;
    try {
      signal.throwIfAborted();
      while (true) {
        const part = await reader.read();
        signal.throwIfAborted();
        if (part.done) break;
        if (offset + part.value.length > entry.bytes)
          throw new Error("Starfield size budget");
        bytes.set(part.value, offset);
        offset += part.value.length;
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      reader.releaseLock();
    }
    if (
      offset !== entry.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== entry.sha256
    )
      throw new Error("Starfield identity mismatch");
    signal.throwIfAborted();
    let total = [...this.cache.values()].reduce((n, b) => n + b.length, 0);
    while (total + bytes.length > 2097152) {
      const key = this.cache.keys().next().value;
      if (key === undefined) break;
      total -= this.cache.get(key)!.length;
      this.cache.delete(key);
    }
    this.cache.set(entry.file, bytes);
    return bytes;
  }
}
const service = new StarfieldService();
export function starfieldFile(
  file: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  return service.get(file, signal, fetcher);
}
