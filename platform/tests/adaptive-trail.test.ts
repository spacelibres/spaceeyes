import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptiveTrailTimes } from "../adaptive-trail.ts";
test("adaptive history retains both temporal ends and spends points on curved portions", () => {
  const curve = (t: number) => [2 * Math.cos(t * t), 2 * Math.sin(t * t), 0];
  const result = adaptiveTrailTimes(0, 2, 2.1, 160, curve, Math.PI);
  assert.equal(result.times[0], 0);
  assert.equal(result.times.at(-1), 2.1);
  assert.ok(result.times.includes(2));
  assert.ok(result.times.length <= 160);
  assert.ok(
    result.times.filter((t) => t > 1).length >
      result.times.filter((t) => t < 1).length,
  );
});
test("long straight escape paths are not shortened by radial distance or point budgets", () => {
  const result = adaptiveTrailTimes(0, 946080000, 946080000, 160, (t) => [
    1e8 + t * 10,
    0,
    0,
  ]);
  assert.equal(result.times[0], 0);
  assert.equal(result.times.at(-1), 946080000);
  assert.equal(result.unresolved.size, 0);
  assert.ok(result.times.length <= 160);
});
test("unresolved source gaps remain broken without shrinking the time window", () => {
  const result = adaptiveTrailTimes(0, 5, 10, 32, (t) => {
    if (t > 4 && t < 4.5) throw Error("gap");
    return [100, t, 0];
  });
  assert.equal(result.times[0], 0);
  assert.equal(result.times.at(-1), 10);
  assert.ok(result.unresolved.size > 0);
});

test("budget exhaustion preserves a continuous covered multi-revolution trail", () => {
  const result = adaptiveTrailTimes(0, 12, 12.5, 256,
    t => [100 * Math.cos(t), 100 * Math.sin(t), 0], 2 * Math.PI);
  assert.equal(result.times[0], 0);
  assert.equal(result.times.at(-1), 12.5);
  assert.ok(result.times.includes(12));
  assert.equal(result.unresolved.size, 0);
  assert.ok(result.times.length <= 256);
});
