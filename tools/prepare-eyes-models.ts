import { eyesCatalog } from "../platform/eyes-catalog.ts";
import { EyesAssetService } from "../web/lib/eyes-assets.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Server-side warmup/audit only. No model bytes are added to the executable or initial browser load.
const unique = new Map<string, string>();
for (const body of eyesCatalog)
  if (body.model?.url && !unique.has(body.model.url))
    unique.set(body.model.url, body.id);
const tasks = [...unique].map(([url, id]) => ({ url, id }));
const service = new EyesAssetService();
const results: {
  id: string;
  url: string;
  ok: boolean;
  bytes?: number;
  sha256?: string;
  error?: string;
}[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: 2 }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try {
        const asset = await service.get(task.id, "model.glb");
        results.push({
          ...task,
          ok: true,
          bytes: asset.bytes.length,
          sha256: asset.sha256,
        });
      } catch (error) {
        results.push({ ...task, ok: false, error: String(error) });
      }
      console.log(
        `${results.length}/${tasks.length} ${task.id} ${results.at(-1)!.ok ? "ready" : "failed"}`,
      );
    }
  }),
);
const output = new URL(
  "../validation/results/eyes-model-conversion.json",
  import.meta.url,
);
await mkdir(fileURLToPath(new URL(".", output)), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      version: 1,
      total: tasks.length,
      ready: results.filter((r) => r.ok).length,
      results,
    },
    null,
    2,
  ),
);
if (results.some((r) => !r.ok)) process.exitCode = 1;
