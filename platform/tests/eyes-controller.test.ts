import test from "node:test";
import assert from "node:assert/strict";
import { propagateState } from "../dyn-evaluator.ts";
test("hyperbolic source elements stay nonperiodic and finite", () => {
  const r = {
    time: 0,
    semiMajorAxis: 100,
    eccentricity: 2,
    meanAngularMotion: 0.01,
    meanAnomalyAtEpoch: 0,
    orientation: [1, 0, 0, 0] as const,
  };
  assert.deepEqual(propagateState(r, 0).position, [100, 0, 0]);
  assert.ok(propagateState(r, 100).position[1] > 0);
});
import { staticPosition } from "../eyes-controllers.ts";
import { decodeDyn } from "../dyn-decoder.ts";
import { evaluateOrb } from "../dyn-evaluator.ts";
test("declared orbital elements and landing coordinates evaluate without source execution", () => {
  const p = staticPosition("dactyl", 0)!;
  assert.ok(Math.abs(Math.hypot(...p) - 90) < 1e-8);
  const land = staticPosition(
    "sc_mars_2020_landing_site",
    700000000,
    [1, 0, 0, 0],
  )!;
  assert.ok(Math.hypot(...land) > 3300 && Math.hypot(...land) < 3400);
  assert.throws(
    () => staticPosition("sc_mars_2020_landing_site", 700000000),
    /orientation/,
  );
});
for (const type of ["pos", "lin"])
  test(type + " source records interpolate only in coverage", () => {
    const stride = type === "pos" ? 56 : 32,
      b = new Uint8Array(12 + 2 * stride),
      v = new DataView(b.buffer);
    v.setInt16(0, 2, true);
    b.set(
      [...type].map((c) => c.charCodeAt(0)),
      2,
    );
    b[6] = 3;
    b[7] = 1;
    v.setInt32(8, 2, true);
    for (let i = 0; i < 2; i++) {
      let at = 12 + i * stride;
      v.setFloat64(at, i * 10, true);
      v.setFloat64(at + 8, i * 10, true);
      if (type === "pos") v.setFloat64(at + 32, 1, true);
    }
    const d = decodeDyn(b);
    assert.deepEqual(evaluateOrb(d, 5), [5, 0, 0]);
    assert.throws(() => evaluateOrb(d, 11), /coverage/);
  });

test("Mars landing coordinates follow declared planetocentric latitude", () => {
  const p = staticPosition(
    "sc_mars_2020_landing_site",
    700000000,
    [1, 0, 0, 0],
  )!;
  assert.ok(
    Math.abs(Math.atan2(p[2], Math.hypot(p[0], p[1])) - 0.321919527884589) <
      1e-12,
  );
});
