import {eyesPositionKeyframe} from "./eyes-position-keyframes.ts";
import {TrailHistory, type PreparedHistory} from "./trail-history.ts";
import {eyesTrailDuration, eyesTrailPhase, eyesTrailBoundaries} from "./eyes-trail-policy.ts";
import {eyesOrbAutoLength} from "./eyes-trail-auto.ts";
import {parsePositionSelection,acceptsPositionEpoch,type PositionSelection} from "./position-selection.ts";
import {AdaptiveTrailState, adaptiveTrailSteps} from "./adaptive-trail.ts";
import { MAX_TRAIL_DURATION_SECONDS } from "./trajectory-contract.ts";
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
  staticPositionController,
  staticVelocity,
  staticCoverage,
  activeController,
  rotateVector,
} from "./eyes-controllers.ts";
import {
  eyesCatalog,
  eyesDependencies,
  eyesDefinitions,
  parentAt,
  positionTrackKey,
  orientationTrackKey,
  positionTrackBoundaries,
  positionFrameKey,
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
const solarCatalogById = new Map(solarCatalog.map(body => [body.id, body]));
const catalogBody = (id: string) => solarCatalogById.get(id) ?? solarCatalog.find(body => body.id === id);
export const baseSolarIds = baseCatalog.map((x) => x.id);
class OrientationOutsideCoverage extends Error {
  readonly coverage: [number,number];
  constructor(coverage: [number,number]) {super("Outside orientation source coverage");this.coverage=coverage;}
}
class OrientationControllersOutsideCoverage extends Error {
  readonly domain: PositionSelection;
  constructor(domain:PositionSelection) {super("Outside orientation controllers coverage");this.domain=domain;}
}
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
type HistorySlot = {
  id: string;
  origin: string | undefined;
  epoch: number;
  duration: number;
  reuse: number;
  policyDuration: number | undefined;
  policyKey: string;
  trackKey: string;
  manager: TrailHistory;
  prepared?: PreparedHistory;
  pending?: Promise<boolean>;
};
/** Reference frames are resolvable definitions, not display bodies. */
export function hasDisplayCatalog(id: string): boolean {
  return !!catalogBody(id);
}
function isOrientationDynamo(c: { type?: unknown; url?: unknown }): boolean {
  return (
    c.type === "dynamo" &&
    typeof c.url === "string" &&
    /(?:^|\/)(?:ori|quat|quat_v2)$/.test(c.url)
  );
}
export type ScientificSourceSnapshot = {
  id:string;data?:DecodedDyn;ori?:DecodedDyn;parent?:string|null;track?:string;selection?:PositionSelection;
  oriKey?:string;oriSelection?:PositionSelection;oriAbsence?:PositionSelection;outsideOri?:[number,number];
  spinAnchors:[number,number][];status?:SolarStatus;
};
export class SolarSystemData {
  #maxCachedRecords: number;
  #ctx: PluginContext;
  #fetch: typeof fetch;
  #abort = new AbortController();
  #outsideOri = new Map<string, [number,number]>();
  #data = new Map<string, DecodedDyn>();
  #dataParents = new Map<string, string | null>();
  #dataTracks = new Map<string, string>();
  #dataSelections = new Map<string,PositionSelection>();
  #ori = new Map<string, DecodedDyn>();
  #oriKeys = new Map<string,string>();
  #oriSelections = new Map<string,PositionSelection>();
  #oriAbsences = new Map<string,PositionSelection>();
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
  #positionStitches = new Map<string, {start:number;end:number;url:string;sha256:string;sourceSha256?:string;fetchedAt:string}[]>();
  #history?: HistorySlot;
  #trailSampling = new Map<string, {key: string; history: unknown; state: AdaptiveTrailState; before: AdaptiveTrailState; after: AdaptiveTrailState; dependencies: Set<string>; orientationDependencies: Set<string>}>();
  #networkActive = 0;
  #queueAbort = new AbortController();
  #networkQueue: {
    start: () => void;
    reject: (error: unknown) => void;
    signal: AbortSignal;
    abort: () => void;
  }[] = [];
  async #read(url: string, externalSignal?: AbortSignal) {
    const queueSignal = AbortSignal.any([
      this.#abort.signal,
      this.#queueAbort.signal,
      ...(externalSignal ? [externalSignal] : []),
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
      const absence = r.headers.get("x-dyn-orientation-absence");
      if (r.status === 502 && absence && absence.length <= 1024 && url.includes("type=ori")) {
        let domain:PositionSelection|undefined;
        try {domain=parsePositionSelection(absence);}catch {}
        if(domain?.track==="orientation-absence" && domain.lowerInclusive===undefined &&
           (domain.lowerExclusive!==undefined || domain.upperExclusive!==undefined))
          throw new OrientationControllersOutsideCoverage(domain);
      }
      const raw = r.headers.get("x-dyn-orientation-coverage");
      if (r.status === 502 && raw && raw.length <= 256 && url.includes("type=ori")) {
        let coverage: unknown;
        try {coverage = JSON.parse(raw);} catch {}
        if (Array.isArray(coverage) && coverage.length === 2 && coverage.every(Number.isFinite) && coverage[0] <= coverage[1])
          throw new OrientationOutsideCoverage(coverage as [number,number]);
      }
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
    return { bytes, evidence, url, controller:parsePositionSelection(r.headers.get("x-dyn-controller-selection")) };
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
  exportScientificSources():ScientificSourceSnapshot[] {
    const ids=new Set([...this.#states.keys(),...this.#data.keys(),...this.#ori.keys()]);
    return [...ids].map(id=>({id,data:this.#data.get(id),ori:this.#ori.get(id),parent:this.#dataParents.get(id),track:this.#dataTracks.get(id),selection:this.#dataSelections.get(id),oriKey:this.#oriKeys.get(id),oriSelection:this.#oriSelections.get(id),oriAbsence:this.#oriAbsences.get(id),outsideOri:this.#outsideOri.get(id),spinAnchors:[...(this.#spinAnchors.get(id)??[])],status:this.#states.get(id)}));
  }
  importScientificSources(sources:readonly (ScientificSourceSnapshot & {positionChanged?:boolean;orientationChanged?:boolean})[],removed:readonly string[]=[]):void {
    const assign=<T>(map:Map<string,T>,id:string,value:T|undefined)=>{if(value===undefined)map.delete(id);else map.set(id,value);};
    for(const id of removed) {
      for(const [target,sampling] of this.#trailSampling)if(sampling.dependencies.has(id)||sampling.orientationDependencies.has(id))this.#trailSampling.delete(target);
      for(const map of [this.#data,this.#ori,this.#dataParents,this.#dataTracks,this.#dataSelections,this.#oriKeys,this.#oriSelections,this.#oriAbsences,this.#outsideOri,this.#states,this.#spinAnchors])map.delete(id);
      this.#trailSampling.delete(id);
    }
    for(const source of sources) {
      const id=source.id;
      if(!catalogBody(id))throw Error("Unknown scientific source");
      for(const [target,sampling] of this.#trailSampling)
        if((source.positionChanged!==false&&sampling.dependencies.has(id)) || (source.orientationChanged!==false&&sampling.orientationDependencies.has(id)))this.#trailSampling.delete(target);
      if(source.positionChanged!==false) {
        if(source.data)this.#cache(this.#data,id,source.data);else this.#data.delete(id);
        assign(this.#dataParents,id,source.parent);assign(this.#dataTracks,id,source.track);assign(this.#dataSelections,id,source.selection);
      }
      if(source.orientationChanged!==false) {
        if(source.ori)this.#cache(this.#ori,id,source.ori);else this.#ori.delete(id);
        assign(this.#oriKeys,id,source.oriKey);assign(this.#oriSelections,id,source.oriSelection);assign(this.#oriAbsences,id,source.oriAbsence);
        assign(this.#outsideOri,id,source.outsideOri);this.#spinAnchors.set(id,new Map(source.spinAnchors));
      }
      assign(this.#states,id,source.status);
    }
    if(this.#data.size>256||this.#ori.size>256||this.cacheStats().records>this.#maxCachedRecords)throw Error("Scientific snapshot budget");
  }
  scientificTrailEligible(id:string,epoch:number):boolean {return !this.#historyAt(id,epoch)?.prepared;}
  scientificTrailDependencies(id:string) {const sampling=this.#trailSampling.get(id);return {position:[...(sampling?.dependencies??[])],orientation:[...(sampling?.orientationDependencies??[])]};}
  checkpoint(): (() => void) & { discard(): void } {
    const generation = this.#generation;
    const published = new Set(this.#published);
    const data = new Map(this.#data);
    const dataParents = new Map(this.#dataParents);
    const dataTracks = new Map(this.#dataTracks);
    const dataSelections = new Map(this.#dataSelections);
    const retained = this.#retained ? new Set(this.#retained) : undefined;
    const positionStitches = new Map(this.#positionStitches);
    const ori = new Map(this.#ori);
    const oriKeys = new Map(this.#oriKeys);
    const oriSelections = new Map(this.#oriSelections);
    const oriAbsences = new Map(this.#oriAbsences);
    const outsideOri = new Map(this.#outsideOri);
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
      dataTracks.clear();
      dataSelections.clear();
      positionStitches.clear();
      ori.clear();
      oriKeys.clear();
      oriSelections.clear();
      oriAbsences.clear();
      outsideOri.clear();
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
      this.#trailSampling.clear();
      this.#positionStitches = new Map(positionStitches);
      this.#data = new Map(data);
      this.#dataParents = new Map(dataParents);
      this.#dataTracks = new Map(dataTracks);
      this.#dataSelections = new Map(dataSelections);
      this.#retained = retained;
      this.#ori = new Map(ori);
      this.#oriKeys = new Map(oriKeys);
      this.#oriSelections = new Map(oriSelections);
      this.#oriAbsences = new Map(oriAbsences);
      this.#outsideOri = new Map(outsideOri);
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
    const keyframe=eyesPositionKeyframe(id,epoch);
    if(keyframe)return keyframe.referenceId;
    return eyesDefinitions[id]
      ? parentAt(id, epoch)
      : (catalogBody(id)?.parentId ?? null);
  }
  retain(ids: readonly string[]) {
    const keep = new Set(ids);
    if (
      !Array.isArray(ids) ||
      ids.length > 256 ||
      keep.size !== ids.length ||
      ids.some((id) => !!!catalogBody(id))
    )
      throw Error("Invalid retained scene");
    this.clearTrailHistory();
    this.#trailSampling.clear();
    for(const id of this.#positionStitches.keys())if(!keep.has(id))this.#positionStitches.delete(id);
    this.#cancelLoads();
    for (const map of [this.#data, this.#ori, this.#dataParents, this.#dataTracks, this.#dataSelections, this.#outsideOri, this.#oriKeys, this.#oriSelections, this.#oriAbsences])
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
      trailSamplingEntries: this.#trailSampling.size,
      provenance: this.#provenance.size,
      maxRecords: this.#maxCachedRecords,
    });
  }
  #cache(map: Map<string, DecodedDyn>, id: string, value: DecodedDyn, certifiedExtension = false) {
    const ids = new Set([...this.#data.keys(), ...this.#ori.keys(), ...this.#oriKeys.keys(), id]);
    if (ids.size > 256) throw Error("DYN cached object budget exceeded");
    const count = (d?: DecodedDyn) =>
      d ? (d.kind === "inline" ? d.records.length : d.segments.length) : 0;
    if (
      this.cacheStats().records - count(map.get(id)) + count(value) >
      this.#maxCachedRecords
    )
      throw Error("DYN cached record budget exceeded");
    if (!certifiedExtension) for (const [target, sampling] of this.#trailSampling)
      if ((map===this.#ori ? sampling.orientationDependencies : sampling.dependencies).has(id))this.#trailSampling.delete(target);
    map.set(id, value);
  }
  coverage(id: string) {
    return this.#states.get(id)?.coverage;
  }
  /** Fetch a real adjacent position chunk without retiring the current ready source. */
  async prefetchPosition(id:string, requestedEpoch:number, liveEpoch:number, retainSeconds:number):Promise<boolean> {
    const previous=this.#data.get(id), evidence=this.#provenance.get(id+":orb");
    if(!previous || previous.kind!=="inline" || previous.type==="ori" || !evidence || !Number.isFinite(retainSeconds) || retainSeconds<=0)return false;
    if(requestedEpoch>=previous.coverage.start && requestedEpoch<=previous.coverage.end)return false;
    const generation=this.#loadGeneration, track=this.#dataTracks.get(id),parent=this.#dataParents.get(id),selection=this.#dataSelections.get(id);
    if(track!==positionTrackKey(id,requestedEpoch) || parent!==this.parentAt(id,requestedEpoch) || !acceptsPositionEpoch(selection,requestedEpoch))return false;
    const result=await this.#read(`/api/solar-dyn/${id}?epoch=${requestedEpoch}`,this.#queueAbort.signal);
    const next=decodeDyn(result.bytes);
    if(generation!==this.#loadGeneration || this.#data.get(id)!==previous || (this.#retained && !this.#retained.has(id)))return false;
    if(next.kind!=="inline" || next.type!==previous.type || next.version!==previous.version ||
      next.gravitationalParameter1!==previous.gravitationalParameter1 || next.gravitationalParameter2!==previous.gravitationalParameter2 ||
      JSON.stringify(result.controller)!==JSON.stringify(selection) || !acceptsPositionEpoch(result.controller,requestedEpoch) ||
      requestedEpoch<next.coverage.start || requestedEpoch>next.coverage.end ||
      next.coverage.start>previous.coverage.end || previous.coverage.start>next.coverage.end)return false;
    const nextRecords=new Map(next.records.map(record=>[record.time,record] as const));
    for(const record of previous.records)
      if(record.time>=next.coverage.start && record.time<=next.coverage.end && JSON.stringify(nextRecords.get(record.time))!==JSON.stringify(record))return false;
    const records=new Map(previous.records.map(record=>[record.time,record] as const));
    for(const record of next.records) {
      if(record.time>=previous.coverage.start && record.time<=previous.coverage.end && JSON.stringify(records.get(record.time))!==JSON.stringify(record))return false;
      records.set(record.time,record as typeof previous.records[number]);
    }
    const ordered=[...records.values()].sort((a,b)=>a.time-b.time);
    const lower=Math.min(liveEpoch-2*retainSeconds,requestedEpoch<liveEpoch?next.coverage.start:liveEpoch),
      upper=Math.max(liveEpoch+2*retainSeconds,requestedEpoch>liveEpoch?next.coverage.end:liveEpoch);
    let first=ordered.findIndex(record=>record.time>=lower);if(first<0)first=ordered.length-1;first=Math.max(0,first-1);
    let last=ordered.findIndex(record=>record.time>upper);if(last<0)last=ordered.length-1;
    const kept=ordered.slice(first,last+1);
    if(kept.length<2)return false;
    const coverage={start:Math.max(kept[0].time,Math.min(previous.coverage.start,next.coverage.start)),end:Math.min(kept.at(-1)!.time,Math.max(previous.coverage.end,next.coverage.end))};
    if(liveEpoch<coverage.start || liveEpoch>coverage.end)return false;
    const pieces=[...(this.#positionStitches.get(id)??[{start:previous.coverage.start,end:previous.coverage.end,...evidence}]),
      {start:next.coverage.start,end:next.coverage.end,url:result.url,...result.evidence}].filter(piece=>piece.end>=coverage.start && piece.start<=coverage.end);
    if(pieces.length>64)return false;
    this.#cache(this.#data,id,{...previous,coverage,records:kept} as DecodedDyn,true);
    this.#positionStitches.set(id,pieces);
    this.#provenance.set(id+":orb",{url:result.url,...result.evidence,selection:JSON.stringify({stitched:pieces})});
    const status=this.#states.get(id);
    if(status?.status==="ready")this.#states.set(id,{...status,coverage:this.#phaseCoverage(id,liveEpoch,coverage.start,coverage.end)});
    return true;
  }
  needsPositionRefresh(id:string,epoch:number):boolean {
    return this.#data.has(id) && this.#positionSource(id,epoch) === "dyn" &&
      (this.#dataTracks.get(id) !== positionTrackKey(id,epoch) ||
       this.#dataParents.get(id) !== this.parentAt(id,epoch) ||
       !acceptsPositionEpoch(this.#dataSelections.get(id),epoch));
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
        const item = catalogBody(id);
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
        const trailPolicy=eyesTrailPhase(id,epoch);
        const trailReference=trailPolicy.relativeToEntity || currentParent;
        if(trailPolicy.relativeToEntityOrientation && trailReference && trailReference!==id && trailReference!=="sun")
          await this.load([trailReference],epoch,[trailReference]);
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
        const fixedCoverage = eyesPositionKeyframe(id,epoch)?.coverage ?? staticCoverage(id, epoch);
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
            this.#dataParents.get(id) === currentParent &&
            this.#dataTracks.get(id) === positionTrackKey(id,epoch) &&
            acceptsPositionEpoch(this.#dataSelections.get(id),epoch)
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
            if (!acceptsPositionEpoch(result.controller,epoch))throw Error("Outside source controller coverage");
            if (
              generation !== this.#loadGeneration ||
              (this.#retained && !this.#retained.has(id))
            )
              return;
            this.#positionStitches.delete(id);
            this.#cache(this.#data, id, d);
            this.#provenance.set(id + ":orb", {
              url: result.url,
              ...result.evidence,
            });
            this.#dataParents.set(id, currentParent);
            this.#dataTracks.set(id, positionTrackKey(id,epoch));
            if(result.controller)this.#dataSelections.set(id,result.controller);
            else this.#dataSelections.delete(id);
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
  async refreshOrientation(id: string, epoch: number): Promise<void> {
    const generation = this.#loadGeneration;
    if (this.status(id)?.status !== "ready" || !this.needsOrientationRefresh(id, epoch)) return;
    await this.#prepareOrientation(id, epoch, [id], generation);
    if (generation !== this.#loadGeneration) return;
    const status = this.#states.get(id);
    if (status) {status.orientationStatus = "ready"; delete status.orientationError;}
  }
  #checkOrientationBudget(id:string) {
    const ids=new Set([...this.#data.keys(),...this.#ori.keys(),...this.#oriKeys.keys(),id]);
    if(ids.size>256)throw Error("Orientation cached object budget exceeded");
  }
  #oriAbsent(id:string,epoch:number):boolean {
    if(this.#oriKeys.get(id)!==orientationTrackKey(id,epoch))return false;
    const domain=this.#oriAbsences.get(id);
    if(domain)return acceptsPositionEpoch(domain,epoch);
    const bounds=this.#outsideOri.get(id);
    return !!bounds && (epoch<bounds[0] || epoch>bounds[1]);
  }
  #oriCacheValid(id:string,epoch:number):boolean {
    const ori=this.#ori.get(id);
    return !!ori && this.#oriKeys.get(id)===orientationTrackKey(id,epoch) &&
      epoch>=ori.coverage.start && epoch<=ori.coverage.end &&
      acceptsPositionEpoch(this.#oriSelections.get(id),epoch);
  }
  needsOrientationRefresh(id: string, epoch: number): boolean {
    if(!Number.isFinite(epoch) || this.status(id)?.status!=="ready")return false;
    const active=activeController(id,epoch,"dynamo");
    if(!active.some(isOrientationDynamo))return false;
    const all=(eyesDefinitions[id]?.controllers??[]).filter(c=>!c.coverage || (epoch>=Number(c.coverage[0])&&epoch<=Number(c.coverage[1])));
    const lastFixed=all.findLastIndex(c=>c.type==='fixed'&&(c.orientation?.constructor==='Quaternion'||c.llaOnSpheroid?.constructor==='LatLonAlt'));
    if(lastFixed>=all.findLastIndex(isOrientationDynamo))return false;
    return !this.#oriAbsent(id,epoch) && !this.#oriCacheValid(id,epoch);
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
    const active=controllers.filter(c=>!c.coverage || (epoch>=Number(c.coverage[0])&&epoch<=Number(c.coverage[1])));
    const lastFixed=active.findLastIndex(c=>c.type==='fixed'&&(c.orientation?.constructor==='Quaternion'||c.llaOnSpheroid?.constructor==='LatLonAlt'));
    if (active.some(isOrientationDynamo) && lastFixed<active.findLastIndex(isOrientationDynamo)) {
      let ori = this.#ori.get(id);
      if (!this.#oriAbsent(id,epoch) && !this.#oriCacheValid(id,epoch)) {
        let result;
        try {
          result = await this.#read(`/api/solar-dyn/${id}?epoch=${epoch}&type=ori`);
        } catch (error) {
          if(error instanceof OrientationControllersOutsideCoverage) {
            if(!acceptsPositionEpoch(error.domain,epoch))throw error;
          }else if (!(error instanceof OrientationOutsideCoverage) ||
              (epoch >= error.coverage[0] && epoch <= error.coverage[1])) throw error;
          if (generation !== this.#loadGeneration || this.#abort.signal.aborted ||
              (this.#retained && !this.#retained.has(id))) return;
          this.#checkOrientationBudget(id);
          this.#oriKeys.set(id,orientationTrackKey(id,epoch));
          this.#ori.delete(id);
          this.#oriSelections.delete(id);
          this.#provenance.delete(id+":ori");
          if(error instanceof OrientationControllersOutsideCoverage) {
            this.#oriAbsences.set(id,error.domain);
            this.#outsideOri.delete(id);
          }else {
            this.#outsideOri.set(id,error.coverage);
            this.#oriAbsences.delete(id);
          }
          this.#orientationAt(id, epoch);
          return;
        }

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
        const dynamics=active.filter(isOrientationDynamo);
        if(result.controller && (!dynamics.some(c=>c.url===result.controller!.track) || !acceptsPositionEpoch(result.controller,epoch)))
          throw Error("Invalid orientation controller selection");
        if(dynamics.length>1 && !result.controller)throw Error("Missing orientation controller selection");
        this.#checkOrientationBudget(id);
        this.#cache(this.#ori, id, ori);
        this.#oriKeys.set(id,orientationTrackKey(id,epoch));
        if(result.controller)this.#oriSelections.set(id,result.controller);
        else this.#oriSelections.delete(id);
        this.#outsideOri.delete(id);
        this.#oriAbsences.delete(id);
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
    const keyframes=eyesPositionKeyframe(id,t);
    if(keyframes){start=Math.max(start,keyframes.coverage[0]);end=Math.min(end,keyframes.coverage[1]);}
    const parents = keyframes ? [] : eyesDefinitions[id]?.parents ?? [];
    for (let i = 0; i < parents.length; i++) {
      const boundary = Number(parents[i][0]);
      if (boundary <= t) start = Math.max(start, boundary);
      else {
        end = Math.min(end, boundary);
        break;
      }
    }
    for (const boundary of positionTrackBoundaries(id)) {
      if (boundary <= t) start = Math.max(start,boundary);
      else end = Math.min(end,boundary);
    }
    if(this.#positionSource(id,t)==="dyn") {
      const selection=this.#dataSelections.get(id);
      start=Math.max(start,selection?.lowerExclusive??-Infinity,selection?.lowerInclusive??-Infinity);
      end=Math.min(end,selection?.upperExclusive??Infinity);
    }
    // Finite platform evaluation domain, not an observed mission end date.
    return [Math.max(-1e12, start), Math.min(1e12, end)];
  }
  #positionSource(id: string, t: number): "dyn" | "fixed" | "orbital-elements" {
    if(eyesPositionKeyframe(id,t))return "fixed";
    const selected = staticPositionController(id, t);
    if (selected?.type === "fixed") return "fixed";
    if (selected?.type === "orbitalElements") return "orbital-elements";
    return "dyn";
  }
  // Scoped to one synchronous publication: no values survive a load or epoch.
  #publicationCache: {
    epoch: number;
    positions: Map<string, [number, number, number]>;
  } | undefined;
  #positionStack: string[] = [];
  #positionDependenciesCapture?: Set<string>;
  position(id: string, t: number): [number, number, number] {
    this.#positionDependenciesCapture?.add(id);
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
    if (this.needsPositionRefresh(id,t)) throw Error("Outside source controller coverage");
    const item = catalogBody(id),
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
      ) || activeController(id, t, "rotateByEntityOrientation").some(c => c.rotatingPosition !== false);
    const ori =
      parentForOrientation && needsParentOrientation
        ? this.#orientationAt(parentForOrientation, t)
        : undefined;
    const fixed = eyesPositionKeyframe(id,t)?.position ?? staticPosition(id, t, ori);
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
        if (controller.rotatingPosition === false) continue;
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
  #orientationDependenciesCapture?: Set<string>;

  #orientationAt(id: string, t: number): Quat {
    this.#orientationDependenciesCapture?.add(id);
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
        // Entity-567 fixed LLA loader synthesizes Spheroid.orientationFromLLA,
        // followed by parent RotateByEntityOrientation; it is not absent attitude.
        if(c.type==='fixed' && c.llaOnSpheroid?.constructor==='LatLonAlt') {
          const parent=c.llaOnSpheroidEntity ?? this.parentAt(id,t);
          const sph=eyesDefinitions[parent??'']?.spheroid;
          if(!parent||!sph)throw Error('Landing orientation spheroid unavailable');
          const [latitude,longitude]=c.llaOnSpheroid.values;
          let graphic=latitude;
          if(!sph.planetographic) {
            const local=staticPosition(id,t,[1,0,0,0]);
            if(!local)throw Error('Landing orientation position unavailable');
            const rho=Math.hypot(local[0],local[1]);
            const e2=1-(sph.polarRadius/sph.equatorialRadius)**2;
            for(let i=0;i<16;i++) {
              const n=sph.equatorialRadius/Math.sqrt(1-e2*Math.sin(graphic)**2);
              graphic=Math.atan2(local[2]+e2*n*Math.sin(graphic),rho);
            }
          }
          const a=Math.sin(graphic),b=Math.sin(longitude),sign=Math.sign(Math.cos(longitude));
          const local:Quat=[.5*Math.sqrt((1+a)*(1-b)),.5*Math.sqrt((1-a)*(1-b)),.5*Math.sqrt((1-a)*(1+b))*sign,.5*Math.sqrt((1+a)*(1+b))*sign];
          const [w,x,y,z]=this.#orientationAt(parent,t),[W,X,Y,Z]=local;
          q=normalizeOrientation([w*W-x*X-y*Y-z*Z,w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W]);
          found=true;
        }
        if (isOrientationDynamo(c)) {
          const laterFixed=(eyesDefinitions[id]?.controllers??[]).slice(controllerIndex+1).some(next=>
            next.type==='fixed' && (next.orientation?.constructor==='Quaternion'||next.llaOnSpheroid?.constructor==='LatLonAlt') &&
            (!next.coverage || (t>=Number(next.coverage[0])&&t<=Number(next.coverage[1]))));
          if(laterFixed)continue;
          if (this.#oriAbsent(id,t)) continue;
          const selected=this.#oriSelections.get(id);
          if(selected && selected.track!==c.url)continue;
          const d = this.#ori.get(id);
          if (!d || !this.#oriCacheValid(id,t))
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
      if (isOrientationDynamo(c)) {
        const selected=this.#oriSelections.get(id);
        if (!this.#oriAbsent(id,t) && (!selected || selected.track===c.url) && this.#oriCacheValid(id,t)) source = "dyn";
      }
      if (c.type === "fixed" && (c.orientation || c.llaOnSpheroid)) source = c.llaOnSpheroid ? "derived" : "fixed";
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
    this.#positionDependenciesCapture?.add(id);
    if (id === "sun") return [0, 0, 0];
    const keyframe=eyesPositionKeyframe(id,t);if(keyframe)return keyframe.velocity;
    if (this.needsPositionRefresh(id,t)) throw Error("Outside source controller coverage");
    if (!hasDisplayCatalog(id))
      throw Error("Reference-only world velocity unavailable: " + id);
    if (
      activeController(id, t, "rotateByEntityOrientation").some(c => c.rotatingPosition !== false) ||
      activeController(id, t, "fixed").some(
        (c) => c.relativeToEntity || c.llaOnSpheroid,
      )
    )
      throw Error("Rotating reference world velocity unavailable");
    const declaredVelocity = staticVelocity(id, t);
    if (declaredVelocity) return declaredVelocity;
    const d = this.#data.get(id);
    let v: Vec3;
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
              : eyesPositionKeyframe(item.id,epoch)?.source ?? (s.positionSource !== "dyn"
                ? "NASA Eyes recovered " +
                  s.positionSource +
                  " position controller; finite coverage bounded by platform evaluation domain, not observation end; orientation " +
                  (s.orientationSource ?? "unavailable")
                : JSON.stringify(this.provenance(item.id).slice(-2)) +
                  " NASA Eyes DYN / recovered 4a8a83b approximation; ET mapped to core TDB argument, periodic TT-TDB difference unresolved; segment accuracy not certified; shared Eyes Dynamo ICRF-direction convention supported by Earth, Mercury, Jupiter and Moon endpoint comparisons; no all-epoch accuracy certification"),
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
    if (!Number.isFinite(epoch) || eyesTrailDuration(id, epoch) === 0) return false;
    const status=this.status(id);
    if(status && status.status!=="ready")return false;
    const policy=eyesTrailPhase(id,epoch);
    const start=policy.relativeStartTime ? (policy.startTime===undefined ? -Infinity : epoch-policy.startTimeMultiplier*policy.startTime) : policy.startTime;
    const end=policy.relativeEndTime ? epoch+policy.endTimeMultiplier*policy.endTime : policy.endTime;
    if(start!==undefined && start>=end)return false;
    if(this.status(id)?.status==='ready') {
      try {const [lo,hi]=this.trajectoryRange(id,epoch);if(Math.max(lo,start??-Infinity)>=Math.min(hi,end))return false;}
      catch {return false;}
    }
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
    const keyframe=eyesPositionKeyframe(id,epoch);if(keyframe)return keyframe.coverage;
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
  clearTrailHistory() {
    this.#history?.manager.dispose();
    this.#history = undefined;
  }
  #historyAt(id: string, epoch: number) {
    const slot = this.#history;
    return slot?.id === id && slot.origin === (eyesTrailPhase(id,epoch).relativeToEntity || this.parentAt(id,epoch) || undefined) && slot.policyKey===eyesTrailPhase(id,epoch).key &&
      slot.policyDuration === eyesTrailDuration(id, epoch) &&
      slot.trackKey === positionTrackKey(id,epoch) &&
      Math.abs(epoch - slot.epoch) <= slot.reuse ? slot : undefined;
  }
  /** Prepare separate historical sources without publishing states or changing time. */
  async prepareTrailHistory(id: string, epoch: number, predictive = false): Promise<boolean> {
    if (catalogBody(id)?.kind !== "spacecraft" || this.status(id)?.status !== "ready") return false;
    const policy=eyesTrailPhase(id,epoch);
    const origin=policy.relativeToEntity || this.parentAt(id,epoch) || undefined;
    const existing = this.#historyAt(id, epoch);
    if (existing) {
      if (existing.pending) return existing.pending;
      return false;
    }
    const displaySampling=this.#trailSampling.get(id);
    let local:ReturnType<SolarSystemData["trailSamples"]>;
    let alreadyCovered=false;
    try {
      // A lightweight coverage probe must never replace the live 512-point
      // selected-camera allocation merely because its own budget is eight.
      local=this.trailSamples(id,epoch,8);
      if(predictive) {
        const probe=this.trailSampleSteps(id,epoch,8,false,undefined,local.durationSeconds);
        let step=probe.next();while(!step.done)step=probe.next();
        const policyBoundaries=eyesTrailBoundaries(id);
        const desiredStart=Math.max(epoch-2*local.durationSeconds,...policyBoundaries.filter(time=>time<=epoch-local.durationSeconds));
        const desiredEnd=Math.min(epoch+local.durationSeconds,...policyBoundaries.filter(time=>time>=epoch));
        alreadyCovered=step.value.breakIndices.length===0 && step.value.epochsTdbSeconds[0]<=desiredStart+1e-6 && step.value.epochsTdbSeconds.at(-1)!>=desiredEnd-1e-6;
      } else alreadyCovered=local.epochsTdbSeconds[0]<=epoch-local.durationSeconds+1e-6 && local.epochsTdbSeconds.at(-1)!>=epoch-1e-6;
    } finally {
      if(displaySampling)this.#trailSampling.set(id,displaySampling);
      else this.#trailSampling.delete(id);
    }
    if(alreadyCovered)return false;
    this.clearTrailHistory();
    // Pad both ends for bidirectional reuse without truncating the display window.
    const start = epoch - local.durationSeconds * (predictive ? 2 : 1 + 1 / 32), end = epoch + local.durationSeconds * (predictive ? 1 : 1 / 16 + 1 / 32);
    const manager = new TrailHistory({
      parentAt:(target,time)=>this.parentAt(target,time), boundaries: target => [...(eyesDefinitions[target]?.parents ?? []).map(([time]) => Number(time)),...positionTrackBoundaries(target),...eyesTrailBoundaries(target)],
      phaseAt:(target,time)=>positionFrameKey(target,time,origin),
      maxSegments: 32, maxRecords: 200000,
      createSource: (signal, remainingRecords) => new SolarSystemData({
        signal: AbortSignal.any([signal, this.#abort.signal]), onDispose() {},
        data: {publish() {}, remove() {}},
      } as unknown as PluginContext, {
        maxCachedRecords: remainingRecords,
        fetch: async (input, init) => {
          const result = await this.#read(String(input), init?.signal ?? undefined);
          return new Response(result.bytes, {headers: {
            "x-dyn-source-sha256": result.evidence.sourceSha256 ?? result.evidence.sha256,
            ...(result.controller?{"x-dyn-controller-selection":JSON.stringify(result.controller)}:{}),
          }});
        },
      }),
    });
    const slot: HistorySlot = {id,origin,epoch,duration:local.durationSeconds,reuse:local.durationSeconds*(predictive? .5:1/32),policyDuration:eyesTrailDuration(id,epoch),trackKey:positionTrackKey(id,epoch),policyKey:policy.key,manager};
    this.#history = slot;
    slot.pending = manager.prepare(id, Math.max(start,Math.min(end,epoch)), start, end, origin, undefined, {referenceOrientation:policy.relativeToEntityOrientation}).then(prepared => {
      if (this.#history !== slot) {prepared.dispose(); return false;}
      try {prepared.position(epoch);} catch (error) {prepared.dispose(); throw error;}
      slot.prepared = prepared;
      slot.pending = undefined;
      return true;
    }).catch(error => {
      if (this.#history === slot) this.clearTrailHistory();
      throw error;
    });
    return slot.pending;
  }
  orientation(id:string,epoch:number):Quat { return [...this.#orientationAt(id,epoch)] as Quat; }
  trailSamples(id:string,epoch:number,count=256,detailed=false) {
    const work=this.trailSampleSteps(id,epoch,count,detailed);
    let step=work.next();while(!step.done)step=work.next();return step.value;
  }
  *trailSampleSteps(id: string, epoch: number, count = 256, detailed = false, observerWorld?: readonly number[], guardSeconds = 0) {
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
    const policy=eyesTrailPhase(id,epoch);
    const origin=policy.relativeToEntity || this.parentAt(id,epoch) || undefined;
    const preparedHistory = this.#historyAt(id, epoch)?.prepared;
    let history = preparedHistory;
    if (history) try {history.position(epoch);} catch {history = undefined;}
    const samplingKey = JSON.stringify([policy.key, origin, policy.relativeToEntityOrientation, positionTrackKey(id, epoch), count,guardSeconds>0]);
    let sampling = this.#trailSampling.get(id);
    if (!sampling || sampling.key !== samplingKey || sampling.history !== history) {
      const dependencies=new Set<string>();
      for(const root of [id,origin]) {
        let target=root;
        while(target && !dependencies.has(target)) {
          dependencies.add(target);
          target=this.parentAt(target,epoch) ?? undefined;
        }
      }
      sampling = {key: samplingKey, history, state: new AdaptiveTrailState(), before: new AdaptiveTrailState(), after: new AdaptiveTrailState(), dependencies, orientationDependencies:new Set()};
      this.#trailSampling.set(id, sampling);
    }
    const failedProbes = new Set<number>();
    const relativeCache = new Map<number, number[]>();
    const scientificRelative = (t: number) => {
      if (history) return history.position(t);
      const cached = relativeCache.get(t);
      if (cached) return cached;
      let world: [number, number, number];
      let parent: number[];
      const previousPublicationCache=this.#publicationCache;
      this.#publicationCache={epoch:t,positions:new Map()};
      try {
        // Child composition and subtraction share the same scientific ancestor
        // evaluation at this probe epoch; the scope never crosses a yield.
        world = this.position(id, t);
        parent = origin ? this.position(origin, t) : [0, 0, 0];
      } catch (error) {
        failedProbes.add(t);
        throw error;
      } finally {
        this.#publicationCache=previousPublicationCache;
      }
      let point = world.map((v, i) => v - parent[i]);
      if(policy.relativeToEntityOrientation && origin) {
        const q=this.orientation(origin,t);
        point=rotateVector(point as [number,number,number],[q[0],-q[1],-q[2],-q[3]]);
      }
      relativeCache.set(t, point);
      return point;
    };
    const captureScientific = <T>(evaluate:()=>T):T => {
      const previous=this.#orientationDependenciesCapture,previousPositions=this.#positionDependenciesCapture;
      this.#orientationDependenciesCapture=sampling.orientationDependencies;
      this.#positionDependenciesCapture=sampling.dependencies;
      try {return evaluate();} finally {this.#orientationDependenciesCapture=previous;this.#positionDependenciesCapture=previousPositions;}
    };
    const relative = (t:number) => captureScientific(()=>scientificRelative(t));
    const trailOrientation = (target:string,time:number) => captureScientific(()=>this.orientation(target,time));
    // Renderer freezes the parent frame at the current epoch for this path.
    // Measure visual error in that same frame, never against heliocentric radius.
    let observer: number[] | undefined;
    if(detailed && observerWorld?.length===3 && observerWorld.every(Number.isFinite)) {
      const parent=origin ? captureScientific(()=>this.position(origin,epoch)) : [0,0,0];
      observer=observerWorld.map((x,i)=>x-parent[i]);
      if(policy.relativeToEntityOrientation && origin) {
        const q=trailOrientation(origin,epoch);
        observer=rotateVector(observer as [number,number,number],[q[0],-q[1],-q[2],-q[3]]);
      }
    }
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
    if (d?.kind === "inline" && d.type === "orb" && this.#positionSource(id,epoch) === "dyn") {
      try {
        const at=captureScientific(()=>this.position(id,epoch));
        const parent=origin ? captureScientific(()=>this.position(origin,epoch)) : [0,0,0];
        const local=at.map((x,i)=>x-parent[i]) as [number,number,number];
        const autoLength=eyesOrbAutoLength(d,epoch,local,captureScientific(()=>this.sourceVelocity(id,epoch)));
        if (autoLength !== undefined) inferredPeriod=autoLength;
      } catch {
        /* Unsupported rotating frames retain the existing finite fallback. */
      }
    }
    const authoredDuration = policy.relativeStartTime ? policy.startTime : undefined;
    if (authoredDuration === 0) throw Error("Trail disabled by source policy");
    const isSpacecraft = catalogBody(id)?.kind === "spacecraft";
    let durationSeconds = authoredDuration ?? (isSpacecraft
      ? Math.max(1, Math.min(MAX_TRAIL_DURATION_SECONDS, inferredPeriod))
      : Math.min(
      30 * 86400,
      inferredPeriod,
      rate > 0 ? (0.052 * (count - 2)) / (1.0625 * rate) : inferredPeriod,
    ));
    if(!policy.relativeStartTime && policy.startTime!==undefined) durationSeconds=Math.max(0,epoch-policy.startTime);
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
    if (history) {coveredStart = history.start; coveredEnd = history.end;}
    let start = 0,
      end = 0;
    let drawRangeTdbSeconds: [number,number] | undefined;
    let times: number[] = [];
    let unresolved = new Set<number>();
    if (authoredDuration !== undefined || isSpacecraft) {
      const rawStart=policy.relativeStartTime ? epoch-policy.startTimeMultiplier*durationSeconds : policy.startTime!;
      const rawEnd=policy.relativeEndTime ? epoch+policy.endTimeMultiplier*policy.endTime : policy.endTime;
      start=Math.max(coveredStart,rawStart);
      end=Math.min(coveredEnd,rawEnd);
      if(start>=end)throw Error('Trail disabled by source policy');
      // Source-authored edges move independently; renderer clips against actual samples.
      drawRangeTdbSeconds=[rawStart,rawEnd];
      const reuse=guardSeconds>0 ? Math.min(durationSeconds,Math.max(durationSeconds/(detailed?1024:16),guardSeconds)) : durationSeconds/(detailed?1024:16);
      const boundaries=eyesTrailBoundaries(id);
      if(policy.relativeStartTime) start=Math.max(coveredStart,start-reuse,...boundaries.filter(t=>t<=start));
      if(policy.relativeEndTime) end=Math.min(coveredEnd,end+reuse,...boundaries.filter(t=>t>=end));
      if(guardSeconds>0) {
        const visibleStart=Math.max(start,Math.min(end,rawStart));
        const visibleEnd=Math.max(visibleStart,Math.min(end,rawEnd));
        times=[];unresolved=new Set<number>();
        for(const [a,b,anchor,retained] of [
          [visibleStart,visibleEnd,Math.max(visibleStart,Math.min(visibleEnd,epoch)),sampling.state],
          [start,visibleStart,visibleStart,sampling.before],
          [visibleEnd,end,visibleEnd,sampling.after],
        ] as const) {
          if(a>=b)continue;
          const part=yield* adaptiveTrailSteps(a,anchor,b,count,relative,period,history?.boundaries??[],observer,retained,true);
          times.push(...part.times);
          for(const t of part.unresolved)unresolved.add(t);
        }
        times=[...new Set(times)].sort((a,b)=>a-b);
        if(times.length>4096)throw Error("Predictive trail per-object sample capacity");
      } else {
        ({times,unresolved}=yield* adaptiveTrailSteps(start,Math.max(start,Math.min(end,epoch)),end,count,relative,period,[...(history?.boundaries??[]),...drawRangeTdbSeconds.filter(t=>!sampling.state.covers(t))],observer,sampling.state,true));
      }
    } else for (let attempt = 0; attempt <= 8; attempt++) {
      relativeCache.clear();
      start = Math.max(coveredStart, epoch - durationSeconds);
      end = Math.min(coveredEnd, epoch + durationSeconds / 16);
      times = [epoch];
      for (let i = 0; i < count - 1; i++)
        times.push(start + ((end - start) * i) / (count - 2));
      times = [...new Set(times)].sort((a, b) => a - b);
      unresolved = new Set<number>();
      for (let i = 1; i < times.length; i++) {
        yield;
        try {
          const p = relative(times[i - 1]),
            q = relative(times[i]);
          let previous = p;
          for (let j = 1; j <= 8; j++) {
            yield;
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
    if (history) for (const boundary of history.boundaries) {
      yield;
      const epsilon = Math.min(0.1, (boundary - start) / 4, (end - boundary) / 4);
      if (epsilon <= Math.abs(boundary) * Number.EPSILON * 4) continue;
      try {
        const a = relative(boundary - epsilon * 2), b = relative(boundary - epsilon);
        const c = relative(boundary + epsilon), d = relative(boundary + epsilon * 2);
        const distance = (p: readonly number[], q: readonly number[]) => Math.hypot(...p.map((x,i) => x-q[i]));
        if (distance(b,c) > 8 * Math.max(distance(a,b),distance(c,d)) + 0.01) failedProbes.add(boundary);
      } catch {failedProbes.add(boundary);}
    }
    const failures = [...failedProbes].sort((a, b) => a - b);
    let failureIndex = 0;
    for (let i = 1; i < times.length; i++) {
      if (i % 16 === 1) yield;
      while (
        failureIndex < failures.length &&
        failures[failureIndex] < times[i - 1]
      )
        failureIndex++;
      if (failureIndex < failures.length && failures[failureIndex] <= times[i])
        unresolved.add(times[i]);
    }
    const originId=origin;
    const epochsTdbSeconds: number[] = [];
    const points: [number, number, number][] = [];
    const breakIndices: number[] = [];
    let gap = false;
    let assembled = 0;
    for (const t of [...new Set(times)].sort((a, b) => a - b)) {
      const cached = sampling.state.samples.get(t) ?? sampling.before.samples.get(t) ?? sampling.after.samples.get(t);
      if (!cached || assembled++ % 16 === 0) yield;
      try {
        const point = (cached ?? relative(t)) as [number, number, number];
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
    const sourceCurrent = () => this.#trailSampling.get(id) === sampling && this.#historyAt(id,epoch)?.prepared === preparedHistory;
    return {
      get sourceCurrent() {return sourceCurrent();},
      points,
      epochsTdbSeconds,
      originId,
      referenceOrientation:policy.relativeToEntityOrientation,
      visibleInterval:policy.visibleInterval,
      policyKey:policy.key,
      drawRangeTdbSeconds:drawRangeTdbSeconds??[start,end] as [number,number],
      drawEpochTdbSeconds:epoch,
      drawRelativeStart:policy.relativeStartTime,
      drawRelativeEnd:policy.relativeEndTime,
      breakIndices,
      durationSeconds,
      refreshRange: [
        Math.max(rangeStart,coveredStart,...eyesTrailBoundaries(id).filter(t=>t<=epoch),epoch-(guardSeconds>0?Math.min(durationSeconds,Math.max(durationSeconds/(detailed?1024:16),guardSeconds)):durationSeconds/(detailed?1024:16))),
        Math.min(rangeEnd,coveredEnd,...eyesTrailBoundaries(id).filter(t=>t>=epoch),epoch+(guardSeconds>0?Math.min(durationSeconds,Math.max(durationSeconds/(detailed?1024:16),guardSeconds)):durationSeconds/(detailed?1024:16))),
      ] as [number, number],
    };
  }
  dispose() {
    this.clearTrailHistory();    this.#trailSampling.clear(); this.#positionStitches.clear(); this.#generation++;
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
    this.#oriKeys.clear();
    this.#oriSelections.clear();
    this.#oriAbsences.clear();
    this.#outsideOri.clear();
    this.#spinAnchors.clear();
    this.#dataParents.clear();
    this.#dataTracks.clear();
    this.#dataSelections.clear();
    this.#provenance.clear();
    this.#pending.clear();
  }
}
