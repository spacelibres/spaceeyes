import { test } from "node:test";
import assert from "node:assert/strict";
import { PluginHost, type PluginContext } from "../plugin-host.ts";
import { WasmCorePort, type WasmCoreBinding } from "../wasm-core-port.ts";
test("lighting validates capability, enum, live session and exact WASM wire", async () => {
  const calls: unknown[][] = [];
  let opened: unknown[] = [];
  let released = "";
  const binding = {
    open_session(...args: unknown[]) {
      opened = args;
    },
    release_session(id: string) {
      released = id;
    },
    camera_lighting(...args: unknown[]) {
      calls.push(args);
    },
  } as unknown as WasmCoreBinding;
  const host = new PluginHost(new WasmCorePort(binding));
  let sdk!: PluginContext;
  host.register(
    { id: "test.lighting", apiVersion: 1, capabilities: ["camera.control"] },
    (ctx) => {
      sdk = ctx;
    },
  );
  await assert.rejects(host.enable("test.lighting", []), /permission/);
  await host.enable("test.lighting", ["camera.control"]);
  for (const mode of ["natural", "shadow", "flood"] as const)
    sdk.camera.lighting(mode);
  assert.deepEqual(
    calls,
    ["natural", "shadow", "flood"].map((mode) => [
      opened[0],
      "test.lighting",
      mode,
    ]),
  );
  for (const mode of ["", "SHADOW", "day", null, undefined, 1, {}, ["natural"]])
    assert.throws(() => sdk.camera.lighting(mode as never), /invalid/);
  assert.equal(calls.length, 3);
  await host.disable("test.lighting");
  assert.equal(released, opened[0]);
  assert.throws(() => sdk.camera.lighting("natural"), /inactive/);
  host.register(
    { id: "test.denied", apiVersion: 1, capabilities: [] },
    (ctx) => {
      sdk = ctx;
    },
  );
  await host.enable("test.denied", []);
  assert.throws(() => sdk.camera.lighting("natural"), /permission/);
});
test("lighting reports unavailable and forwards core failure", async () => {
  for (const core of [
    undefined,
    {
      openSession() {},
      releaseSession() {},
      focus() {},
      cameraLighting() {
        throw Error("core rejected");
      },
    },
  ]) {
    const host = new PluginHost(core);
    let sdk!: PluginContext;
    host.register(
      { id: "test.light", apiVersion: 1, capabilities: ["camera.control"] },
      (ctx) => {
        sdk = ctx;
      },
    );
    await host.enable("test.light", ["camera.control"]);
    assert.throws(
      () => sdk.camera.lighting("flood"),
      core ? /core rejected/ : /unavailable/,
    );
    await host.shutdown();
  }
});
