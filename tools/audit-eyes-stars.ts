import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import manifest from "../validation/eyes-stars.json" with { type: "json" };
import { decodeStarfield } from "../platform/starfield.ts";
import { PluginHost, type PluginContext } from "../platform/plugin-host.ts";
import { WasmCorePort } from "../platform/wasm-core-port.ts";

const argument = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const folder = argument("--samples");
if (!folder)
  throw Error(
    "Provide --samples DIRECTORY containing the seven original .bin files",
  );
const output = resolve(
  argument("--output") ?? "validation/results/eyes-stars-audit.json",
);
const { WasmCore } = createRequire(import.meta.url)(
  "../core/pkg/spaceeyes_core.js",
);
const core = new WasmCore();
const host = new PluginHost(new WasmCorePort(core));
let sdk!: PluginContext;
const rows: unknown[] = [];
try {
  host.register(
    {
      id: "validation.starfield",
      apiVersion: 1,
      capabilities: ["scene.visual"],
    },
    (ctx) => {
      sdk = ctx;
    },
  );
  await host.enable("validation.starfield", ["scene.visual"]);
  for (const file of manifest.files) {
    const bytes = await readFile(join(resolve(folder), file.file));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== file.bytes || hash !== file.sha256)
      throw Error(`Source identity mismatch: ${file.file}`);
    const spec = decodeStarfield(
      bytes,
      `NASA Eyes ${file.file} SHA256 ${hash}`,
    );
    sdk.visual.starfield(file.file, spec);
    rows.push({
      file: file.file,
      bytes: bytes.length,
      sha256: hash,
      count: spec.magnitudes.length,
      firstIcrfKm: spec.positionsKm.slice(0, 3),
      firstColor: spec.colorsRgb.slice(0, 3),
      magnitudeRange: [
        Math.min(...spec.magnitudes),
        Math.max(...spec.magnitudes),
      ],
    });
  }
  const points = core.starfield_count();
  if (points !== 43878) throw Error(`Unexpected WASM point count: ${points}`);
  await host.shutdown();
  if (core.starfield_count() !== 0) throw Error("WASM starfield session leak");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        totalLayers: 7,
        totalPoints: points,
        wasmAcceptedPoints: points,
        wasmPointsAfterShutdown: 0,
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Seven verified starfields: ${points} decoded and accepted by real WASM; shutdown count 0.`,
  );
} finally {
  await host.shutdown();
  core.free();
}
