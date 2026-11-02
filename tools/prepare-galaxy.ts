import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GalaxyService } from "../web/lib/galaxy-server.ts";
import manifest from "../validation/galaxy-assets.json" with { type: "json" };
const sourceIndex = process.argv.indexOf("--source");
const source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined;
const start = performance.now();
const service = new GalaxyService({
  directory: fileURLToPath(new URL("../web/.cache/galaxy", import.meta.url)),
  ...(source
    ? {
        fetch: async () => new Response(new Uint8Array(await readFile(source))),
      }
    : {}),
});
const asset = await service.get("milkyway.webp", new AbortController().signal);
const folder = new URL("../validation/results/", import.meta.url);
await mkdir(folder, { recursive: true });
await writeFile(
  new URL("galaxy-conversion.json", folder),
  JSON.stringify(
    {
      ...manifest,
      derivedBytes: asset.bytes.length,
      derivedSha256: asset.sha256,
      elapsedMs: performance.now() - start,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Galaxy source verified; derived ${asset.bytes.length} bytes, SHA256 ${asset.sha256}`,
);
