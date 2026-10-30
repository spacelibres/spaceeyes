import { decodeDyn, type DecodedDyn } from "./dyn-decoder.ts";
import { evaluateOrb, evaluateOri } from "./dyn-evaluator.ts";
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
export const solarCatalog = [
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
  #ori = new Map<string, DecodedDyn>();
  #states = new Map<string, SolarStatus>();
  #generation = 0;
  #pending = new Map<string, Promise<void>>();
  #provenance = new Map<
    string,
    {
      sha256: string;
      fetchedAt: string;
    }
  >();
  async #read(url: string) {
    const signal = AbortSignal.any([
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
    const data = new Map(this.#data);
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
      this.#data = new Map(data);
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
  coverage(id: string) {
    return this.#states.get(id)?.coverage;
  }
  async load(
    ids: readonly string[] = solarCatalog.map((x) => x.id),
    epoch = 0,
    orientationIds: readonly string[] = ids,
  ) {
    await Promise.all(
      ids.map((id) => {
        const key = id + ":" + epoch + ":" + orientationIds.includes(id);
        const existing = this.#pending.get(key);
        if (existing) return existing;
        const task = this.#load([id], epoch, orientationIds).finally(() =>
          this.#pending.delete(key),
        );
        this.#pending.set(key, task);
        return task;
      }),
    );
  }
  async #load(
    ids: readonly string[] = solarCatalog.map((x) => x.id),
    epoch = 0,
    orientationIds: readonly string[] = ids,
  ) {
    const generation = this.#generation;
    await Promise.all(
      ids.map(async (id) => {
        const item = solarCatalog.find((x) => x.id === id);
        if (!item) throw Error("Unknown object");
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
            item.parentId &&
            item.parentId !== "sun" &&
            !this.#data.has(item.parentId)
          )
            await this.load([item.parentId], epoch, orientationIds);
          let d = this.#data.get(id);
          if (d && (epoch < d.coverage.start || epoch > d.coverage.end))
            d = undefined;
          if (!d) {
            d = decodeDyn(
              await this.#read(`/api/solar-dyn/${id}?epoch=${epoch}`),
            );
            if (d.kind !== "inline") throw Error("Unresolved index");
            if (epoch < d.coverage.start || epoch > d.coverage.end)
              throw Error("Outside source coverage");
            if (generation !== this.#generation) return;
            this.#data.set(id, d);
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
              if (generation === this.#generation) this.#ori.set(id, ori);
            } catch {
              /* Position remains available without attitude. */
            }
          if (generation !== this.#generation) return;
          this.#states.set(id, {
            id,
            status: "ready",
            coverage: [d.coverage.start, d.coverage.end],
          });
        } catch (e) {
          if (generation === this.#generation)
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
  position(id: string, t: number): [number, number, number] {
    if (id === "sun") return [0, 0, 0];
    const item = solarCatalog.find((x) => x.id === id),
      d = this.#data.get(id);
    if (!item || !d) throw Error("Object unavailable");
    const p = evaluateOrb(d, t);
    if (item.parentId && item.parentId !== "sun") {
      const parent = this.position(item.parentId, t);
      return p.map((v, i) => v + parent[i]) as [number, number, number];
    }
    return p;
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
        s.status = "ready";
      } catch (e) {
        s.status = "out-of-coverage";
        s.error = String(e);
        try {
          this.#ctx.data.remove(item.id);
        } catch {}
      }
    }
  }
  trajectoryRange(id: string, epoch: number): [number, number] {
    const d = this.#data.get(id);
    if (!d || d.kind !== "inline" || d.type !== "orb")
      throw Error("Orbit unavailable");
    let r = d.records[0];
    for (const sample of d.records) {
      if (sample.time > epoch) break;
      r = sample;
    }
    const period = (2 * Math.PI) / Math.abs(r.meanAngularMotion);
    if (!Number.isFinite(period)) throw Error("Orbit period unavailable");
    let start = Math.max(d.coverage.start, epoch - period / 2),
      end = Math.min(d.coverage.end, epoch + period / 2);
    const parent = solarCatalog.find((x) => x.id === id)?.parentId;
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
  dispose() {
    this.#generation++;
    this.#abort.abort();
    for (const id of this.#states.keys())
      try {
        this.#ctx.data.remove(id);
      } catch {}
    this.#states.clear();
    this.#data.clear();
    this.#ori.clear();
  }
}
