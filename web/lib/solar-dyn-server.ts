import { createHash } from "node:crypto";
import { reviewedMissionWindow } from "./reviewed-mission-window.ts";
import {
  declaredTracks,
  getEyesDefinition,
  parentAt,
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
async function fetchTrack(
  id: string,
  epoch: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  type: "orb" | "ori" = "orb",
  onSelection?: (selection: DynSelection) => void,
  track?: string,
): Promise<Uint8Array> {
  const item = solarCatalog.find((x) => x.id === id);
  if (!item?.orbPath || !Number.isFinite(epoch))
    throw Error("Invalid solar resource");
  const read = async (name: string) => {
    const r = await fetcher(
      `https://eyes.nasa.gov/assets/dynamic/dynamo/${track ?? (type === "ori" ? `${id}/ori` : item.orbPath)}/${name}.dyn`,
      {
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        redirect: "error",
      },
    );
    if (!r.ok || r.redirected) throw Error(`NASA DYN HTTP ${r.status}`);
    const reader = r.body?.getReader();
    let n = 0;
    const parts: Uint8Array[] = [];
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
        if (n > 16 * 1024 * 1024) throw Error("DYN byte budget");
        parts.push(value);
      }
    } catch (e) {
      await reader?.cancel();
      throw e;
    } finally {
      reader?.releaseLock();
    }
    const bytes = new Uint8Array(n);
    let offset = 0;
    for (const p of parts) {
      bytes.set(p, offset);
      offset += p.length;
    }
    return bytes;
  };
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
      const selected = reviewedMissionWindow(track, bytes, epoch, name);
      bytes = selected.bytes;
      if (selected.selection) onSelection?.(selected.selection);
    }
    if (type === "ori") {
      const selected = reviewedQuatWindow(bytes,epoch);bytes=selected.bytes;
      if(selected.selection)onSelection?.(selected.selection);
    }
    const d = decodeDyn(bytes);
    if (epoch < d.coverage.start || epoch > d.coverage.end) {
      if (type === "ori" && name === "def")
        throw new OrientationOutsideCoverage([d.coverage.start, d.coverage.end]);
      throw Error("Outside source coverage");
    }
    if (d.kind === "inline") return bytes;
    const index = d.segments.findIndex(
      (s, i) =>
        epoch >= s.start &&
        (epoch < s.end || (i === d.segments.length - 1 && epoch === s.end)),
    );
    if (index < 0) throw Error("DYN index gap");
    const child = String(index).padStart(d.paddingWidth, "0");
    name = name === "def" ? child : `${name}_${child}`;
  }
  throw Error("DYN index depth budget");
}

export async function fetchSolarDyn(
  id: string,
  epoch: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  type: "orb" | "ori" = "orb",
  onSelection?: (selection: DynSelection) => void,
): Promise<Uint8Array> {
  const declared = declaredTracks(id, type);
  const parent = parentAt(id, epoch);
  const matching =
    type === "orb" && parent
      ? declared.filter(
          (track) =>
            track.startsWith(`${id}/${parent}/`) || track === `${id}/${parent}`,
        )
      : [];
  const tracks = matching.length ? matching : declared;
  if (!getEyesDefinition(id) || !tracks.length)
    return fetchTrack(id, epoch, signal, fetcher, type, onSelection);
  let failure: unknown;
  for (const track of tracks) {
    try {
      return await fetchTrack(
        id,
        epoch,
        signal,
        fetcher,
        type,
        onSelection,
        track,
      );
    } catch (e) {
      signal.throwIfAborted();
      failure = e;
    }
  }
  if (tracks.length > 1 && failure instanceof OrientationOutsideCoverage)
    throw Error("Outside source coverage across multiple orientation tracks");
  throw failure;
}
