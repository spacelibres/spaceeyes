import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateOrb, evaluateOrbVelocity, evaluateOri } from "../dyn-evaluator.ts";
import type { DecodedDyn } from "../dyn-decoder.ts";
const orb: DecodedDyn = {
  version: 2,
  paddingWidth: 1,
  kind: "inline",
  type: "orb",
  coverage: { start: 0, end: 10 },
  gravitationalParameter1: 1,
  gravitationalParameter2: 2,
  records: [0, 10].map((time) => ({
    time,
    semiMajorAxis: 10,
    eccentricity: 0,
    meanAngularMotion: 0,
    meanAnomalyAtEpoch: 0,
    orientation: [1, 0, 0, 0] as const,
  })),
};
test("orb endpoints, segment middle and body scaling remain deterministic", () => {
  for (const t of [0, 5, 10]) assert.deepEqual(evaluateOrb(orb, t), [10, 0, 0]);
  assert.deepEqual(evaluateOrb(orb, 5, 1), [10 * (2 / 3), 0, 0]);
  assert.throws(() => evaluateOrb(orb, -1));
  assert.throws(() => evaluateOrb(orb, 11));
});
test("orientation advances angular velocity with recovered inverse sign", () => {
  const d: DecodedDyn = {
    version: 2,
    paddingWidth: 1,
    kind: "inline",
    type: "ori",
    coverage: { start: 0, end: 10 },
    records: [0, 10].map((time) => ({
      time,
      orientation: [1, 0, 0, 0] as const,
      angularVelocity: [0, 0, 0] as const,
    })),
  };
  assert.deepEqual(evaluateOri(d, 5), [1, 0, 0, 0]);
  assert.throws(() => evaluateOri(d, 11));
});

test("Eyes velocity blends analytic endpoint velocities and rejects uncovered epochs", () => {
  const d: DecodedDyn = { ...orb, kind:"inline", type:"orb", records:[0,10].map(time=>({
    time,semiMajorAxis:10,eccentricity:0,meanAngularMotion:0.1,
    meanAnomalyAtEpoch:time*0.1,orientation:[1,0,0,0] as const,
  })) };
  for(const t of [0,5,10]) {
    const v=evaluateOrbVelocity(d,t);
    assert.ok(Math.abs(v[0]+Math.sin(t*0.1))<1e-12);
    assert.ok(Math.abs(v[1]-Math.cos(t*0.1))<1e-12);
    assert.equal(v[2],0);
  }
  assert.throws(()=>evaluateOrbVelocity(d,11),/coverage/);
});
