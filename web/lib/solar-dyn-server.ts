import { decodeDyn } from "../../platform/dyn-decoder.ts";
import { solarCatalog } from "../../platform/solar-system.ts";
import { selectReviewedDynWindow, type DynSelection } from "./reviewed-dyn-window.ts";
export async function fetchSolarDyn(
  id: string,
  epoch: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  type: "orb" | "ori" = "orb",
  onSelection?: (selection: DynSelection) => void,
): Promise<Uint8Array> {
  const item = solarCatalog.find((x) => x.id === id);
  if (!item?.orbPath || !Number.isFinite(epoch))
    throw Error("Invalid solar resource");
  const read = async (name: string) => {
    const r = await fetcher(
      `https://eyes.nasa.gov/assets/dynamic/dynamo/${type === "ori" ? `${id}/ori` : item.orbPath}/${name}.dyn`,
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
      const headerLength =
        2 +
        type.length +
        1 +
        (new DataView(bytes.buffer, bytes.byteOffset).getInt16(0, true) === 2
          ? 1
          : 0) +
        (type === "orb" ? 16 : 0);
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
    if (name === "def" && type === "orb") {
      const selected = selectReviewedDynWindow(id, bytes, epoch);
      bytes = selected.bytes;
      if (selected.selection) onSelection?.(selected.selection);
    }
    const d = decodeDyn(bytes);
    if (epoch < d.coverage.start || epoch > d.coverage.end)
      throw Error("Outside source coverage");
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
