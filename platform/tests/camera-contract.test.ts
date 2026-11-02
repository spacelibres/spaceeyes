import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotObservation, cameraInput } from "../camera-contract.ts";
import { WasmCorePort, type WasmCoreBinding } from "../wasm-core-port.ts";
import { PluginHost, type PluginContext } from "../plugin-host.ts";
test("observation validates mode-specific fields and copies members", () => {
  const members = ["earth", "moon"];
  const value = snapshotObservation("earth", "system", { members });
  members.pop();
  assert.deepEqual(value.members, ["earth", "moon"]);
  assert(Object.isFrozen(value));
  assert(Object.isFrozen(value.members));
  for (const [mode, options] of [
    ["nearby", { members: [] }],
    ["system", { members: ["moon"] }],
    ["system", { members: ["earth", "earth"] }],
    ["follow", { followId: "earth" }],
    ["follow", { followId: "moon", members: [] }],
    ["nearby", { extra: 1 }],
  ] as const)
    assert.throws(() => snapshotObservation("earth", mode, options as never));
  for (const n of [NaN, Infinity, -Infinity, 0.51, -0.51])
    assert.throws(() => cameraInput(n, 0.5));
  assert.equal(cameraInput(-0.5, 0.5), -0.5);
  assert.equal(cameraInput(1, 1), 1);
});
test("camera intents enforce permission and disposal, preserve actual WASM wire fields", async () => {
  const calls: unknown[][] = [];
  const binding = {
    open_session() {},
    release_session() {},
    camera_observe(...args: unknown[]) {
      calls.push(args);
    },
    camera_orbit(...args: unknown[]) {
      calls.push(args);
    },
    camera_zoom(...args: unknown[]) {
      calls.push(args);
    },
  } as unknown as WasmCoreBinding;
  const host = new PluginHost(new WasmCorePort(binding));
  let sdk!: PluginContext;
  host.register(
    { id: "test.camera", apiVersion: 1, capabilities: ["camera.control"] },
    (ctx) => {
      sdk = ctx;
    },
  );
  await assert.rejects(host.enable("test.camera", []), /permission/);
  await host.enable("test.camera", ["camera.control"]);
  sdk.camera.observe("earth", "system", { members: ["earth", "moon"] });
  assert.deepEqual(JSON.parse(calls[0][2] as string), {
    targetId: "earth",
    mode: "system",
    members: ["earth", "moon"],
  });
  sdk.camera.observe("earth", "follow", { followId: "moon" });
  assert.deepEqual(JSON.parse(calls[1][2] as string), {
    targetId: "earth",
    mode: "follow",
    followId: "moon",
  });
  sdk.camera.orbit(-0.5, 0.5);
  sdk.camera.zoom(-1);
  assert.deepEqual(calls[2].slice(2), [-0.5, 0.5]);
  assert.deepEqual(calls[3].slice(2), [-1]);
  assert.throws(() => sdk.camera.zoom(1.01));
  assert.throws(() => sdk.camera.orbit(0, NaN));
  sdk.camera.observe("lro","nearby",{initialLook:{kind:"target",referenceId:"moon"}});
  assert.deepEqual(JSON.parse(calls[4][2] as string),{targetId:"lro",mode:"nearby",initialLook:{kind:"target",referenceId:"moon"}});
  await host.disable("test.camera");
  assert.throws(() => sdk.camera.zoom(0), /inactive/);
  assert.throws(() => sdk.camera.observe("earth", "nearby"), /inactive/);
  host.register(
    { id: "test.denied", apiVersion: 1, capabilities: [] },
    (ctx) => {
      sdk = ctx;
    },
  );
  await host.enable("test.denied", []);
  assert.throws(() => sdk.camera.orbit(0, 0), /permission/);
});

test("observation system context is independent of displayed geometry and strictly bounded", () => {
  const snapshot = snapshotObservation("moon", "nearby", {systemId: "earth"} as never);
  assert.equal((snapshot as {systemId?: string}).systemId, "earth");
  assert.ok(Object.isFrozen(snapshot));
});

test("invalid observation system identifiers are rejected", () => {
  for (const systemId of [undefined, null, "", "bad id", "x".repeat(257), 1]) {
    assert.throws(() => snapshotObservation("moon", "nearby", { systemId } as never));
  }
});

test("initial task composition is a frozen nearby-only intent",()=>{
 const look={kind:"target" as const,referenceId:"moon"};
 const snapshot=snapshotObservation("lro","nearby",{initialLook:look});
 look.referenceId="mars";
 assert.deepEqual(snapshot.initialLook,{kind:"target",referenceId:"moon"});
 assert.ok(Object.isFrozen(snapshot.initialLook));
 for(const initialLook of [undefined,null,[],{kind:"other",referenceId:"moon"},{kind:"target",referenceId:"lro"},{kind:"sky",referenceId:"bad id"},{kind:"sky",referenceId:"moon",extra:1}])
  assert.throws(()=>snapshotObservation("lro","nearby",{initialLook} as never));
 assert.throws(()=>snapshotObservation("lro","follow",{followId:"moon",initialLook:{kind:"target",referenceId:"moon"}}));
 assert.throws(()=>snapshotObservation("lro","system",{members:["lro"],initialLook:{kind:"sky",referenceId:"moon"}}));
});
