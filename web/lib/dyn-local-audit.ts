import { createHash } from "node:crypto";
import { decodeDyn } from "../../platform/dyn-decoder.ts";

type AuditFile = { name: string; sha256: string; bytes: number; coverage?: { start: number; end: number } };
export type DynTrackAudit = {
  track: string;
  status: "ready" | "incomplete" | "review";
  coverage?: { start: number; end: number };
  files: AuditFile[];
  missing: string[];
  errors: { name: string; error: string }[];
};

/** Audit the original tree without sorting, repairing or extrapolating source data. */
export async function auditDynTrack(
  track: string,
  read: (name: string, signal: AbortSignal) => Promise<Uint8Array | undefined>,
  signal: AbortSignal,
  verified?: (name: string, raw: Uint8Array, signal: AbortSignal) => Promise<void>,
): Promise<DynTrackAudit> {
  const result: DynTrackAudit = { track, status: "ready", files: [], missing: [], errors: [] };
  const pending = ["def.dyn"], seen = new Set<string>();
  let header: Uint8Array | undefined, version = 0;
  while (pending.length) {
    signal.throwIfAborted();
    const batch = pending.splice(0, 4);
    await Promise.all(batch.map(async name => {
      if (seen.has(name)) return;
      seen.add(name);
      if (seen.size > 500_000) throw Error("DYN audit track file budget");
      try {
        const raw = await read(name, signal);
        signal.throwIfAborted();
        if (!raw) { result.missing.push(name); return; }
        const record: AuditFile = { name, sha256: createHash("sha256").update(raw).digest("hex"), bytes: raw.length };
        result.files.push(record);
        let full = raw;
        if (name === "def.dyn") {
          if (raw.byteLength < 8) throw Error("DYN truncated header");
          const end = raw.indexOf(0, 2), text = end < 0 ? "" : String.fromCharCode(...raw.slice(2, end));
          version = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt16(0, true);
          const size = end + 1 + (version === 2 ? 1 : 0) + (text === "orb" ? 16 : 0);
          if (end < 3 || size >= raw.length) throw Error("DYN invalid header");
          header = raw.slice(0, size);
        } else {
          if (!header) throw Error("DYN missing root header");
          full = new Uint8Array(header.length + (version === 1 ? 1 : 0) + raw.length);
          full.set(header); if (version === 1) full[header.length] = 1;
          full.set(raw, header.length + (version === 1 ? 1 : 0));
        }
        const decoded = decodeDyn(full);
        if (verified) await verified(name, raw, signal);
        record.coverage = decoded.coverage;
        if (name === "def.dyn") result.coverage = decoded.coverage;
        if (decoded.kind === "index") {
          const parent = name === "def.dyn" ? "" : name.slice(0, -4) + "_";
          for (let i = 0; i < decoded.segments.length; i++) pending.push(parent + String(i).padStart(decoded.paddingWidth, "0") + ".dyn");
        }
      } catch (error) {
        signal.throwIfAborted();
        result.errors.push({ name, error: String(error) });
      }
    }));
  }
  result.files.sort((a, b) => a.name.localeCompare(b.name));
  result.missing.sort(); result.errors.sort((a, b) => a.name.localeCompare(b.name));
  result.status = result.errors.length ? "review" : result.missing.length ? "incomplete" : "ready";
  return result;
}
