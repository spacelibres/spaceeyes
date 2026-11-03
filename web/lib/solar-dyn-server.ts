import { dynByteCacheFor } from "./dyn-byte-cache.ts";
import { createHash } from "node:crypto";
import { reviewedMissionWindow,ReviewedMissionOutsideCoverage } from "./reviewed-mission-window.ts";
import type {PositionSelection} from "../../platform/position-selection.ts";
import {
  declaredTracks,
  getEyesDefinition,
} from "../../platform/eyes-catalog.ts";
import { decodeDyn } from "../../platform/dyn-decoder.ts";
import { solarCatalog } from "../../platform/solar-system.ts";
import {
  selectReviewedDynWindow,
  type DynSelection,
} from "./reviewed-dyn-window.ts";
// Reviewed exact raw Psyche quat child. Preserve contiguous source records;
// reject ambiguous boundaries instead of deleting or averaging conflicting attitudes.
function reviewedQuatWindow(raw: Uint8Array, epoch: number): {bytes:Uint8Array;selection?:DynSelection} {
  if (raw.length < 13 || String.fromCharCode(...raw.slice(2,6)) !== "quat" || raw[8] !== 1 ||
      createHash("sha256").update(raw.slice(8)).digest("hex") !== "a4f60b1ad7790d0bfd73019a1b9bbc40a3dc8b9440e94504d7b241c1020e375f")
    return {bytes:raw};
  const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),count=v.getInt32(9,true);
  if(raw.length !== 13+count*40)throw Error("Invalid reviewed quaternion payload");
  const time=(i:number)=>v.getFloat64(13+i*40,true);
  const windows:[number,number][]=[];let start=0;
  for(let i=1;i<count;i++)if(time(i)<=time(i-1)){windows.push([start,i]);start=i;}
  windows.push([start,count]);
  const matches=windows.filter(([a,b])=>b-a>=2 && epoch>=time(a)&&epoch<=time(b-1));
  if(matches.length!==1)throw Error("Ambiguous or uncovered reviewed quaternion epoch");
  const [a,b]=matches[0],bytes=new Uint8Array(13+(b-a)*40);
  bytes.set(raw.slice(0,13));new DataView(bytes.buffer).setInt32(9,b-a,true);
  bytes.set(raw.slice(13+a*40,13+b*40),13);
  return {bytes,selection:{sourceSha256:createHash("sha256").update(raw).digest("hex"),records:[a,b],coverage:[time(a),time(b-1)]}};
}
export class OrientationOutsideCoverage extends Error {
  readonly coverage: readonly [number,number];
  constructor(coverage: readonly [number, number]) { super("Outside source coverage");this.coverage=coverage; }
}
export class OrientationControllersOutsideCoverage extends Error {
  readonly domain: PositionSelection;
  constructor(domain: PositionSelection) {super("Outside source coverage across orientation controllers");this.domain=domain;}
}
class PositionOutsideCoverage extends Error {
  readonly lowerExclusive?:number;
  readonly upperExclusive?:number;
  readonly lowerInclusive?:number;
  constructor(message:string,lowerExclusive?:number,upperExclusive?:number,lowerInclusive?:number){
    super(message);this.lowerExclusive=lowerExclusive;this.upperExclusive=upperExclusive;this.lowerInclusive=lowerInclusive;
  }
}
async function fetchTrack(
  id: string,
  epoch: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  type: "orb" | "ori" = "orb",
  onSelection?: (selection: DynSelection) => void,
  track?: string,
  onDomain?: (value: Omit<PositionSelection,"track">) => void,
): Promise<Uint8Array> {
  const item = solarCatalog.find((x) => x.id === id);
  if (!item?.orbPath || !Number.isFinite(epoch))
    throw Error("Invalid solar resource");
  const cache = dynByteCacheFor(fetcher), visited = new Set<string>();
  const read = async (name: string) => {
    const url = `https://eyes.nasa.gov/assets/dynamic/dynamo/${track ?? (type === "ori" ? `${id}/ori` : item.orbPath)}/${name}.dyn`;
    const bytes = await cache.read(url, signal);
    visited.add(url);
    return bytes;
  };
  try {
  let name = "def";
  let header: Uint8Array | undefined;
  for (let depth = 0; depth < 8; depth++) {
    let bytes: Uint8Array = await read(name);
    if (name === "def") {
      const typeEnd = bytes.indexOf(0, 2);
      if (typeEnd < 3 || typeEnd > 6 || bytes.length < typeEnd + 2)
        throw Error("Invalid DYN type header");
      const wireType = String.fromCharCode(...bytes.slice(2,typeEnd));
      if (!["orb","ori","quat","pos","lin"].includes(wireType))
        throw Error("DYN unsupported type");
      const headerLength = typeEnd + 1 +
        (new DataView(bytes.buffer, bytes.byteOffset).getInt16(0,true) === 2 ? 1 : 0) +
        (wireType === "orb" ? 16 : 0);
      header = bytes.slice(0, headerLength);
    } else {
      const version = new DataView(header!.buffer).getInt16(0, true);
      const prefix = version === 1 ? new Uint8Array([1]) : new Uint8Array();
      const full = new Uint8Array(
        header!.length + prefix.length + bytes.length,
      );
      full.set(header!);
      full.set(prefix, header!.length);
      full.set(bytes, header!.length + prefix.length);
      bytes = full;
    }
    if (
      name === "def" &&
      type === "orb" &&
      String.fromCharCode(...bytes.slice(2, 5)) === "orb"
    ) {
      const selected = selectReviewedDynWindow(id, bytes, epoch);
      bytes = selected.bytes;
      if (selected.selection) onSelection?.(selected.selection);
    }
    if (track) {
      try {
        const selected = reviewedMissionWindow(track, bytes, epoch, name);
        bytes = selected.bytes;
        if (selected.domain) onDomain?.(selected.domain);
        if (selected.selection) onSelection?.(selected.selection);
      }catch(error){
        if(type==="orb"&&error instanceof ReviewedMissionOutsideCoverage)
          throw new PositionOutsideCoverage(error.message,error.lowerExclusive,error.upperExclusive);
        throw error;
      }
    }
    if (type === "ori") {
      const selected = reviewedQuatWindow(bytes,epoch);bytes=selected.bytes;
      if(selected.selection)onSelection?.(selected.selection);
    }
    const d = decodeDyn(bytes);
    if (epoch < d.coverage.start || epoch > d.coverage.end) {
      if (type === "ori" && name === "def")
        throw new OrientationOutsideCoverage([d.coverage.start, d.coverage.end]);
      if (type === "orb") throw new PositionOutsideCoverage("Outside source coverage",
        epoch>d.coverage.end?d.coverage.end:undefined,epoch<d.coverage.start?d.coverage.start:undefined);
      throw Error("Outside source coverage");
    }
    if (d.kind === "inline") return bytes;
    const index = d.segments.findIndex(
      (s, i) =>
        epoch >= s.start &&
        (epoch < s.end || (i === d.segments.length - 1 && epoch === s.end)),
    );
    if (index < 0) {
      if (type === "orb") throw new PositionOutsideCoverage("DYN index gap",
        undefined,Math.min(...d.segments.filter(s=>s.start>epoch).map(s=>s.start)),
        Math.max(...d.segments.filter(s=>s.end<=epoch).map(s=>s.end)));
      throw Error("DYN index gap");
    }
    const child = String(index).padStart(d.paddingWidth, "0");
    name = name === "def" ? child : `${name}_${child}`;
  }
  throw Error("DYN index depth budget");
  } catch (error) {
    // Transport failures are not cached. Reject reviewed/decoded HTTP-200 bytes
    // too, so a corrected upstream resource can be fetched immediately.
    if (!signal.aborted && !(error instanceof PositionOutsideCoverage) &&
        !(error instanceof OrientationOutsideCoverage))
      for (const url of visited) cache.evict(url);
    throw error;
  }
}

