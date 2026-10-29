import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../", import.meta.url);
const pack = JSON.parse(
  await readFile(new URL("validation/juno-assets.json", root), "utf8"),
);
if (pack.files.length !== 11) throw Error("Expected pinned 11-file pack");
await mkdir(new URL("../public/wasm/", import.meta.url), { recursive: true });
for (const name of ["spaceeyes_core.js", "spaceeyes_core_bg.wasm"])
  await copyFile(
    new URL(`core/pkg-web/${name}`, root),
    new URL(`../public/wasm/${name}`, import.meta.url),
  );
const allowed = new Set(pack.files.map((e) => e.file));
for (const entry of pack.files) {
  if (
    !/^[A-Za-z0-9_.-]+$/.test(entry.file) ||
    entry.file.includes("..") ||
    entry.source !==
      `https://eyes.nasa.gov/assets/static/models/sc_juno/${entry.file}`
  )
    throw Error("Invalid allowlist");
  const bytes = await readFile(
    new URL(`validation/.cache/juno-assets/${entry.file}`, root),
  );
  if (
    bytes.length !== entry.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== entry.sha256
  )
    throw Error("Resource identity mismatch");
  if (entry.file === "Juno.gltf") {
    const model = JSON.parse(bytes);
    for (const item of [...model.buffers, ...model.images])
      if (!allowed.has(item.uri)) throw Error("Unpinned dependency");
  }
  await mkdir(new URL("../public/assets/models/juno/", import.meta.url), {
    recursive: true,
  });
  await copyFile(
    new URL(`validation/.cache/juno-assets/${entry.file}`, root),
    new URL(`../public/assets/models/juno/${entry.file}`, import.meta.url),
  );
}
console.log("Prepared pinned WASM and Juno resources");
