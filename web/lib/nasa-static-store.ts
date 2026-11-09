import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export type NasaStaticIdentity = Readonly<{ sha256: string; bytes: number }>;

/** Durable content-addressed source bytes; never managed by the conversion-cache pruner. */
export class NasaStaticStore {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private path(entry: NasaStaticIdentity) {
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 64 * 1024 * 1024)
      throw Error("Invalid NASA resource identity");
    return join(this.root, entry.sha256 + ".bin");
  }
  private verify(entry: NasaStaticIdentity, bytes: Uint8Array) {
    if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
      throw Error("NASA resource identity mismatch");
  }
  async read(entry: NasaStaticIdentity, signal: AbortSignal): Promise<Uint8Array | undefined> {
    const file = this.path(entry);
    signal.throwIfAborted();
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size !== entry.bytes) throw Error("NASA resource identity mismatch");
      const bytes = await readFile(file, { signal });
      this.verify(entry, bytes);
      signal.throwIfAborted();
      return new Uint8Array(bytes);
    } catch (error) {
      signal.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async write(entry: NasaStaticIdentity, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    const file = this.path(entry);
    signal.throwIfAborted();
    this.verify(entry, bytes);
    await mkdir(this.root, { recursive: true });
    const temporary = join(this.root, `.${basename(file)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: "wx", signal });
      signal.throwIfAborted();
      await rename(temporary, file);
    } finally { await unlink(temporary).catch(() => {}); }
  }
}

const project = basename(process.cwd()).toLowerCase() === "web" ? process.cwd() : join(process.cwd(), "web");
export const nasaStaticStore = new NasaStaticStore(process.env.SPACEEYES_NASA_STATIC_ROOT ?? join(project, ".cache", "nasa-static"));
