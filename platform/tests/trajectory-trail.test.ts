import { test } from "node:test";
import assert from "node:assert/strict";
import { PluginHost, type PluginContext } from "../plugin-host.ts";

test("trail style validates finite windows and discontinuities before forwarding an isolated snapshot", async () => {
  let sdk!: PluginContext;
  let received: any;
  let calls = 0;
  const host = new PluginHost({
    openSession() {},
    releaseSession() {},
    focus() {},
    trajectory(r) {
      received = r;
      calls++;
    },
  });
  host.register(
    { id: "example.trail", apiVersion: 1, capabilities: ["scene.visual"] },
    (ctx) => {
      sdk = ctx;
    },
  );
  await host.enable("example.trail", ["scene.visual"]);
  const points: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
  ];
  const breaks = [2];
  sdk.visual.trajectory("moon", points, [0, 1, 2], {
    kind: "trail",
    trailDurationSeconds: 60,
    breakIndices: breaks,
    originId: "earth",
  });
  breaks[0] = 1;
  points[0][0] = 10;
  assert.equal(received.kind, "trail");
  assert.equal(received.trailDurationSeconds, 60);
  assert.deepEqual(received.breakIndices, [2]);
  assert.equal(received.points[0][0], 0);
  const before = calls;
  for (const style of [
    { kind: "bad" },
    { kind: "trail" },
    { kind: "orbit", trailDurationSeconds: 60 },
    { kind: "trail", trailDurationSeconds: NaN },
    { kind: "trail", trailDurationSeconds: 0 },
    { kind: "trail", trailDurationSeconds: 315576001 },
    { kind: "trail", trailDurationSeconds: 60, breakIndices: [0] },
    { kind: "trail", trailDurationSeconds: 60, breakIndices: [3] },
    { kind: "trail", trailDurationSeconds: 60, breakIndices: [2, 1] },
  ]) {
    assert.throws(
      () =>
        sdk.visual.trajectory(
          "moon",
          [
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
          ],
          [0, 1, 2],
          style as any,
        ),
      /trajectory/,
    );
  }
  assert.equal(calls, before);
  await host.shutdown();
  assert.throws(() => sdk.visual.trajectory("moon", [], []), /inactive/);
});
