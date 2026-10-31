import type { TrajectoryConic } from "./trajectory-contract.ts";
import { compileJointAims } from "./eyes-joints.ts";
import {
  normalizeOrientation,
  applySourceSpin,
  applyEntityAlign,
  entityAlignDependencies,
  isEntityAlign,
  type Quat,
  type Vec3,
} from "./eyes-orientation.ts";
import {
  staticPosition,
  staticCoverage,
  activeController,
  rotateVector,
} from "./eyes-controllers.ts";
import {
  eyesCatalog,
  eyesDependencies,
  eyesDefinitions,
  parentAt,
} from "./eyes-catalog.ts";
import { decodeDyn, type DecodedDyn } from "./dyn-decoder.ts";
import {
  evaluateOrb,
  evaluateOrbVelocity,
  evaluateOri,
  propagateState,
} from "./dyn-evaluator.ts";
import { osculatingOrbit } from "./osculating-orbit.ts";
import type { PluginContext } from "./plugin-host.ts";
// Display styling only; colors do not describe measured surface spectra.
const displayColors: Record<string, [number, number, number, number]> = {
  sun: [1, 0.76, 0.2, 1],
  mercury: [0.6, 0.57, 0.52, 1],
  venus: [0.9, 0.76, 0.48, 1],
  earth: [0.2, 0.5, 0.95, 1],
  moon: [0.64, 0.65, 0.67, 1],
  mars: [0.8, 0.3, 0.17, 1],
  jupiter: [0.84, 0.71, 0.57, 1],
  saturn: [0.92, 0.83, 0.56, 1],
  uranus: [0.4, 0.83, 0.87, 1],
  neptune: [0.2, 0.36, 0.9, 1],
};
const baseCatalog = [
  ["sun", "太阳", null, 695500],
  ["mercury", "水星", "sun", 2439.4],
  ["venus", "金星", "sun", 6051.8],
  ["earth", "地球", "sun", 6378.1],
  ["moon", "月球", "earth", 1737.4],
  ["mars", "火星", "sun", 3396.2],
  ["jupiter", "木星", "sun", 71492],
  ["saturn", "土星", "sun", 60268],
  ["uranus", "天王星", "sun", 25559],
  ["neptune", "海王星", "sun", 24764],
].map(([id, name, parentId, radiusKm]) => ({
  id: id as string,
  name: name as string,
  parentId: parentId as string | null,
  radiusKm: radiusKm as number,
  orbPath: parentId ? `${id}/${parentId}/orb` : null,
  kind: (id === "sun" ? "star" : id === "moon" ? "moon" : "planet") as
    | "star"
    | "moon"
    | "planet",
  color: displayColors[id as string],
  source: "Eyes 4a8a83b entity definitions",
  radiusSource: "Eyes 4a8a83b entity definitions",
}));
export const solarCatalog = [
  ...baseCatalog,
  ...[...eyesCatalog, ...eyesDependencies].filter(
    (x) => !baseCatalog.some((b) => b.id === x.id),
  ),
];
export const baseSolarIds = baseCatalog.map((x) => x.id);
export type SolarStatus = {
  id: string;
  status:
    | "loading"
    | "ready"
    | "failed"
    | "out-of-coverage"
    | "canceled"
    | "unsupported";
  error?: string;
  orientationStatus?: "ready" | "unavailable" | "not-requested";
  orientationError?: string;
  orientationNote?: string;
  orientationSource?: "dyn" | "fixed" | "derived";
  positionSource?: "dyn" | "fixed" | "orbital-elements";
  coverage?: [number, number];
};
/** Reference frames are resolvable definitions, not display bodies. */
export function hasDisplayCatalog(id: string): boolean {
  return solarCatalog.some((item) => item.id === id);
}
function isOrientationDynamo(c: { type?: unknown; url?: unknown }): boolean {
  return (
    c.type === "dynamo" &&
    typeof c.url === "string" &&
    /(?:^|\/)(?:ori|quat|quat_v2)$/.test(c.url)
  );
}
export class SolarSystemData {
  #maxCachedRecords: number;
  #ctx: PluginContext;
  #fetch: typeof fetch;
  #abort = new AbortController();
  #data = new Map<string, DecodedDyn>();
  #dataParents = new Map<string, string | null>();
  #ori = new Map<string, DecodedDyn>();
  #states = new Map<string, SolarStatus>();
  #generation = 0;
  // Scene requests can be cancelled without invalidating a transaction rollback.
  #loadGeneration = 0;
  #retained: Set<string> | undefined;
  #spinAnchors = new Map<string, Map<number, number>>();
  #published = new Set<string>();
  #pending = new Map<string, Promise<void>>();
  #provenance = new Map<
    string,
    {
      url: string;
      sha256: string;
      fetchedAt: string;
      sourceSha256?: string;
      selection?: string;
    }
  >();
  #networkActive = 0;
  #queueAbort = new AbortController();
  #networkQueue: {
    start: () => void;
    reject: (error: unknown) => void;
    signal: AbortSignal;
    abort: () => void;
  }[] = [];
  async #read(url: string) {
    const queueSignal = AbortSignal.any([
      this.#abort.signal,
      this.#queueAbort.signal,
    ]);
    queueSignal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        start: () => {
          this.#networkActive++;
          resolve();
        },
        reject,
        signal: queueSignal,
        abort: () => {
          const i = this.#networkQueue.indexOf(waiter);
          if (i >= 0) this.#networkQueue.splice(i, 1);
          reject(queueSignal.reason);
        },
      };
      if (this.#networkActive < 4) waiter.start();
      else {
        this.#networkQueue.push(waiter);
        queueSignal.addEventListener("abort", waiter.abort, { once: true });
      }
    });
    try {
      queueSignal.throwIfAborted();
      return await this.#readUnbounded(url, queueSignal);
    } finally {
      this.#networkActive--;
      while (this.#networkQueue.length && this.#networkActive < 4) {
        const waiter = this.#networkQueue.shift()!;
        waiter.signal.removeEventListener("abort", waiter.abort);
        if (waiter.signal.aborted) waiter.reject(waiter.signal.reason);
        else waiter.start();
      }
    }
  }
  async #readUnbounded(url: string, queueSignal: AbortSignal) {
    const signal = AbortSignal.any([
      queueSignal,
      this.#abort.signal,
      AbortSignal.timeout(25000),
    ]);
    signal.throwIfAborted();
    const r = await this.#fetch(url, { signal, redirect: "error" });
    if (!r.ok || r.redirected) {
      await r.body?.cancel();
      throw Error(
        "DYN HTTP " + r.status + " " + (r.headers.get("x-dyn-error") ?? ""),
      );
    }
    const reader = r.body?.getReader();
    let n = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (reader) {
        signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        n += part.value.length;
        if (n > 16 * 1024 * 1024) throw Error("DYN byte budget");
        chunks.push(part.value);
      }
    } catch (e) {
      await reader?.cancel();
      throw e;
    } finally {
      reader?.releaseLock();
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(n);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    signal.throwIfAborted();
    const evidence = {
      sha256: Array.from(new Uint8Array(hash), (x) =>
        x.toString(16).padStart(2, "0"),
      ).join(""),
      fetchedAt: new Date().toISOString(),
      ...(r.headers.has("x-dyn-source-sha256")
        ? {
            sourceSha256: r.headers.get("x-dyn-source-sha256")!,
            selection: r.headers.get("x-dyn-selection") ?? undefined,
          }
        : {}),
    };
    return { bytes, evidence, url };
  }
  constructor(
    ctx: PluginContext,
    options: {
      fetch?: typeof fetch;
      maxCachedRecords?: number;
    } = {},
  ) {
    this.#maxCachedRecords = options.maxCachedRecords ?? 1_000_000;
    if (
      !Number.isSafeInteger(this.#maxCachedRecords) ||
      this.#maxCachedRecords < 1 ||
      this.#maxCachedRecords > 1_000_000
    )
      throw Error("Invalid decoded record budget");
    this.#ctx = ctx;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    ctx.onDispose(() => this.dispose());
    ctx.signal.addEventListener("abort", () => this.dispose(), { once: true });
  }
  /** Internal transaction snapshot; frozen DYN payloads remain shared. */
  checkpoint(): (() => void) & { discard(): void } {
    const generation = this.#generation;
    const published = new Set(this.#published);
    const data = new Map(this.#data);
    const dataParents = new Map(this.#dataParents);
    const retained = this.#retained ? new Set(this.#retained) : undefined;
    const ori = new Map(this.#ori);
    const spinAnchors = new Map(
      [...this.#spinAnchors].map(([id, values]) => [id, new Map(values)]),
    );
    const cloneStates = (states: Map<string, SolarStatus>) =>
      new Map(
        [...states].map(([id, state]) => [
          id,
          {
            ...state,
            ...(state.coverage
              ? { coverage: [...state.coverage] as [number, number] }
              : {}),
          },
        ]),
      );
    const states = cloneStates(this.#states);
    const provenance = new Map(
      [...this.#provenance].map(([url, value]) => [url, { ...value }]),
    );
    let used = false;
    const release = () => {
      data.clear();
      dataParents.clear();
      ori.clear();
      spinAnchors.clear();
      states.clear();
      provenance.clear();
      published.clear();
    };
    const restore = () => {
      if (used) return;
      used = true;
      if (generation !== this.#generation || this.#abort.signal.aborted) {
        release();
        return;
      }
      this.#cancelLoads();
      for (const id of this.#published) {
        if (!published.has(id)) this.#ctx.data.remove(id);
      }
      this.#published = new Set(published);
      this.#data = new Map(data);
      this.#dataParents = new Map(dataParents);
      this.#retained = retained;
      this.#ori = new Map(ori);
      this.#spinAnchors = new Map(
        [...spinAnchors].map(([id, values]) => [id, new Map(values)]),
      );
      this.#states = cloneStates(states);
      this.#provenance = new Map(
        [...provenance].map(([url, value]) => [url, { ...value }]),
      );
      release();
    };
    restore.discard = () => {
      used = true;
      release();
    };
    return restore;
  }
  status(id: string): SolarStatus | undefined;
  status(): SolarStatus[];
  status(id?: string) {
    return id
      ? this.#states.get(id)
      : [...this.#states.values()].map((s) => ({ ...s }));
  }
  provenance(id: string) {
    return [...this.#provenance.entries()]
      .filter(([key]) => key === id + ":orb" || key === id + ":ori")
      .map(([, value]) => ({ ...value }));
  }
  parentAt(id: string, epoch: number): string | null {
    return eyesDefinitions[id]
      ? parentAt(id, epoch)
      : (solarCatalog.find((x) => x.id === id)?.parentId ?? null);
  }
  retain(ids: readonly string[]) {
    const keep = new Set(ids);
    if (
      !Array.isArray(ids) ||
      ids.length > 256 ||
      keep.size !== ids.length ||
      ids.some((id) => !solarCatalog.some((item) => item.id === id))
    )
      throw Error("Invalid retained scene");
    this.#cancelLoads();
    for (const map of [this.#data, this.#ori, this.#dataParents])
      for (const id of map.keys()) if (!keep.has(id)) map.delete(id);
    for (const key of this.#provenance.keys())
      if (!keep.has(key.slice(0, key.lastIndexOf(":"))))
        this.#provenance.delete(key);
    for (const id of this.#spinAnchors.keys())
      if (!keep.has(id)) this.#spinAnchors.delete(id);
    this.#retained = keep;
    for (const id of this.#states.keys())
      if (!keep.has(id)) {
        this.#states.delete(id);
        if (this.#published.has(id)) {
          this.#ctx.data.remove(id);
          this.#published.delete(id);
        }
      }
  }
  #cancelLoads() {
    this.#loadGeneration++;
    this.#pending.clear();
    this.#queueAbort.abort(new Error("Scene changed"));
    this.#queueAbort = new AbortController();
  }
  cacheStats() {
    const count = (map: Map<string, DecodedDyn>) =>
      [...map.values()].reduce(
        (n, d) =>
          n + (d.kind === "inline" ? d.records.length : d.segments.length),
        0,
      );
    return Object.freeze({
      records: count(this.#data) + count(this.#ori),
      positionEntries: this.#data.size,
      orientationEntries: this.#ori.size,
      provenance: this.#provenance.size,
      maxRecords: this.#maxCachedRecords,
    });
  }
  #cache(map: Map<string, DecodedDyn>, id: string, value: DecodedDyn) {
    const ids = new Set([...this.#data.keys(), ...this.#ori.keys(), id]);
    if (ids.size > 256) throw Error("DYN cached object budget exceeded");
    const count = (d?: DecodedDyn) =>
      d ? (d.kind === "inline" ? d.records.length : d.segments.length) : 0;
    if (
      this.cacheStats().records - count(map.get(id)) + count(value) >
      this.#maxCachedRecords
    )
      throw Error("DYN cached record budget exceeded");
    map.set(id, value);
  }
  coverage(id: string) {
    return this.#states.get(id)?.coverage;
  }
  async load(
    ids: readonly string[] = baseSolarIds,
    epoch = 0,
    orientationIds: readonly string[] = ids,
  ) {
    await Promise.all(
      ids.map((id) => {
        const key = id + ":" + epoch + ":" + orientationIds.includes(id);
        const existing = this.#pending.get(key);
        if (existing) return existing;
        const task = this.#load([id], epoch, orientationIds).finally(() => {
          if (this.#pending.get(key) === task) this.#pending.delete(key);
        });
        this.#pending.set(key, task);
        return task;
      }),
    );
  }
  async #load(
    ids: readonly string[] = baseSolarIds,
    epoch = 0,
    orientationIds: readonly string[] = ids,
  ) {
    const generation = this.#loadGeneration;
    await Promise.all(
      ids.map(async (id) => {
        const item = solarCatalog.find((x) => x.id === id);
        if (!item) throw Error("Unknown object");
        if (this.#abort.signal.aborted || generation !== this.#loadGeneration)
          return;
        if (this.#retained && !this.#retained.has(id))
          throw Error("Object outside retained scene dependency closure");
        if (eyesCatalog.find((x) => x.id === id)?.unsupported) {
          this.#states.set(id, {
            id,
            status: "unsupported",
            error: "Missing Eyes entity definition",
          });
          return;
        }
        const currentParent = this.parentAt(id, epoch);
        if (
          currentParent &&
          currentParent !== "sun" &&
          (eyesDefinitions[id]?.controllers ?? []).some(
            (c) =>
              (c.type === "fixed" && (c.llaOnSpheroid || c.relativeToEntity)) ||
              c.type === "rotateByEntityOrientation",
          )
        )
          await this.load([currentParent], epoch, [currentParent]);
        if (
          generation !== this.#loadGeneration ||
          this.#abort.signal.aborted ||
          (this.#retained && !this.#retained.has(id))
        )
          return;
        const fixedCoverage = staticCoverage(id, epoch);
        if (fixedCoverage && id !== "sun") {
          if (currentParent && currentParent !== "sun")
            await this.load([currentParent], epoch, [
              currentParent,
              ...orientationIds,
            ]);
          if (
            generation !== this.#loadGeneration ||
            this.#abort.signal.aborted ||
            (this.#retained && !this.#retained.has(id))
          )
            return;
          let orientationStatus: "ready" | "unavailable" | "not-requested" =
              "not-requested",
            orientationError: string | undefined;
          if (orientationIds.includes(id))
            try {
              await this.#prepareOrientation(
                id,
                epoch,
                orientationIds,
                generation,
              );
              orientationStatus = "ready";
            } catch (error) {
              orientationStatus = "unavailable";
              orientationError = String(error);
            }
          if (
            generation !== this.#loadGeneration ||
            this.#abort.signal.aborted ||
            (this.#retained && !this.#retained.has(id))
          )
            return;
          this.#states.set(id, {
            id,
            status: "ready",
            orientationStatus,
            orientationError,
            positionSource: this.#positionSource(id, epoch),
            coverage: this.#phaseCoverage(id, epoch, ...fixedCoverage),
          });
          return;
        }
        if (
          !item.orbPath &&
          id !== "sun" &&
          (eyesDefinitions[id]?.controllers ?? []).some(
            (c) =>
              (c.type === "fixed" && (c.position || c.llaOnSpheroid)) ||
              c.type === "orbitalElements",
          )
        ) {
          this.#states.set(id, {
            id,
            status: "out-of-coverage",
            error: "Outside source controller coverage",
          });
          return;
        }
        if (!item.orbPath && id !== "sun") {
          this.#states.set(id, {
            id,
            status: "unsupported",
            error: "No supported position controller",
          });
          return;
        }
        if (!item.orbPath) {
          this.#states.set(id, {
            id,
            status: "ready",
            coverage: [epoch, epoch],
          });
          return;
        }
        this.#states.set(id, { id, status: "loading" });
        try {
          if (
            currentParent &&
            currentParent !== "sun" &&
            !(
              this.#data.get(currentParent)?.coverage.start! <= epoch &&
              this.#data.get(currentParent)?.coverage.end! >= epoch
            )
          )
            await this.load([currentParent], epoch, orientationIds);
          for (const controller of activeController(
            id,
            epoch,
            "rotateByEntityOrientation",
          )) {
            const reference = controller.entityForOrientation ?? currentParent;
            if (reference && reference !== id)
              await this.load([reference], epoch, [reference]);
          }
          let d =
            this.#dataParents.get(id) === currentParent
              ? this.#data.get(id)
              : undefined;
          if (d && (epoch < d.coverage.start || epoch > d.coverage.end))
            d = undefined;
          if (!d) {
            const result = await this.#read(
              `/api/solar-dyn/${id}?epoch=${epoch}`,
            );
            d = decodeDyn(result.bytes);
            if (d.kind !== "inline") throw Error("Unresolved index");
            if (epoch < d.coverage.start || epoch > d.coverage.end)
              throw Error("Outside source coverage");
            if (
              generation !== this.#loadGeneration ||
              (this.#retained && !this.#retained.has(id))
            )
              return;
            this.#cache(this.#data, id, d);
            this.#provenance.set(id + ":orb", {
              url: result.url,
              ...result.evidence,
            });
            this.#dataParents.set(id, currentParent);
          }
          let orientationStatus: "ready" | "unavailable" | "not-requested" =
            "not-requested";
          let orientationError: string | undefined;
          if (orientationIds.includes(id))
            try {
              await this.#prepareOrientation(
                id,
                epoch,
                orientationIds,
                generation,
              );
              orientationStatus = "ready";
            } catch (error) {
              orientationStatus = "unavailable";
              orientationError = String(error);
              if (generation === this.#loadGeneration) {
                const old = this.#ori.get(id);
                if (
                  old &&
                  (epoch < old.coverage.start || epoch > old.coverage.end)
                ) {
                  this.#ori.delete(id);
                  this.#provenance.delete(id + ":ori");
                }
              }
            }
          if (
            generation !== this.#loadGeneration ||
            (this.#retained && !this.#retained.has(id))
          )
            return;
          this.#states.set(id, {
            id,
            status: "ready",
            orientationStatus,
            positionSource: this.#positionSource(id, epoch),
            ...(orientationError ? { orientationError } : {}),
            coverage: this.#phaseCoverage(
              id,
              epoch,
              d.coverage.start,
              d.coverage.end,
            ),
          });
        } catch (e) {
          if (
            generation === this.#loadGeneration &&
            (!this.#retained || this.#retained.has(id))
          )
            this.#states.set(id, {
              id,
              status: String(e).includes("sample times must increase")
                ? "unsupported"
                : String(e).includes("Outside source coverage")
                  ? "out-of-coverage"
                  : "failed",
              error: String(e),
            });
        }
      }),
    );
  }
  #checkOrientationDependencies(id: string, t: number) {
    const visit = (ref: string, state: string, path: string[]) => {
      const key = ref + ":" + state;
      if (path.includes(key))
        throw Error(
          "Orientation dependency cycle: " + [...path, key].join(" -> "),
        );
      if (!eyesDefinitions[ref])
        throw Error("Orientation reference unavailable: " + ref);
      const next = [...path, key],
        parent = this.parentAt(ref, t);
      if (state === "orientation")
        for (const c of eyesDefinitions[ref].controllers ?? []) {
          if (
            c.coverage &&
            (t < Number(c.coverage[0]) || t > Number(c.coverage[1]))
          )
            continue;
          if (isEntityAlign(c)) {
            visit(ref, "position", next);
            for (const d of entityAlignDependencies(c))
              visit(d.id, d.state, next);
          }
        }
      else {
        if (state === "position" && parent && parent !== "sun")
          visit(parent, state, next);
        if (
          activeController(ref, t, "rotateByEntityOrientation").length ||
          activeController(ref, t, "fixed").some(
            (c) => c.llaOnSpheroid || c.relativeToEntity,
          )
        ) {
          if (parent) visit(parent, "orientation", next);
        }
      }
    };
    visit(id, "orientation", []);
  }
  async #prepareOrientation(
    id: string,
    epoch: number,
    orientationIds: readonly string[],
    generation: number,
  ) {
    if (!orientationIds.includes(id)) return;
    this.#checkOrientationDependencies(id, epoch);
    const controllers = eyesDefinitions[id]?.controllers ?? [];
    for (const c of controllers.filter(
      (c) =>
        !c.coverage ||
        (epoch >= Number(c.coverage[0]) && epoch <= Number(c.coverage[1])),
    )) {
      if (isEntityAlign(c))
        for (const dependency of entityAlignDependencies(c)) {
          if (dependency.id !== id && !hasDisplayCatalog(dependency.id)) {
            const refs = eyesDefinitions[dependency.id]?.controllers ?? [];
            if (!refs.length || refs.some((c) => c.type !== "fixed"))
              throw Error("Unsupported reference-only frame: " + dependency.id);
            continue;
          }
          if (dependency.id !== id)
            await this.load(
              [dependency.id],
              epoch,
              dependency.state === "orientation" ? [dependency.id] : [],
            );
        }
    }
    if (!orientationIds.includes(id)) return;
    if (controllers.some(isOrientationDynamo)) {
      let ori = this.#ori.get(id);
      if (!ori || epoch < ori.coverage.start || epoch > ori.coverage.end) {
        const result = await this.#read(
          `/api/solar-dyn/${id}?epoch=${epoch}&type=ori`,
        );
        ori = decodeDyn(result.bytes);
        if (ori.kind !== "inline" || ori.type !== "ori")
          throw Error("Invalid orientation payload");
        if (epoch < ori.coverage.start || epoch > ori.coverage.end)
          throw Error("Outside orientation source coverage");
        if (
          generation !== this.#loadGeneration ||
          this.#abort.signal.aborted ||
          (this.#retained && !this.#retained.has(id))
        )
          return;
        this.#cache(this.#ori, id, ori);
        this.#provenance.set(id + ":ori", {
          url: result.url,
          ...result.evidence,
        });
      }
    }
    this.#orientationAt(id, epoch);
  }
  #phaseCoverage(
    id: string,
    t: number,
    start: number,
    end: number,
  ): [number, number] {
    const parents = eyesDefinitions[id]?.parents ?? [];
    for (let i = 0; i < parents.length; i++) {
      const boundary = Number(parents[i][0]);
      if (boundary <= t) start = Math.max(start, boundary);
      else {
        end = Math.min(end, boundary);
        break;
      }
    }
    // Finite platform evaluation domain, not an observed mission end date.
    return [Math.max(-1e12, start), Math.min(1e12, end)];
  }
  #positionSource(id: string, t: number): "dyn" | "fixed" | "orbital-elements" {
    if (
      activeController(id, t, "fixed").some(
        (c) => c.position || c.llaOnSpheroid,
      )
    )
      return "fixed";
    if (activeController(id, t, "orbitalElements").length)
      return "orbital-elements";
    return "dyn";
  }
  // Scoped to one synchronous publication: no values survive a load or epoch.
  #publicationCache: {
    epoch: number;
    positions: Map<string, [number, number, number]>;
  } | undefined;
  #positionStack: string[] = [];
  position(id: string, t: number): [number, number, number] {
    if (this.#positionStack.includes(id))
      throw Error(
        "Position dependency cycle: " +
          [...this.#positionStack, id].join(" -> "),
      );
    const cache = this.#publicationCache?.epoch === t
      ? this.#publicationCache.positions
      : undefined;
    const cached = cache?.get(id);
    if (cached) return [...cached];
    this.#positionStack.push(id);
    try {
      const value = this.#positionAt(id, t);
      cache?.set(id, [...value]);
      return value;
    } finally {
      this.#positionStack.pop();
    }
  }
  #positionAt(id: string, t: number): [number, number, number] {
    if (id === "sun") return [0, 0, 0];
    const item = solarCatalog.find((x) => x.id === id),
      d = this.#data.get(id);
    if (!item) {
      const controllers = eyesDefinitions[id]?.controllers ?? [];
      if (!controllers.length || controllers.some((c) => c.type !== "fixed"))
        throw Error("Reference-only position unavailable: " + id);
      const fixed = staticPosition(id, t);
      if (!fixed) throw Error("Reference-only position unavailable: " + id);
      return fixed;
    }

    const parentForOrientation = this.parentAt(id, t);
    const needsParentOrientation =
      activeController(id, t, "fixed").some(
        (c) => c.llaOnSpheroid || c.relativeToEntity,
      ) || activeController(id, t, "rotateByEntityOrientation").length > 0;
    const ori =
      parentForOrientation && needsParentOrientation
        ? this.#orientationAt(parentForOrientation, t)
        : undefined;
    const fixed = staticPosition(id, t, ori);
    if (!fixed && !d) throw Error("Object unavailable");
    const body = (eyesDefinitions[id]?.controllers ?? []).find(
      (c) => c.type === "dynamo" && c.parentIsBarycenter,
    )?.parentIsBarycenter
      ? 1
      : 0;
    let p = fixed ?? evaluateOrb(d!, t, body);
    if (!fixed)
      for (const controller of activeController(
        id,
        t,
        "rotateByEntityOrientation",
      )) {
        const reference =
          controller.entityForOrientation ?? this.parentAt(id, t);
        const attitude = reference
          ? this.#orientationAt(reference, t)
          : undefined;
        if (!attitude)
          throw Error(
            "Reference orientation unavailable for rotated source position",
          );
        p = rotateVector(p, attitude);
      }
    const parentId = this.parentAt(id, t);
    if (parentId && parentId !== "sun") {
      const parent = this.position(parentId, t);
      return p.map((v, i) => v + parent[i]) as [number, number, number];
    }
    return p;
  }
  jointAims(id: string, epoch: number) {
    return compileJointAims(
      eyesDefinitions[id]?.controllers ?? [],
      epoch,
      this.position(id, epoch),
      (ref) => this.position(ref, epoch),
    );
  }
  #orientationStack: string[] = [];

  #orientationAt(id: string, t: number): Quat {
    if (this.#orientationStack.includes(id))
      throw Error(
        "Orientation dependency cycle: " +
          [...this.#orientationStack, id].join(" -> "),
      );
    this.#orientationStack.push(id);
    try {
      let q: Quat = [1, 0, 0, 0];
      let found = false;
      const pendingAnchors = new Map<number, number>();
      let controllerIndex = -1;
      for (const c of eyesDefinitions[id]?.controllers ?? []) {
        controllerIndex++;
        if (
          c.coverage &&
          (t < Number(c.coverage[0]) || t > Number(c.coverage[1]))
        )
          continue;
        if (c.type === "fixed" && c.orientation?.constructor === "Quaternion") {
          q = normalizeOrientation(c.orientation.values);
          found = true;
        }
        if (isOrientationDynamo(c)) {
          const d = this.#ori.get(id);
          if (!d || t < d.coverage.start || t > d.coverage.end)
            throw Error("DYN orientation unavailable or outside coverage");
          q = normalizeOrientation(evaluateOri(d, t));
          found = true;
        }
        if (c.type === "spin") {
          const anchor = this.#spinAnchors.get(id)?.get(controllerIndex) ?? t;
          q = applySourceSpin(q, c, t, anchor);
          if (c.relativeToTime === undefined)
            pendingAnchors.set(controllerIndex, anchor);
          found = true;
        }
        if (isEntityAlign(c)) {
          q = applyEntityAlign(q, c, this.position(id, t), {
            position: (ref) => this.position(ref, t),
            velocity: (ref) => this.sourceVelocity(ref, t),
            orientation: (ref) => this.#orientationAt(ref, t),
          });
          found = true;
        }
      }
      if (!found) throw Error("Source orientation unavailable");
      if (pendingAnchors.size) {
        if (!this.#spinAnchors.has(id) && this.#spinAnchors.size >= 256)
          throw Error("Spin anchor budget");
        this.#spinAnchors.set(
          id,
          new Map([...(this.#spinAnchors.get(id) ?? []), ...pendingAnchors]),
        );
      }
      return q;
    } finally {
      this.#orientationStack.pop();
    }
  }
  #orientationSource(id: string, t: number): "dyn" | "fixed" | "derived" {
    let source: "dyn" | "fixed" | "derived" = "fixed";
    for (const c of eyesDefinitions[id]?.controllers ?? []) {
      if (
        c.coverage &&
        (t < Number(c.coverage[0]) || t > Number(c.coverage[1]))
      )
        continue;
      if (isOrientationDynamo(c)) source = "dyn";
      if (c.type === "fixed" && c.orientation) source = "fixed";
      if (isEntityAlign(c) || c.type === "spin") source = "derived";
    }
    return source;
  }
  velocity(id: string, t: number, stack: string[] = []): Vec3 {
    if (stack.includes(id))
      throw Error("Velocity dependency cycle: " + [...stack, id].join(" -> "));
    const local = this.sourceVelocity(id, t),
      parent = this.parentAt(id, t);
    if (!parent || parent === "sun") return local;
    const inherited = this.velocity(parent, t, [...stack, id]);
    return local.map((x, i) => x + inherited[i]) as unknown as Vec3;
  }
  /** Recovered Entity.getVelocityAtTime: controller-local velocity, no ancestor sum. */
  sourceVelocity(id: string, t: number): Vec3 {
    if (id === "sun") return [0, 0, 0];
    if (!hasDisplayCatalog(id))
      throw Error("Reference-only world velocity unavailable: " + id);
    if (
      activeController(id, t, "rotateByEntityOrientation").length ||
      activeController(id, t, "fixed").some(
        (c) => c.relativeToEntity || c.llaOnSpheroid,
      )
    )
      throw Error("Rotating reference world velocity unavailable");
    const d = this.#data.get(id);
    let v: Vec3;
    const orbital = activeController(id, t, "orbitalElements").at(-1);
    if (d?.kind === "inline" && d.type === "orb") {
      v = evaluateOrbVelocity(d, t);
      if (
        (eyesDefinitions[id]?.controllers ?? []).some(
          (c) => c.type === "dynamo" && c.parentIsBarycenter,
        )
      ) {
        const scale =
          (d.gravitationalParameter2 ?? 0) /
          ((d.gravitationalParameter1 ?? 0) + (d.gravitationalParameter2 ?? 0));
        v = v.map((x) => x * scale) as unknown as Vec3;
      }
    } else if (d?.kind === "inline" && (d.type === "pos" || d.type === "lin")) {
      if (t < d.coverage.start || t > d.coverage.end)
        throw Error("Velocity outside coverage");
      let i = 0;
      while (i < d.records.length - 2 && d.records[i + 1].time <= t) i++;
      const a = d.records[i],
        b = d.records[i + 1],
        dt = b.time - a.time,
        u = (t - a.time) / dt;
      v = a.position.map((x, j) =>
        d.type === "lin"
          ? (b.position[j] - x) / dt
          : ((6 * u * u - 6 * u) * x + (-6 * u * u + 6 * u) * b.position[j]) /
              dt +
            (3 * u * u - 4 * u + 1) * a.velocity[j] +
            (3 * u * u - 2 * u) * b.velocity[j],
      ) as unknown as Vec3;
    } else if (activeController(id, t, "fixed").some((c) => c.position))
      v = [0, 0, 0];
    else if (orbital) {
      let q = orbital.orientation?.values;
      if (!q) {
        const O = orbital.longitudeOfAscendingNode / 2,
          i = orbital.inclination / 2,
          w = orbital.argumentOfPeriapsis / 2;
        q = [
          Math.cos(i) * Math.cos(O + w),
          Math.sin(i) * Math.cos(O - w),
          Math.sin(i) * Math.sin(O - w),
          Math.cos(i) * Math.sin(O + w),
        ];
      }
      v = propagateState(
        {
          time: orbital.epoch,
          semiMajorAxis: orbital.semiMajorAxis,
          eccentricity: orbital.eccentricity,
          meanAngularMotion: orbital.meanAngularMotion,
          meanAnomalyAtEpoch: orbital.meanAnomalyAtEpoch,
          orientation: q,
        },
        t,
      ).velocity;
    } else throw Error("World velocity unavailable");
    return v;
  }
  publishAt(epoch: number) {
    const previous = this.#publicationCache;
    this.#publicationCache = { epoch, positions: new Map() };
    try {
      this.#publishAt(epoch);
    } finally {
      this.#publicationCache = previous;
    }
  }
  #publishAt(epoch: number) {
    for (const item of solarCatalog) {
      const s = this.#states.get(item.id);
      if (
        !s ||
        s.status === "failed" ||
        s.status === "unsupported" ||
        s.status === "loading"
      )
        continue;
      try {
        if (item.id === "sun") s.coverage = [epoch, epoch];
        const p = this.position(item.id, epoch);
        s.positionSource = this.#positionSource(item.id, epoch);
        let orientation:
          | {}
          | { orientationWxyz: [number, number, number, number] } = {};
        const orientationRequested = s.orientationStatus !== "not-requested";
        try {
          orientation = {
            orientationWxyz: [...this.#orientationAt(item.id, epoch)],
          };
          s.orientationStatus = "ready";
          s.orientationSource = this.#orientationSource(item.id, epoch);
          delete s.orientationNote;
          if (
            activeController(item.id, epoch, "spin").some(
              (c) => c.relativeToTime === undefined,
            )
          )
            s.orientationNote =
              "Derived visual spin: source has no absolute phase; anchored at first successful load epoch";
          delete s.orientationError;
        } catch (error) {
          delete s.orientationSource;
          delete s.orientationNote;
          if (orientationRequested) {
            s.orientationStatus = "unavailable";
            s.orientationError = String(error);
          } else {
            s.orientationStatus = "not-requested";
            delete s.orientationError;
          }
        }
        this.#ctx.data.publish(item.id, {
          ...orientation,
          positionKm: p,
          radiusKm: item.radiusKm,
          epochTdbSeconds: epoch,
          coverageTdbSeconds: s.coverage!,
          frame: "ICRF",
          source:
            item.id === "sun"
              ? "Local heliocentric origin: zero position defines this scene; not a NASA solar ephemeris"
              : s.positionSource !== "dyn"
                ? "NASA Eyes recovered " +
                  s.positionSource +
                  " position controller; finite coverage bounded by platform evaluation domain, not observation end; orientation " +
                  (s.orientationSource ?? "unavailable")
                : JSON.stringify(this.provenance(item.id).slice(-2)) +
                  " NASA Eyes DYN / recovered 4a8a83b approximation; ET mapped to core TDB argument, periodic TT-TDB difference unresolved; segment accuracy not certified; shared Eyes Dynamo ICRF-direction convention supported by Earth, Mercury, Jupiter and Moon endpoint comparisons; no all-epoch accuracy certification",
        });
        this.#published.add(item.id);
        s.status = "ready";
      } catch (e) {
        s.status = "out-of-coverage";
        s.error = String(e);
        try {
          if (this.#published.has(item.id)) {
            this.#ctx.data.remove(item.id);
            this.#published.delete(item.id);
          }
        } catch {}
      }
    }
  }
  /** Only active position dynamics define a path; landed/static phases have none. */
  hasTrajectory(id: string, epoch: number): boolean {
    if (!Number.isFinite(epoch)) return false;
    if (
      activeController(id, epoch, "fixed").some(
        (c) => c.position || c.llaOnSpheroid,
      )
    )
      return false;
    return (
      activeController(id, epoch, "orbitalElements").length > 0 ||
      activeController(id, epoch, "dynamo").some((c) => !isOrientationDynamo(c))
    );
  }
  trajectoryRange(id: string, epoch: number): [number, number] {
    const d = this.#data.get(id);
    const declared = activeController(id, epoch, "orbitalElements").at(-1);
    if (declared) {
      const half = Math.PI / Math.abs(declared.meanAngularMotion);
      let [start, end] = this.#phaseCoverage(
        id,
        epoch,
        Math.max(epoch - half, Number(declared.coverage?.[0] ?? -Infinity)),
        Math.min(epoch + half, Number(declared.coverage?.[1] ?? Infinity)),
      );
      const parent = this.parentAt(id, epoch),
        coverage =
          parent && parent !== "sun" ? this.coverage(parent) : undefined;
      if (coverage) {
        start = Math.max(start, coverage[0]);
        end = Math.min(end, coverage[1]);
      }
      return [start, end];
    }
    if (!d || d.kind !== "inline" || d.type === "ori")
      throw Error("Orbit unavailable");
    if (d.type !== "orb")
      return this.#phaseCoverage(id, epoch, d.coverage.start, d.coverage.end);
    let r = d.records[0];
    for (const sample of d.records) {
      if (sample.time > epoch) break;
      r = sample;
    }
    const period = (2 * Math.PI) / Math.abs(r.meanAngularMotion);
    if (!Number.isFinite(period)) throw Error("Orbit period unavailable");
    let start = Math.max(d.coverage.start, epoch - period / 2),
      end = Math.min(d.coverage.end, epoch + period / 2);
    [start, end] = this.#phaseCoverage(id, epoch, start, end);
    const parent = this.parentAt(id, epoch);
    if (parent && parent !== "sun") {
      const c = this.coverage(parent);
      if (c) {
        start = Math.max(start, c[0]);
        end = Math.min(end, c[1]);
      }
    }
    return [start, end];
  }
  trajectory(id: string, start: number, end: number, count = 128) {
    if (!Number.isInteger(count) || count < 2 || count > 4096)
      throw Error("Trajectory sample budget");
    return Array.from({ length: count }, (_, i) =>
      this.position(id, start + ((end - start) * i) / (count - 1)),
    );
  }
  trajectorySamples(
    id: string,
    epoch: number,
    count = 256,
    detailed = false,
    mode: "history" | "instantaneous" = "history",
  ): {
    points: [number, number, number][];
    epochsTdbSeconds: number[];
    originId?: string;
    refreshRange: [number, number];
    conic?: TrajectoryConic;
    period?: number;
  } {
    if (!Number.isInteger(count) || count < 8 || count > 4096)
      throw Error("Trajectory sample budget");
    if (mode === "instantaneous") {
      const d = this.#data.get(id);
      let orbit: ReturnType<typeof osculatingOrbit>;
      if (d?.kind === "inline" && d.type === "orb") {
        orbit = osculatingOrbit(
          evaluateOrb(d, epoch),
          evaluateOrbVelocity(d, epoch),
          (d.gravitationalParameter1 ?? 0) + (d.gravitationalParameter2 ?? 0),
          epoch,
          count,
          detailed,
        );
      } else {
        const declared = activeController(id, epoch, "orbitalElements").at(-1);
        if (
          declared &&
          declared.semiMajorAxis > 0 &&
          declared.eccentricity < 1
        ) {
          try {
            const parentId = this.parentAt(id, epoch);
            const parent = parentId
              ? this.position(parentId, epoch)
              : [0, 0, 0];
            const relative = this.position(id, epoch).map(
              (v, i) => v - parent[i],
            ) as [number, number, number];
            orbit = osculatingOrbit(
              relative,
              [...this.sourceVelocity(id, epoch)],
              declared.meanAngularMotion ** 2 * declared.semiMajorAxis ** 3,
              epoch,
              count,
              detailed,
            );
          } catch {
            // Unsupported rotating references retain their covered source path.
          }
        }
      }
      if (orbit) {
        const parentId = this.parentAt(id, epoch);
        const coverage = this.trajectoryRange(id, epoch);
        const interval = orbit.period / (detailed ? 4096 : 1024);
        return {
          ...orbit,
          originId: parentId && parentId !== "sun" ? parentId : undefined,
          refreshRange: [
            Math.max(coverage[0], epoch - interval),
            Math.min(coverage[1], epoch + interval),
          ] as [number, number],
        };
      }
      // Unbound or degenerate states remain open covered paths; never fabricate a closed orbit.
    }
    const [start, end] = this.trajectoryRange(id, epoch);
    if (!Number.isFinite(epoch) || epoch < start || epoch > end || start >= end)
      throw Error("Outside trajectory coverage");
    const uniform = detailed ? Math.floor(count / 2) : count - 1;
    const times = [
      epoch,
      ...Array.from(
        { length: uniform },
        (_, i) => start + ((end - start) * i) / (uniform - 1),
      ),
    ];
    const dense = detailed ? count - uniform - 1 : 0;
    for (let i = 0; i < dense; i++) {
      const u = (2 * i) / (dense - 1) - 1;
      const fraction = Math.expm1(12 * Math.abs(u)) / Math.expm1(12);
      times.push(
        epoch + Math.sign(u) * fraction * (u < 0 ? epoch - start : end - epoch),
      );
    }
    const epochsTdbSeconds = [...new Set(times)].sort((a, b) => a - b);
    const parentId = this.parentAt(id, epoch);
    const originId = parentId && parentId !== "sun" ? parentId : undefined;
    return {
      originId,
      epochsTdbSeconds,
      points: epochsTdbSeconds.map((t) =>
        originId
          ? (this.position(id, t).map(
              (v, i) => v - this.position(originId, t)[i],
            ) as [number, number, number])
          : this.position(id, t),
      ),
      refreshRange: [
        Math.max(start, epoch - (end - start) / (detailed ? 1024 : 4)),
        Math.min(end, epoch + (end - start) / (detailed ? 1024 : 4)),
      ] as [number, number],
    };
  }
  trailSamples(id: string, epoch: number, count = 256, detailed = false) {
    if (!Number.isInteger(count) || count < 8 || count > 4096)
      throw Error("Trajectory sample budget");
    if (!Number.isFinite(epoch) || this.status(id)?.status !== "ready")
      throw Error("Trail unavailable");
    const [rangeStart, rangeEnd] = this.trajectoryRange(id, epoch);
    if (epoch < rangeStart || epoch > rangeEnd || rangeStart >= rangeEnd)
      throw Error("Outside trajectory coverage");
    const d = this.#data.get(id);
    const declared = activeController(id, epoch, "orbitalElements").at(-1);
    let motion = declared?.meanAngularMotion;
    if (d?.kind === "inline" && d.type === "orb") {
      let record = d.records[0];
      for (const sample of d.records) {
        if (sample.time > epoch) break;
        record = sample;
      }
      motion = record.meanAngularMotion;
    }
    const period = motion
      ? (2 * Math.PI) / Math.abs(motion)
      : rangeEnd - rangeStart;
    // Preserve a resolved history within the finite sample budget. Never join
    // revolutions with unresolved chords or cross a source coverage gap.
    const origin = this.parentAt(id, epoch) || undefined;
    const failedProbes = new Set<number>();
    const relativeCache = new Map<number, number[]>();
    const relative = (t: number) => {
      const cached = relativeCache.get(t);
      if (cached) return cached;
      let world: [number, number, number];
      let parent: number[];
      try {
        world = this.position(id, t);
        parent = origin ? this.position(origin, t) : [0, 0, 0];
      } catch (error) {
        failedProbes.add(t);
        throw error;
      }
      const point = world.map((v, i) => v - parent[i]);
      relativeCache.set(t, point);
      return point;
    };
    const probe = Math.min(1, (rangeEnd - rangeStart) / 1e6);
    const lo = Math.max(rangeStart, epoch - probe);
    const hi = Math.min(rangeEnd, epoch + probe);
    let rate = Math.abs(motion ?? 0);
    let inferredPeriod = period;
    try {
      const p = relative(lo),
        q = relative(hi);
      const radius = Math.hypot(...relative(epoch));
      const velocity = q.map((v, i) => (v - p[i]) / (hi - lo));
      const speedSquared = velocity.reduce((sum, v) => sum + v * v, 0);
      const at = relative(epoch);
      const angularMomentum = Math.hypot(
        at[1] * velocity[2] - at[2] * velocity[1],
        at[2] * velocity[0] - at[0] * velocity[2],
        at[0] * velocity[1] - at[1] * velocity[0],
      );
      const autoLength = 2 * Math.PI * angularMomentum / speedSquared;
      if (!motion && Number.isFinite(autoLength) && autoLength > 0)
        inferredPeriod = Math.min(period, autoLength);
      const measured = Math.sqrt(speedSquared) / radius;
      if (Number.isFinite(measured)) rate = Math.max(rate, measured);
    } catch {
      /* Coverage gaps remain explicit breaks below. */
    }
    let durationSeconds = Math.min(
      30 * 86400,
      inferredPeriod,
      rate > 0 ? (0.052 * (count - 2)) / (1.0625 * rate) : inferredPeriod,
    );
    let [coveredStart, coveredEnd] = this.#phaseCoverage(
      id,
      epoch,
      d?.coverage.start ?? Number(declared?.coverage?.[0] ?? -Infinity),
      d?.coverage.end ?? Number(declared?.coverage?.[1] ?? Infinity),
    );
    const visited = new Set<string>([id]);
    let ancestor = this.parentAt(id, epoch);
    while (ancestor && ancestor !== "sun" && !visited.has(ancestor)) {
      visited.add(ancestor);
      const coverage = this.coverage(ancestor);
      if (!coverage) throw Error("Trail ancestor unavailable");
      coveredStart = Math.max(coveredStart, coverage[0]);
      coveredEnd = Math.min(coveredEnd, coverage[1]);
      ancestor = this.parentAt(ancestor, epoch);
    }
    let start = 0,
      end = 0;
    let times: number[] = [];
    let unresolved = new Set<number>();
    for (let attempt = 0; attempt <= 8; attempt++) {
      relativeCache.clear();
      start = Math.max(coveredStart, epoch - durationSeconds);
      end = Math.min(coveredEnd, epoch + durationSeconds / 16);
      times = [epoch];
      for (let i = 0; i < count - 1; i++)
        times.push(start + ((end - start) * i) / (count - 2));
      times = [...new Set(times)].sort((a, b) => a - b);
      unresolved = new Set<number>();
      for (let i = 1; i < times.length; i++) {
        try {
          const p = relative(times[i - 1]),
            q = relative(times[i]);
          let previous = p;
          for (let j = 1; j <= 8; j++) {
            const fraction = j / 8;
            const sample = relative(
              times[i - 1] + (times[i] - times[i - 1]) * fraction,
            );
            const radius = Math.min(
              Math.hypot(...p),
              Math.hypot(...q),
              Math.hypot(...sample),
            );
            const error = Math.hypot(
              ...sample.map((v, k) => v - (p[k] + (q[k] - p[k]) * fraction)),
            );
            const advance = Math.hypot(
              ...sample.map((v, k) => v - previous[k]),
            );
            if (
              !Number.isFinite(error) ||
              !Number.isFinite(advance) ||
              error > radius * 0.001 ||
              advance > radius * 0.00655
            )
              unresolved.add(times[i]);
            previous = sample;
          }
        } catch {
          // A gap discovered between valid endpoints must also break the line.
          unresolved.add(times[i]);
        }
      }
      if (!unresolved.size || attempt === 8) break;
      durationSeconds /= 2;
    }
    const failures = [...failedProbes].sort((a, b) => a - b);
    let failureIndex = 0;
    for (let i = 1; i < times.length; i++) {
      while (
        failureIndex < failures.length &&
        failures[failureIndex] < times[i - 1]
      )
        failureIndex++;
      if (failureIndex < failures.length && failures[failureIndex] <= times[i])
        unresolved.add(times[i]);
    }
    const originId = this.parentAt(id, epoch) || undefined;
    const epochsTdbSeconds: number[] = [];
    const points: [number, number, number][] = [];
    const breakIndices: number[] = [];
    let gap = false;
    for (const t of [...new Set(times)].sort((a, b) => a - b)) {
      try {
        const world = this.position(id, t);
        const parent = originId ? this.position(originId, t) : [0, 0, 0];
        const point = world.map((v, i) => v - parent[i]) as [
          number,
          number,
          number,
        ];
        if (!point.every(Number.isFinite)) throw Error("Invalid trail point");
        if ((gap || unresolved.has(t)) && points.length)
          breakIndices.push(points.length);
        points.push(point);
        epochsTdbSeconds.push(t);
        gap = false;
      } catch (error) {
        if (t === epoch) throw error;
        gap = true;
      }
    }
    if (points.length < 2) throw Error("Trail unavailable");
    return {
      points,
      epochsTdbSeconds,
      originId,
      breakIndices,
      durationSeconds,
      refreshRange: [
        epoch,
        Math.min(end, epoch + durationSeconds / (detailed ? 1024 : 16)),
      ] as [number, number],
    };
  }
  dispose() {
    this.#generation++;
    this.#loadGeneration++;
    this.#abort.abort();
    for (const id of this.#published)
      try {
        this.#ctx.data.remove(id);
      } catch {}
    this.#published.clear();
    this.#states.clear();
    this.#data.clear();
    this.#ori.clear();
    this.#spinAnchors.clear();
    this.#dataParents.clear();
    this.#provenance.clear();
    this.#pending.clear();
  }
}