export async function fetchSolarDyn(
  id: string,
  epoch: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  type: "orb" | "ori" = "orb",
  onSelection?: (selection: DynSelection) => void,
  onController?: (selection:PositionSelection)=>void,
): Promise<Uint8Array> {
  if (!Number.isFinite(epoch)) throw Error("Invalid solar resource");
  const allDeclared = declaredTracks(id, type);
  const declared = declaredTracks(id, type, epoch);
  if (allDeclared.length && !declared.length)
    throw Error("Outside source controller coverage");
  // Entity evaluates position controllers in declaration order: later covered
  // tracks override earlier tracks, regardless of the URL's parent-looking path.
  const tracks = [...declared].reverse();
  if (!getEyesDefinition(id) || !tracks.length)
    return fetchTrack(id, epoch, signal, fetcher, type, onSelection);
  let failure: unknown;
  let lowerExclusive=-Infinity,lowerInclusive=-Infinity,upperExclusive=Infinity;
  for (const track of tracks) {
    try {
      let selection: DynSelection | undefined;
      let domain: Omit<PositionSelection,"track"> | undefined;
      const result = await fetchTrack(
        id,
        epoch,
        signal,
        fetcher,
        type,
        value => { selection=value; },
        track,
        value => { domain=value; },
      );
      if (selection) onSelection?.(selection);
      {
        const lower=Math.max(lowerExclusive,domain?.lowerExclusive??-Infinity);
        const upper=Math.min(upperExclusive,domain?.upperExclusive??Infinity);
        onController?.({track,
          ...(Number.isFinite(lower)?{lowerExclusive:lower}:{}),
          ...(Number.isFinite(lowerInclusive)?{lowerInclusive}:{}),
          ...(Number.isFinite(upper)?{upperExclusive:upper}:{})});
      }
      return result;
    } catch (e) {
      signal.throwIfAborted();
      // Only proven source absence of this epoch permits trying an earlier
      // controller. Transport/decode failures are not coverage facts.
      if (type === "orb" && !(e instanceof PositionOutsideCoverage)) throw e;
      if (type === "ori") {
        if (!(e instanceof OrientationOutsideCoverage)) throw e;
        if (epoch < e.coverage[0]) upperExclusive=Math.min(upperExclusive,e.coverage[0]);
        else if (epoch > e.coverage[1]) lowerExclusive=Math.max(lowerExclusive,e.coverage[1]);
        else throw e;
      }
      if(e instanceof PositionOutsideCoverage){
        lowerExclusive=Math.max(lowerExclusive,e.lowerExclusive??-Infinity);
        lowerInclusive=Math.max(lowerInclusive,e.lowerInclusive??-Infinity);
        upperExclusive=Math.min(upperExclusive,e.upperExclusive??Infinity);
      }
      failure = e;
    }
  }
  if (tracks.length > 1 && failure instanceof OrientationOutsideCoverage)
    throw new OrientationControllersOutsideCoverage({track:"orientation-absence",
      ...(Number.isFinite(lowerExclusive)?{lowerExclusive}:{}),
      ...(Number.isFinite(upperExclusive)?{upperExclusive}:{})});
  throw failure;
}
