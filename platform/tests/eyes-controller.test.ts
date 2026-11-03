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
import { staticPosition, staticCoverage } from "../eyes-controllers.ts";
import { eyesDefinitions } from "../eyes-catalog.ts";

test("Pathfinder shared fixed endpoint uses the last covered position and its coverage", () => {
  const t=-78692826;
  assert.notDeepEqual(staticPosition("sc_mars_pathfinder",t-0.001,[1,0,0,0]),[0,0,0]);
  for(const at of [t+0.001,t,t-0.001,t]) {
    const expected=at<t?[1733.8045354970886,-3114.1893353832183,-682.0562165671394]:[0,0,0];
    assert.deepEqual(staticPosition("sc_mars_pathfinder",at,[1,0,0,0]),expected);
    assert.deepEqual(staticCoverage("sc_mars_pathfinder",at),at<t?[-78692880,t]:[t,-71372156]);
  }
});

test("static position and coverage preserve declaration order across fixed and orbital controllers", () => {
  const original=eyesDefinitions.dactyl.controllers;
  const orbital={type:"orbitalElements",epoch:0,semiMajorAxis:90,eccentricity:0,meanAngularMotion:0.01,meanAnomalyAtEpoch:0,orientation:{values:[1,0,0,0]},coverage:[0,10]};
  const fixed={type:"fixed",position:{constructor:"Vector3",values:[1,2,3]},coverage:[2,8]};
  try {
    eyesDefinitions.dactyl.controllers=[fixed,orbital];
    assert.deepEqual(staticPosition("dactyl",5),propagateState({time:0,semiMajorAxis:90,eccentricity:0,meanAngularMotion:0.01,meanAnomalyAtEpoch:0,orientation:[1,0,0,0]},5).position);
    assert.deepEqual(staticCoverage("dactyl",5),[0,10]);
    eyesDefinitions.dactyl.controllers=[orbital,fixed];
    assert.deepEqual(staticPosition("dactyl",5),[1,2,3]);
    assert.deepEqual(staticCoverage("dactyl",5),[2,8]);
    assert.equal(staticPosition("dactyl",11),undefined);
    assert.equal(staticCoverage("dactyl",11),undefined);
  } finally { eyesDefinitions.dactyl.controllers=original; }
});
test("orientation-only rotation does not rotate a fixed position or require a position reference", () => {
  const original=eyesDefinitions.dactyl.controllers;
  try {
    eyesDefinitions.dactyl.controllers=[
      {type:"fixed",position:{constructor:"Vector3",values:[1,2,3]}},
      {type:"rotateByEntityOrientation",rotatingPosition:false,rotatingOrientation:true},
    ];
    assert.deepEqual(staticPosition("dactyl",5),[1,2,3]);
    assert.deepEqual(staticPosition("dactyl",5,[0,0,0,1]),[1,2,3]);
    eyesDefinitions.dactyl.controllers[1].rotatingPosition=true;
    assert.throws(()=>staticPosition("dactyl",5),/orientation/);
    assert.deepEqual(staticPosition("dactyl",5,[0,0,0,1]),[-1,-2,3]);
  } finally {eyesDefinitions.dactyl.controllers=original;}
});
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
