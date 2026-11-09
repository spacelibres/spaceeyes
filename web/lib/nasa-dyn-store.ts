import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const prefix = "/assets/dynamic/dynamo/";
const maxBytes = 16 * 1024 * 1024;
type Paths = { primary: string; legacy?: string };

/** Original DYN bytes in an atomically published, checksummed local envelope. */
export class NasaDynStore {
  readonly root: string;
  readonly legacyRoot?: string;
  readonly offline: boolean;
  private invalid = new Set<string>();
  constructor(options: { root: string; legacyRoot?: string; offline?: boolean }) {
    this.root = resolve(options.root);
    this.legacyRoot = options.legacyRoot ? resolve(options.legacyRoot) : undefined;
    this.offline = options.offline ?? false;
  }
  private paths(url: string): Paths {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw Error("Invalid DYN source"); }
    if (parsed.origin !== "https://eyes.nasa.gov" || !parsed.pathname.startsWith(prefix) || parsed.search || parsed.hash)
      throw Error("Invalid DYN source");
    const parts = parsed.pathname.slice(prefix.length).split("/"), file = parts.pop() ?? "";
    if (!parts.length || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part) || part.includes("__")) ||
        !/^(?:def|[0-9]+(?:_[0-9]+)*)\.dyn$/.test(file)) throw Error("Invalid DYN source");
    const track = parts.join("__");
    return { primary: join(this.root, track, file + ".sedyn"), ...(this.legacyRoot ? { legacy: join(this.legacyRoot, track, file) } : {}) };
  }
  invalidate(url: string) { this.paths(url); this.invalid.add(url); }
  async read(url: string, signal: AbortSignal): Promise<Uint8Array | undefined> {
    const paths = this.paths(url);
    signal.throwIfAborted();
    if (this.invalid.has(url)) return undefined;
    try {
      const info = await stat(paths.primary);
      if (!info.isFile() || info.size < 3 || info.size > maxBytes + 2048) throw Error("DYN local identity mismatch");
      const data = await readFile(paths.primary, { signal });
      const separator = data.indexOf(10);
      if (separator < 1 || separator > 2048) throw Error("DYN local identity mismatch");
      let meta: { url?: string; bytes?: number; sha256?: string };
      try { meta = JSON.parse(data.subarray(0, separator).toString("utf8")); }
      catch { throw Error("DYN local identity mismatch"); }
      const bytes = data.subarray(separator + 1);
      if (meta.url !== url || meta.bytes !== bytes.length || !/^[a-f0-9]{64}$/.test(meta.sha256 ?? "") ||
          createHash("sha256").update(bytes).digest("hex") !== meta.sha256) throw Error("DYN local identity mismatch");
      signal.throwIfAborted();
      return new Uint8Array(bytes);
    } catch (error) {
      signal.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!paths.legacy) return undefined;
    try {
      const info = await stat(paths.legacy);
      if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw Error("DYN legacy byte budget");
      const bytes = await readFile(paths.legacy, { signal });
      signal.throwIfAborted();
      return new Uint8Array(bytes);
    } catch (error) {
      signal.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async write(url: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    const { primary } = this.paths(url);
    signal.throwIfAborted();
    if (!bytes.length || bytes.length > maxBytes) throw Error("DYN local byte budget");
    const metadata = JSON.stringify({ url, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), fetchedAt: new Date().toISOString() }) + "\n";
    const directory = resolve(primary, ".."), temp = join(directory, `.${basename(primary)}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temp, Buffer.concat([Buffer.from(metadata), bytes]), { flag: "wx", signal });
      signal.throwIfAborted();
      await rename(temp, primary);
      this.invalid.delete(url);
    } finally { await unlink(temp).catch(() => {}); }
  }
}

const project = basename(process.cwd()).toLowerCase() === "web" ? process.cwd() : join(process.cwd(), "web");
export const nasaDynStore = new NasaDynStore({
  root: process.env.SPACEEYES_NASA_DYN_ROOT ?? join(project, ".cache", "nasa-dyn"),
  legacyRoot: process.env.SPACEEYES_NASA_DYN_MIRROR,
  offline: process.env.SPACEEYES_NASA_DYN_OFFLINE === "1",
});
