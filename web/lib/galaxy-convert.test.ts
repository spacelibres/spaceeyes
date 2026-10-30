import { test } from "node:test";
import assert from "node:assert/strict";
import { toneMapGalaxy, decodeGalaxy } from "./galaxy-convert.ts";
test("linear galaxy tone mapping preserves black, monotonic brightness, color and opaque alpha", () => {
  const result = toneMapGalaxy(
    new Float32Array([0, 0, 0, 1, 0.1, 0.2, 0.4, 1]),
    2,
    1,
    1,
  );
  assert.deepEqual([...result.slice(0, 4)], [0, 0, 0, 255]);
  assert.ok(result[4] < result[5] && result[5] < result[6]);
  assert.equal(result[7], 255);
  assert.throws(
    () => toneMapGalaxy(new Float32Array([NaN, 0, 0, 1]), 1, 1, 1),
    /finite/,
  );
  assert.throws(() => toneMapGalaxy(new Float32Array(4), 1, 1, 0), /exposure/);
});
test("invalid EXR is rejected before any derived image can be published", () => {
  assert.throws(() => decodeGalaxy(new Uint8Array([0, 0, 0, 0])));
});
