import { createHash } from "node:crypto";
import { decodeDyn } from "../../platform/dyn-decoder.ts";

export type DynSelection = { sourceSha256: string; records: [number, number]; coverage: [number, number] };

// Half-open record ranges, verified against the exact original payloads. Never reorder records.
const reviewed: Record<string, { sha256: string; windows: [number, number][] }> = {
  venus: {
    sha256: "6d922b577b7a1eb5997b3668804c738fdfaaafdd5a5f21eae10da24f20526404",
    // Records 15 and 16 are byte-identical. Split at their common epoch.
    windows: [[0, 16], [16, 34]],
  },
  mars: {
    sha256: "613a4de052a743ba7e6090584edeea8c90c87ab971d56ce3dfbf52f3acba7e22",
    // The second ordered run overlaps the first. Exclude all ambiguous historical intervals.
    windows: [[0, 9], [17, 50]],
  },
};

export function selectReviewedDynWindow(id: string, raw: Uint8Array, epoch: number): { bytes: Uint8Array; selection?: DynSelection } {
  const policy = reviewed[id];
  if (!policy) return { bytes: raw };
  const sourceSha256 = createHash("sha256").update(raw).digest("hex");
  // New upstream payloads pass through the unchanged strict decoder, never a guessed repair.
  if (sourceSha256 !== policy.sha256) return { bytes: raw };
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (const [start, end] of policy.windows) {
    const coverage: [number, number] = [view.getFloat64(28 + start * 72, true), view.getFloat64(28 + (end - 1) * 72, true)];
    if (epoch < coverage[0] || epoch > coverage[1]) continue;
    const bytes = new Uint8Array(28 + (end - start) * 72);
    bytes.set(raw.subarray(0, 28));
    new DataView(bytes.buffer).setInt32(24, end - start, true);
    bytes.set(raw.subarray(28 + start * 72, 28 + end * 72), 28);
    decodeDyn(bytes); // Same strict checks as all other resources.
    return { bytes, selection: { sourceSha256, records: [start, end], coverage } };
  }
  throw Error("Outside source coverage: reviewed source has an ambiguous historical interval");
}
