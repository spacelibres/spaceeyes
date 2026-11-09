import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dependencies from "../validation/eyes-dependencies.json" with { type: "json" };
import stageDependencies from "../validation/eyes-model-stage-dependencies.json" with { type: "json" };
import parentDependencies from "../validation/eyes-parent-dependencies.json" with { type: "json" };
import models from "../validation/eyes-models.json" with { type: "json" };
import stageModels from "../validation/eyes-model-stages.json" with { type: "json" };
import parentModels from "../validation/eyes-parent-models.json" with { type: "json" };
import stars from "../validation/eyes-stars.json" with { type: "json" };
import planets from "../validation/solar-assets.json" with { type: "json" };
import { nasaStaticStore, type NasaStaticIdentity } from "../web/lib/nasa-static-store.ts";

const entries = new Map<string, NasaStaticIdentity>();
const planetCache = new Map<string, string>();
function add(url: string, pin: NasaStaticIdentity) {
  const parsed = new URL(url);
  if (parsed.origin !== "https://eyes.nasa.gov" || !parsed.pathname.startsWith("/assets/static/") || parsed.search || parsed.hash)
    throw Error("Invalid NASA source URL");
  if (!/^[a-f0-9]{64}$/.test(pin.sha256) || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || pin.bytes > 64 * 1024 * 1024)
    throw Error("Invalid NASA source identity");
  const previous = entries.get(url);
  if (previous && (previous.sha256 !== pin.sha256 || previous.bytes !== pin.bytes)) throw Error("Conflicting NASA source identity");
  entries.set(url, pin);
}
for (const registry of [dependencies.files, stageDependencies.files, parentDependencies.files])
  for (const [url, pin] of Object.entries(registry)) add(url, pin);
for (const registry of [models.rows, stageModels.rows, parentModels.rows])
  for (const row of registry) if (row.url && row.sha256 && row.bytes) add(row.url, { sha256: row.sha256, bytes: row.bytes });
for (const row of stars.files) add(row.url, row);

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
for (const [id, body] of Object.entries(planets.bodies)) for (const face of body.faces) {
  add(face.source, face);
  planetCache.set(face.source, join(root, "validation", ".cache", "solar-assets", id, face.path.split("/").at(-1)!));
}
for (const ring of planets.rings) {
  add(ring.source, ring);
  planetCache.set(ring.source, join(root, "validation", ".cache", "solar-assets", "rings", ring.path.split("/").at(-1)!));
}
const legacy = join(root, "web", ".cache", "eyes-assets");
const tasks = [...entries];
const results: { url: string; sha256: string; bytes: number; status: string; error?: string }[] = [];
let next = 0;
async function fetchBounded(url: string, entry: NasaStaticIdentity, signal: AbortSignal) {
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok || response.redirected || !response.body) throw Error(`NASA HTTP ${response.status}`);
  const chunks: Uint8Array[] = []; let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      length += part.value.length;
      if (length > entry.bytes) throw Error("NASA resource byte budget");
      chunks.push(part.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}
await Promise.all(Array.from({ length: 2 }, async () => {
  while (next < tasks.length) {
    const [url, pin] = tasks[next++];
    const signal = AbortSignal.timeout(30000);
    try {
      let current: Uint8Array | undefined;
      try { current = await nasaStaticStore.read(pin, signal); }
      catch (error) { if (!String(error).includes("identity mismatch")) throw error; }
      let status = "already-verified";
      if (!current) {
        const key = createHash("sha256").update("eyes-compatible-km-v1" + url).digest("hex");
        let bytes: Uint8Array | undefined;
        try {
          const candidate = await readFile(planetCache.get(url) ?? join(legacy, key + ".bin"), { signal });
          if (candidate.length === pin.bytes && createHash("sha256").update(candidate).digest("hex") === pin.sha256) bytes = candidate;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        status = bytes ? "imported" : "downloaded";
        bytes ??= await fetchBounded(url, pin, signal);
        await nasaStaticStore.write(pin, bytes, signal);
      }
      results.push({ url, ...pin, status });
    } catch (error) { results.push({ url, ...pin, status: "failed", error: String(error) }); }
    if (results.length % 100 === 0 || results.length === tasks.length)
      console.log(`NASA static ${results.length}/${tasks.length}; failed=${results.filter(x => x.status === "failed").length}`);
  }
}));
results.sort((a, b) => a.url.localeCompare(b.url));
const output = join(root, "web", ".cache", "nasa-static-report.json");
await mkdir(join(root, "web", ".cache"), { recursive: true });
await writeFile(output, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), root: nasaStaticStore.root, results }, null, 2));
const failures = results.filter(x => x.status === "failed");
console.log(JSON.stringify({ total: tasks.length, failed: failures.length, report: output }));
if (failures.length) process.exitCode = 1;
