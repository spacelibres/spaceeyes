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
  coverage?: [number, number];
};
export class SolarSystemData {
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
  #published = new Set<string>();
  #pending = new Map<string, Promise<void>>();
  #provenance = new Map<
    string,
    {
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
    this.#provenance.set(url, {
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
    });
    return bytes;
  }
  constructor(
    ctx: PluginContext,
    options: {
      fetch?: typeof fetch;
    } = {},
  ) {
    this.#ctx = ctx;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    ctx.onDispose(() => this.dispose());
    ctx.signal.addEventListener("abort", () => this.dispose(), { once: true });
  }
  /** Internal transaction snapshot; frozen DYN payloads remain shared. */
  checkpoint(): () => void {
    const generation = this.#generation;
    const published = new Set(this.#published);
    const data = new Map(this.#data);
    const dataParents = new Map(this.#dataParents);
    const retained = this.#retained ? new Set(this.#retained) : undefined;
    const ori = new Map(this.#ori);
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
    return () => {
      if (generation !== this.#generation || this.#abort.signal.aborted) return;
      this.#published = new Set(published);
      this.#data = new Map(data);
      this.#dataParents = new Map(dataParents);
      this.#retained = retained;
      this.#ori = new Map(ori);
      this.#states = cloneStates(states);
      this.#provenance = new Map(
        [...provenance].map(([url, value]) => [url, { ...value }]),
      );
    };
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
      .filter(([url]) => url.startsWith(`/api/solar-dyn/${id}?`))
      .map(([url, value]) => ({ url, ...value }));
  }
  parentAt(id: string, epoch: number): string | null {
    return eyesDefinitions[id]
      ? parentAt(id, epoch)
      : (solarCatalog.find((x) => x.id === id)?.parentId ?? null);
  }
  retain(ids: readonly string[]) {
    this.#loadGeneration++;
    this.#pending.clear();
    this.#queueAbort.abort(new Error("Scene changed"));
    this.#queueAbort = new AbortController();
    const keep = new Set(ids);
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
        if (eyesCatalog.find((x) => x.id === id)?.unsupported) {
          this.#states.set(id, {
            id,
            status: "unsupported",
            error: "Missing Eyes entity definition",
          });
          return;
        }
        const currentParent = this.parentAt(id, epoch);
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
          this.#states.set(id, {
            id,
            status: "ready",
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
          if (currentParent && currentParent !== "sun")
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
            d = decodeDyn(
              await this.#read(`/api/solar-dyn/${id}?epoch=${epoch}`),
            );
            if (d.kind !== "inline") throw Error("Unresolved index");
            if (epoch < d.coverage.start || epoch > d.coverage.end)
              throw Error("Outside source coverage");
            if (
              generation !== this.#loadGeneration ||
              (this.#retained && !this.#retained.has(id))
            )
              return;
            this.#data.set(id, d);
            this.#dataParents.set(id, currentParent);
          }
          if (orientationIds.includes(id))
            try {
              let ori = this.#ori.get(id);
              if (
                !ori ||
                epoch < ori.coverage.start ||
                epoch > ori.coverage.end
              )
                ori = decodeDyn(
                  await this.#read(
                    `/api/solar-dyn/${id}?epoch=${epoch}&type=ori`,
                  ),
                );
              if (generation === this.#loadGeneration) this.#ori.set(id, ori);
            } catch {
              /* Position remains available without attitude. */
            }
          if (
            generation !== this.#loadGeneration ||
            (this.#retained && !this.#retained.has(id))
          )
            return;
          this.#states.set(id, {
            id,
            status: "ready",
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
    return [start, end];
  }
  position(id: string, t: number): [number, number, number] {
    if (id === "sun") return [0, 0, 0];
    const item = solarCatalog.find((x) => x.id === id),
      d = this.#data.get(id);
    if (!item) throw Error("Object unavailable");
    const parentForOrientation = this.parentAt(id, t);
    const ori = parentForOrientation
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
  #orientationAt(id: string, t: number): readonly number[] | undefined {
    const dynamic = this.#ori.get(id);
    if (dynamic && t >= dynamic.coverage.start && t <= dynamic.coverage.end)
      return evaluateOri(dynamic, t);
    const fixed = activeController(id, t, "fixed")
      .filter((c) => c.orientation?.constructor === "Quaternion")
      .at(-1);
    return fixed?.orientation.values;
  }
  publishAt(epoch: number) {
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
        this.#ctx.data.publish(item.id, {
          ...(this.#ori.has(item.id) &&
          epoch >= this.#ori.get(item.id)!.coverage.start &&
          epoch <= this.#ori.get(item.id)!.coverage.end
            ? { orientationWxyz: evaluateOri(this.#ori.get(item.id)!, epoch) }
            : {}),
          positionKm: p,
          radiusKm: item.radiusKm,
          epochTdbSeconds: epoch,
          coverageTdbSeconds: s.coverage!,
          frame: "ICRF",
          source:
            item.id === "sun"
              ? "Local heliocentric origin: zero position defines this scene; not a NASA solar ephemeris"
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
  ) {
    if (!Number.isInteger(count) || count < 8 || count > 4096)
      throw Error("Trajectory sample budget");
    if (mode === "instantaneous") {
      const d = this.#data.get(id);
      if (d?.kind === "inline" && d.type === "orb") {
        const orbit = osculatingOrbit(
          evaluateOrb(d, epoch),
          evaluateOrbVelocity(d, epoch),
          (d.gravitationalParameter1 ?? 0) + (d.gravitationalParameter2 ?? 0),
          epoch,
          count,
          detailed,
        );
        if (orbit) {
          const parentId = this.parentAt(id, epoch);
          const interval = orbit.period / (detailed ? 4096 : 1024);
          return {
            ...orbit,
            originId: parentId && parentId !== "sun" ? parentId : undefined,
            refreshRange: [
              Math.max(d.coverage.start, epoch - interval),
              Math.min(d.coverage.end, epoch + interval),
            ] as [number, number],
          };
        }
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
    const durationSeconds = Math.min(30 * 86400, period);
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
    const start = Math.max(coveredStart, epoch - durationSeconds);
    const end = Math.min(coveredEnd, epoch + durationSeconds / 4);
    const times = [epoch];
    for (let i = 0; i < count - 1; i++)
      times.push(start + ((end - start) * i) / (count - 2));
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
        if (gap && points.length) breakIndices.push(points.length);
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
  }
}
