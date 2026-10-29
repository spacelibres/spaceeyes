import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEpoch } from "./controls.ts";
test("jump validates coverage and rejects empty/UTC/nonfinite input", () => {
  assert.equal(parseEpoch("42"), 42);
  for (const x of ["", "2026-10-29", "Infinity", "-1", "1000000001"])
    assert.throws(() => parseEpoch(x));
});
import { boundedEpoch, onceAsync } from "./controls.ts";
test("reverse and forward limits clamp and request pause", () => {
  assert.deepEqual(boundedEpoch(-0.1), { epoch: 0, boundary: true });
  assert.deepEqual(boundedEpoch(1e9 + 1), { epoch: 1e9, boundary: true });
  assert.deepEqual(boundedEpoch(5), { epoch: 5, boundary: false });
});
test("racing cleanup invokes release once and shares completion", async () => {
  let calls = 0;
  const cleanup = onceAsync(async () => {
    calls++;
  });
  const first = cleanup();
  assert.equal(first, cleanup());
  await first;
  await cleanup();
  assert.equal(calls, 1);
});
