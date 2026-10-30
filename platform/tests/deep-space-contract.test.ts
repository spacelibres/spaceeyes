import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotEnvironment } from "../environment-contract.ts";
import { PluginHost, type PluginContext } from "../plugin-host.ts";
import { WasmCorePort } from "../wasm-core-port.ts";
test("seven levels snapshot all tiles and reject missing parents and coordinates", () => {
  const levels = Array.from({ length: 7 }, (_, level) => {
    const width = 128 * 2 ** level,
      height = 64 * 2 ** level;
    return {
      level,
      width,
      height,
      tiles: Array.from(
        { length: Math.ceil(width / 256) * Math.ceil(height / 256) },
        (_, i) => ({
          x: i % Math.ceil(width / 256),
          y: Math.floor(i / Math.ceil(width / 256)),
          assetId: `galaxy:l${level}:${i % Math.ceil(width / 256)}:${Math.floor(i / Math.ceil(width / 256))}`,
        }),
      ),
    };
  });
  const spec = {
    assetId: "galaxy:l0:0:0",
    frame: "ICRF" as const,
    intensity: 1,
    lod: {
      tileSize: 256 as const,
      border: 2 as const,
      levels,
      diffuseAssetId: "galaxy:diffuse",
      specularAssetId: "galaxy:specular",
      exposureEv: 0,
      blackLevel: 0,
      iblIntensity: 1,
    },
  };
  const snapshot = snapshotEnvironment(spec);
  assert.ok(Object.isFrozen(snapshot.lod?.levels[6].tiles[0]));
  levels[6].tiles[0].x = -1;
  assert.equal(snapshot.lod?.levels[6].tiles[0].x, 0);
  assert.throws(() => snapshotEnvironment(spec));
  assert.throws(() => snapshotEnvironment({ ...spec, assetId: "wrong" }));
});
test("FOV uses capability, range and correct WASM session order", async () => {
  let sdk!: PluginContext;
  const calls: unknown[] = [];
  const port = new WasmCorePort({
    open_session() {},
    release_session() {},
    camera_fov(...args: unknown[]) {
      calls.push(args);
    },
  } as any);
  const host = new PluginHost(port);
  host.register(
    { id: "test.fov", apiVersion: 1, capabilities: ["camera.control"] },
    (ctx) => {
      sdk = ctx;
    },
  );
  await host.enable("test.fov", ["camera.control"]);
  sdk.camera.fieldOfView(45);
  assert.equal((calls[0] as any[])[1], "test.fov");
  assert.equal((calls[0] as any[])[2], 45);
  for (const n of [NaN, Infinity, 9, 101])
    assert.throws(() => sdk.camera.fieldOfView(n));
  await host.disable("test.fov");
  assert.throws(() => sdk.camera.fieldOfView(45));
});
