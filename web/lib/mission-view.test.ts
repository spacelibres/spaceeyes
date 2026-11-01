import { test } from "node:test";
import assert from "node:assert/strict";
import { missionInitialLook } from "./mission-view.ts";

test("survey framing is independent of Earth or Sun attitude references", () => {
  for (const [id, parent] of [
    ["sc_chandra", "earth"],
    ["sc_hubble_space_telescope", "earth"],
    ["sc_jwst", "sun"],
  ])
    assert.deepEqual(missionInitialLook(id, parent), {
      kind: "sky",
      referenceId: parent,
    });
});
test("planetary orbit faces the current host and solar science faces Sun", () => {
  assert.deepEqual(
    missionInitialLook("sc_lunar_reconnaissance_orbiter", "moon"),
    { kind: "target", referenceId: "moon" },
  );
  assert.deepEqual(
    missionInitialLook("sc_mars_reconnaissance_orbiter", "mars"),
    { kind: "target", referenceId: "mars" },
  );
  assert.deepEqual(missionInitialLook("sc_sdo", "earth"), {
    kind: "target",
    referenceId: "sun",
  });
  assert.equal(missionInitialLook("sc_psyche", "sun"), undefined);
  assert.deepEqual(missionInitialLook("sc_psyche", "16_psyche"), {
    kind: "target",
    referenceId: "16_psyche",
  });
  assert.equal(missionInitialLook("moon", "earth"), undefined);
  assert.equal(missionInitialLook("sc_unknown", null), undefined);
});
