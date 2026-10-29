import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import manifest from "../../validation/solar-assets.json";

type Face = {
  source: string;
  bytes: number;
  sha256: string;
  path: string;
};
const bodies = manifest.bodies as Record<string, { faces: Face[] }>;
export async function planetTexture(
  body: string,
  file: string,
  requestSignal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  if (!/^[a-z]+$/.test(body) || !/^[A-Za-z0-9_.-]+$/.test(file))
    throw new Error("Unknown texture");
  const entry =
    body === "rings"
      ? manifest.rings.find(
          (face) => face.path === `assets/planet-rings/${file}`,
        )
      : bodies[body]?.faces.find(
          (face) => face.path === `assets/planets/${body}/${file}`,
        );
  if (
    !entry ||
    !entry.source.startsWith(
      body === "rings"
        ? "https://eyes.nasa.gov/assets/static/sprites/"
        : `https://eyes.nasa.gov/assets/static/maps/${body}/`,
    ) ||
    !Number.isSafeInteger(entry.bytes) ||
    entry.bytes < 1 ||
    entry.bytes > 16 * 1024 * 1024
  )
    throw new Error("Unknown texture");
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(20000)]);
  const valid = (bytes: Uint8Array) =>
    bytes.length === entry.bytes &&
    createHash("sha256").update(bytes).digest("hex") === entry.sha256;
  // Both supported launch directories are explicit; content is always pinned by hash.
  for (const root of [process.cwd(), resolve(process.cwd(), "..")]) {
    try {
      signal.throwIfAborted();
      const bytes = await readFile(
        resolve(root, "validation/.cache/solar-assets", body, file),
      );
      if (valid(bytes)) return bytes;
      throw new Error("Cached texture identity mismatch");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const response = await fetcher(entry.source, {
    signal,
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok || response.redirected) {
    await response.body?.cancel();
    throw new Error(`Texture HTTP ${response.status}`);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (reader)
      while (true) {
        signal.throwIfAborted();
        const result = await reader.read();
        signal.throwIfAborted();
        if (result.done) break;
        length += result.value.length;
        if (length > entry.bytes) throw new Error("Texture size budget");
        chunks.push(result.value);
      }
  } catch (error) {
    await reader?.cancel().catch(() => {});
    throw error;
  } finally {
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (!valid(bytes)) throw new Error("Texture identity mismatch");
  signal.throwIfAborted();
  return bytes;
}
