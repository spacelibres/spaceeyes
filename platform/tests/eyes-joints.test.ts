import { test } from "node:test";
import assert from "node:assert/strict";
import { compileJointAims } from "../eyes-joints.ts";
import { eyesDefinitions } from "../eyes-catalog.ts";
test("all real source joint controllers compile in declaration order", () => {
  let count = 0;
  for (const definition of Object.values(eyesDefinitions)) {
    for (const c of definition.controllers ?? []) {
      if (c.type !== "align" || !c.joint) continue;
      const t = c.coverage
        ? (Number(c.coverage[0]) + Number(c.coverage[1])) / 2
        : 0;
      const aims = compileJointAims([c], t, [2, 3, 4], () => [2, 6, 8]);
      assert.equal(aims[0].joint, c.joint);
      assert.deepEqual(aims[0].targetDirectionIcrf, [0, 0.6, 0.8]);
      count++;
    }
  }
  assert.equal(count, 25);
});
test("joint compiler rejects duplicate names and unsupported expressions", () => {
  const c = {
    type: "align",
    joint: "panel",
    primary: { type: "none", axis: { expression: "Pioneer.Vector3.XAxis" } },
    secondary: {
      type: "point",
      axis: { expression: "Pioneer.Vector3.YAxis" },
      target: "sun",
    },
  };
  assert.throws(
    () => compileJointAims([c, c], 0, [0, 0, 0], () => [0, 1, 0]),
    /duplicate/,
  );
  assert.throws(
    () =>
      compileJointAims(
        [{ ...c, primary: { type: "none", axis: { expression: "evil()" } } }],
        0,
        [0, 0, 0],
        () => [0, 1, 0],
      ),
    /unknown/,
  );
});
