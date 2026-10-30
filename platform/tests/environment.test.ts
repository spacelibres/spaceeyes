import { test } from "node:test";
import assert from "node:assert/strict";
import { PluginHost, type PluginContext } from "../plugin-host.ts";
const spec = {
  assetId: "environment:milkyway:4k",
  frame: "ICRF" as const,
  intensity: 1,
};
import { snapshotVisual } from "../visual-contract.ts";
test("stellar visual is immutable and bounded without changing object radius", () => {
  const stellar = { coronaIntensity: 1, flowSpeed: 0.15 };
  const visual = snapshotVisual({ kind: "sphere", stellar });
  assert.ok(visual.kind === "sphere" && Object.isFrozen(visual.stellar));
  stellar.flowSpeed = 2;
  assert.ok(visual.kind === "sphere" && visual.stellar?.flowSpeed === 0.15);
  for (const bad of [
    { coronaIntensity: 5, flowSpeed: 1 },
    { coronaIntensity: 1, flowSpeed: NaN },
  ])
    assert.throws(
      () => snapshotVisual({ kind: "sphere", stellar: bad }),
      /stellar/,
    );
});
test("environment requires visual permission, snapshots approved descriptors and revokes on disposal", async () => {
  const calls: unknown[] = [];
  let sdk!: PluginContext;
  const host = new PluginHost({
    openSession() {},
    focus() {},
    releaseSession() {},
    environment: (r) => calls.push(r),
  });
  host.register(
    { id: "test.galaxy", apiVersion: 1, capabilities: ["scene.visual"] },
    (ctx) => {
      sdk = ctx;
    },
  );
  await host.enable("test.galaxy", ["scene.visual"]);
  sdk.visual.environment(spec);
  assert.ok(Object.isFrozen((calls[0] as any).spec));
  assert.throws(
    () => sdk.visual.environment({ ...spec, intensity: Infinity }),
    /environment/,
  );
  assert.throws(
    () =>
      sdk.visual.environment({ ...spec, assetId: "https://arbitrary.test" }),
    /environment/,
  );
  sdk.visual.environment(null);
  await host.shutdown();
  assert.throws(() => sdk.visual.environment(spec), /inactive/);
});
