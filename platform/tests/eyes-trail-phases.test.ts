import test from "node:test";
import assert from "node:assert/strict";
import * as policy from "../eyes-trail-policy.ts";
test("declarative phase exposes absolute landing start and immutable stable state", () => {
  assert.equal(typeof policy.eyesTrailPhase, "function");
  const p = policy.eyesTrailPhase("sc_mars_2020", 666953098.003);
  assert.equal(p.startTime, 666953098.003);
  assert.equal(p.relativeStartTime, false);
  assert.ok(Object.isFrozen(p));
  assert.equal(p, policy.eyesTrailPhase("sc_mars_2020", 666953098.003));
});
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getEyesDefinition } from "../eyes-catalog.ts";
const evidence = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/evidence/time-history-0.0.69/coverage-actions.json",
      import.meta.url,
    ),
    "utf8",
  ),
).actions.filter((a: any) => a.category === "trail-policy");
function setters(source: string) {
  const p: any = {};
  for (const m of source.matchAll(/trail\.set(\w+)\(([^)]+)\)/g)) {
    const k = m[1][0].toLowerCase() + m[1].slice(1),
      v = m[2];
    p[k] = v.startsWith("Pioneer.VisibleInterval.")
      ? v.split(".").at(-1)
      : v === "true"
        ? true
        : v === "false"
          ? false
          : v.startsWith('"')
            ? JSON.parse(v)
            : Number(v);
  }
  return p;
}
test("all 28 audited slots match literal source hashes and independent endpoint oracle in both seek directions", () => {
  assert.equal(evidence.length, 28);
  assert.equal(new Set(evidence.map((a: any) => a.entity)).size, 9);
  const captured = JSON.parse(
    readFileSync(new URL("../eyes-trail-phases.json", import.meta.url), "utf8"),
  );
  assert.equal(captured.slots.length, 28);
  for (const a of evidence) {
    assert.equal(
      createHash("sha256").update(a.matches[0].source).digest("hex"),
      a.sourceSha256,
    );
    const slot = captured.slots.find(
      (s: any) =>
        s.entity === a.entity &&
        s.controllerIndex === a.controllerIndex &&
        s.phase === a.phase,
    );
    assert.equal(slot.sourceSha256, a.sourceSha256);
    assert.deepEqual(slot.patch, setters(a.matches[0].source));
  }
  for (const id of new Set<string>(evidence.map((a: any) => a.entity))) {
    const actions = evidence
      .filter((a: any) => a.entity === id)
      .sort((a: any, b: any) => a.controllerIndex - b.controllerIndex);
    const times = policy
      .eyesTrailBoundaries(id)
      .flatMap((t) => [t - 0.001, t, t + 0.001]);
    const results = new Map<number, unknown>();
    for (const t of [...times, ...times.toReversed()]) {
      const trail = getEyesDefinition(id)?.trail;
      const expected: any = {
        startTime: policy.eyesTrailDuration(id, t),
        endTime: 0,
        relativeStartTime: true,
        relativeEndTime: true,
        startTimeMultiplier: 1,
        endTimeMultiplier: 1,
        relativeToEntity: trail?.relativeTo ?? "",
        relativeToEntityOrientation:
          trail?.relativeTo === undefined
            ? (trail?.relativeToOrientation ?? false)
            : false,
        visibleInterval: "DefaultVisibleFar",
      };
      for (const phase of ["exit", "enter"])
        for (const a of actions) {
          const inside =
            t >= Number(a.coverage[0]) && t <= Number(a.coverage[1]);
          if (a.phase === phase && inside === (phase === "enter"))
            Object.assign(expected, setters(a.matches[0].source));
        }
      const actual = policy.eyesTrailPhase(id, t);
      const { key, ...fields } = actual;
      assert.deepEqual(fields, expected, `${id}@${t}`);
      assert.ok(Object.isFrozen(actual));
      if (results.has(t)) assert.equal(actual, results.get(t));
      else results.set(t, actual);
    }
  }
  assert.throws(() => policy.eyesTrailPhase("sc_juno", NaN));
});
