import { test } from "node:test";
import assert from "node:assert/strict";
import { PluginHost, type PluginContext } from "../plugin-host.ts";
const spec = {
  frame: "ICRF" as const,
  source: "test",
  positionsKm: [1, 0, 0],
  colorsRgb: [1, 1, 1],
  magnitudes: [1],
  absoluteMagnitudes: [1],
};
test("starfield needs only scene.visual, validates layer budget, clears and becomes inactive", async () => {
  let sdk!: PluginContext;
  const calls: any[] = [];
  const host = new PluginHost({
    openSession() {},
    releaseSession() {},
    focus() {},
    starfield: (r) => calls.push(r),
  });
  host.register(
    { id: "example.stars", apiVersion: 1, capabilities: ["scene.visual"] },
    (c) => {
      sdk = c;
    },
  );
  await host.enable("example.stars", ["scene.visual"]);
  for (let i = 0; i < 8; i++) sdk.visual.starfield("layer:" + i, spec);
  assert.throws(() => sdk.visual.starfield("ninth", spec), /budget/);
  sdk.visual.starfield("layer:0", null);
  sdk.visual.starfield("ninth", spec);
  assert.equal(calls[0].pluginId, "example.stars");
  assert.ok(Object.isFrozen(calls[0].spec.positionsKm));
  assert.throws(() => sdk.visual.starfield("bad/path", spec), /layer/);
  await host.shutdown();
  assert.throws(() => sdk.visual.starfield("ninth", null), /inactive/);
});
test("data.publish cannot authorize starfields", async () => {
  let sdk!: PluginContext;
  const host = new PluginHost();
  host.register(
    { id: "example.data", apiVersion: 1, capabilities: ["data.publish"] },
    (c) => {
      sdk = c;
    },
  );
  await host.enable("example.data", ["data.publish"]);
  assert.throws(() => sdk.visual.starfield("stars", spec), /permission/);
  await host.shutdown();
});

import { WasmCorePort } from "../wasm-core-port.ts";
import type { WasmCoreBinding } from "../wasm-core-port.ts";
test("WASM starfield encodes set and clears with absent optional payload", () => {
  const calls: unknown[][] = [];
  const binding = {
    set_starfield(...args: unknown[]) {
      calls.push(args);
    },
  } as unknown as WasmCoreBinding;
  const port = new WasmCorePort(binding);
  port.starfield({
    pluginId: "example.stars",
    sessionId: "session",
    layerId: "stars",
    spec,
  });
  port.starfield({
    pluginId: "example.stars",
    sessionId: "session",
    layerId: "stars",
    spec: null,
  });
  assert.deepEqual(calls[0], [
    "example.stars",
    "session",
    "stars",
    JSON.stringify(spec),
  ]);
  assert.deepEqual(calls[1], ["example.stars", "session", "stars", undefined]);
});
