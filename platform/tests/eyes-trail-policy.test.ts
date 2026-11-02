import { test } from "node:test";
import assert from "node:assert/strict";
import { eyesTrailDuration, eyesTrailNextBoundary } from "../eyes-trail-policy.ts";
test("NASA entity trail lengths and phase overrides take precedence over local orbital estimates", () => {
  assert.equal(eyesTrailDuration("sc_iss", 846724000), 5573);
  assert.equal(eyesTrailDuration("sc_chandra", 846724000), 228505.5);
  assert.equal(eyesTrailDuration("sc_juno", 519652868.183), 63072000);
  assert.equal(eyesTrailDuration("sc_juno", 519652868.184), 5184000);
  assert.equal(eyesTrailDuration("sc_voyager_1", 846724000), 946080000);
  assert.equal(
    eyesTrailDuration("sc_mars_reconnaissance_orbiter", 846724000),
    6720,
  );
  assert.equal(eyesTrailDuration("moon", 846724000), undefined);
});

test("NASA landed phases disable history and future phase boundaries invalidate cache", () => {
  assert.equal(eyesTrailDuration("sc_insight", 846724000), 0);
  assert.equal(eyesTrailNextBoundary("sc_juno", 519652868), 519652868.184);
  assert.equal(eyesTrailNextBoundary("moon", 846724000), Infinity);
});
