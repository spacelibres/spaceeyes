import { createHash } from "node:crypto";
import { decodeDyn } from "../../platform/dyn-decoder.ts";
import type { DynSelection } from "./reviewed-dyn-window.ts";
import registry from "./reviewed-mission-policies.json" with { type: "json" };
type Policy = {
  hash: string;
  sourceSha256?: string;
  base: number;
  stride: number;
  flag: number;
  windows: number[][];
};
const policies: Record<string, Policy> = {
  ...registry,
  "sc_voyager_1/sun/3/def": {
    hash: "e15f5d93fcb3b5b5a1bce1f8696b7da7e4c5fdaac067a40b3aa82bc5a82dd97c",
    base: 12,
    stride: 56,
    flag: 1,
    windows: [[0, 6]],
  },
  "sc_voyager_2/sun/5/def": {
    hash: "cf51382cc63e61b3dd18db1f6b04e30023050f8d29d37ae804c789fc0a5ed35a",
    base: 12,
    stride: 56,
    flag: 1,
    windows: [[0, 4]],
  },
};
/** Hash-pinned, contiguous source runs only. No sorting, changed samples or extrapolation. */
export function reviewedMissionWindow(
  track: string,
  raw: Uint8Array,
  epoch = 0,
  name = "def",
): { bytes: Uint8Array; selection?: DynSelection } {
  const p = policies[`${track}/${name}`];
  if (!p) return { bytes: raw };
  const hash = createHash("sha256").update(raw).digest("hex");
  if (hash !== p.hash) return { bytes: raw };
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const candidates = p.windows.filter(
    ([start, end]) =>
      epoch >= view.getFloat64(p.base + start * p.stride, true) &&
      epoch <= view.getFloat64(p.base + (end - 1) * p.stride, true),
  );
  if (!candidates.length)
    throw Error(
      "Outside source coverage: no reviewed ordered mission interval",
    );
  if (candidates.length > 1) {
    // A shared epoch is permitted only when the endpoint records are byte identical.
    const endpoints = candidates.map(([start, end]) => {
      const first = view.getFloat64(p.base + start * p.stride, true);
      const i = first === epoch ? start : end - 1;
      return raw.subarray(p.base + i * p.stride, p.base + (i + 1) * p.stride);
    });
    if (!endpoints.every((b) => b.every((v, i) => v === endpoints[0][i])))
      throw Error("Outside source coverage: ambiguous mission intervals");
  }
  const [start, end] = candidates[0];
  if (p.flag === 0 && start !== 0) throw Error("Unreviewed index renumbering");
  const bytes = new Uint8Array(p.base + (end - start) * p.stride);
  bytes.set(raw.subarray(0, p.base));
  new DataView(bytes.buffer).setInt32(p.base - 4, end - start, true);
  bytes.set(
    raw.subarray(p.base + start * p.stride, p.base + end * p.stride),
    p.base,
  );
  const d = decodeDyn(bytes);
  return {
    bytes,
    selection: {
      sourceSha256: p.sourceSha256 ?? hash,
      records: [start, end],
      coverage: [d.coverage.start, d.coverage.end],
    },
  };
}
