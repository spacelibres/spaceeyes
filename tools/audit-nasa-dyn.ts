import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { solarCatalog } from "../platform/solar-system.ts";
import { declaredTracks } from "../platform/eyes-catalog.ts";
import { auditDynTrack, type DynTrackAudit } from "../web/lib/dyn-local-audit.ts";
import { NasaDynStore, nasaDynStore } from "../web/lib/nasa-dyn-store.ts";

const options = process.argv.slice(2);
const option = (name: string) => options.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const mirror = option("mirror") ?? process.env.SPACEEYES_NASA_DYN_MIRROR;
if (!mirror) throw Error("Supply --mirror=<existing DYN files directory> or SPACEEYES_NASA_DYN_MIRROR");
const repair = options.includes("--repair"), resume = options.includes("--resume");
const requested = option("track");
const maxTracks = Number(option("max-tracks") ?? Infinity);
if (!(maxTracks === Infinity || (Number.isSafeInteger(maxTracks) && maxTracks > 0))) throw Error("Invalid track limit");
const store = new NasaDynStore({ root: nasaDynStore.root, legacyRoot: mirror, offline: !repair });
const tracks = new Set<string>();
for (const body of solarCatalog) {
  if (body.orbPath) tracks.add(body.orbPath);
  for (const type of ["orb", "ori"] as const) for (const track of declaredTracks(body.id, type)) tracks.add(track);
}
for (const entry of await readdir(mirror, { withFileTypes: true })) {
  if (entry.isDirectory() && /^[A-Za-z0-9_-]+$/.test(entry.name)) tracks.add(entry.name.replaceAll("__", "/"));
}
const selected = [...tracks].filter(x => !requested || x === requested).sort().slice(0, maxTracks);
if (!selected.length) throw Error("No matching DYN track");
const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = join(project, "web", ".cache", "nasa-dyn-audit");
await mkdir(directory, { recursive: true });
const abort = new AbortController();
process.once("SIGINT", () => abort.abort());
const rows: { track: string; status: string; files: number; missing: number; errors: number; report: string; resumed: boolean }[] = [];
for (const track of selected) {
  abort.signal.throwIfAborted();
  const name = createHash("sha256").update(track).digest("hex") + ".json", file = join(directory, name);
  let result: DynTrackAudit | undefined, resumed = false;
  if (resume) try {
    const previous = JSON.parse(await readFile(file, "utf8"));
    if (previous.track === track && previous.status === "ready" && Array.isArray(previous.files) &&
        previous.auditSource?.mirror === resolve(mirror) && previous.auditSource?.root === store.root) { result = previous; resumed = true; }
  } catch { /* Missing or invalid reports are audited again. */ }
  if (!result) {
    const downloaded = new Set<string>();
    const sourceUrl = (name: string) => `https://eyes.nasa.gov/assets/dynamic/dynamo/${track}/${name}`;
    try {
      result = await auditDynTrack(track, async (name, signal) => {
        const url = sourceUrl(name);
        const local = await store.read(url, signal);
        if (local || !repair) return local;
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
        const response = await fetch(url, { signal: deadline, redirect: "error" });
        if (response.status === 404) { await response.body?.cancel(); return undefined; }
        if (!response.ok || response.redirected || !response.body) throw Error(`NASA DYN HTTP ${response.status}`);
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
        try {
          while (true) {
            const part = await reader.read(); deadline.throwIfAborted();
            if (part.done) break;
            length += part.value.length;
            if (length > 16 * 1024 * 1024) throw Error("DYN byte budget");
            chunks.push(part.value);
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        finally { reader.releaseLock(); }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        downloaded.add(name);
        return bytes;
      }, abort.signal, async (name, raw, signal) => {
        if (downloaded.delete(name)) await store.write(sourceUrl(name), raw, signal);
      });
    } catch (error) {
      abort.signal.throwIfAborted();
      result = { track, status: "review", files: [], missing: [], errors: [{ name: "audit", error: String(error) }] };
    }
    const temporary = file + ".tmp";
    await writeFile(temporary, JSON.stringify({ ...result, auditedAt: new Date().toISOString(), auditSource: { mirror: resolve(mirror), root: store.root } }));
    await rename(temporary, file);
  }
  rows.push({ track, status: result.status, files: result.files.length, missing: result.missing.length, errors: result.errors.length, report: name, resumed });
  console.log(`${rows.length}/${selected.length} ${track} ${result.status} files=${result.files.length} missing=${result.missing.length} errors=${result.errors.length}${resumed ? " resumed" : ""}`);
}
const summary = {
  generatedAt: new Date().toISOString(), mirror: resolve(mirror), repair,
  scope: requested ? "single-track" : Number.isFinite(maxTracks) ? "limited" : "all-discovered-tracks",
  resumedReportsAreHistorical: rows.some(x => x.resumed),
  total: rows.length, ready: rows.filter(x => x.status === "ready").length,
  incomplete: rows.filter(x => x.status === "incomplete").length, review: rows.filter(x => x.status === "review").length, rows,
};
// A focused audit must not overwrite the most recent complete inventory.
const summaryName = requested
  ? `summary-track-${createHash("sha256").update(requested).digest("hex")}.json`
  : Number.isFinite(maxTracks) ? "summary-limited.json" : "summary.json";
const temp = join(directory, summaryName + ".tmp");
await writeFile(temp, JSON.stringify(summary, null, 2));
await rename(temp, join(directory, summaryName));
console.log(JSON.stringify({ total: summary.total, ready: summary.ready, incomplete: summary.incomplete, review: summary.review, directory }));
if (summary.incomplete || summary.review) process.exitCode = 1;
