import { createHash } from "node:crypto";
import { dynCatalog } from "./dyn-catalog.ts";
export async function fetchDyn(
  id: string,
  requestSignal: AbortSignal,
  fetcher: typeof fetch = fetch,
  deadlineSignal: AbortSignal = AbortSignal.timeout(15_000),
): Promise<Uint8Array> {
  const signal = AbortSignal.any([requestSignal, deadlineSignal]);
  if (!Object.hasOwn(dynCatalog, id)) throw Error("Unknown DYN resource");
  signal.throwIfAborted();
  const entry = dynCatalog[id as keyof typeof dynCatalog];
  const response = await fetcher(entry.source, {
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (signal.aborted) {
    await response.body?.cancel();
    signal.throwIfAborted();
  }
  if (!response.ok || response.redirected) {
    await response.body?.cancel();
    throw Error(`DYN HTTP ${response.status} or redirect refused`);
  }
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) !== entry.bytes)
  ) {
    await response.body?.cancel();
    throw Error("DYN length mismatch");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (reader)
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 16 * 1024 * 1024 || length > entry.bytes)
          throw Error("DYN size budget exceeded");
        chunks.push(chunk.value);
      }
  } catch (error) {
    await reader?.cancel().catch(() => {});
    throw error;
  } finally {
    reader?.releaseLock();
  }
  signal.throwIfAborted();
  if (length !== entry.bytes) throw Error("DYN length mismatch");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw Error("DYN SHA256 mismatch; pinned source changed");
  signal.throwIfAborted();
  return bytes;
}
