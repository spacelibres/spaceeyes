import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEntityAlign,
  normalizeOrientation,
  isEntityAlign,
  entityAlignDependencies,
} from "../eyes-orientation.ts";
const identity = [1, 0, 0, 0] as const;
const refs = {
  position: () => [0, 1, 0] as const,
  velocity: () => [0, 0, 1] as const,
  orientation: () => identity,
};
test("alignment rotates primary and normalizes fixed source", () => {
  assert.deepEqual(normalizeOrientation([2, 0, 0, 0]), identity);
  const q = applyEntityAlign(
    identity,
    { type: "align", primary: { type: "point", target: "earth" } },
    [0, 0, 0],
    refs,
  );
  assert(Math.abs(q[0] - Math.SQRT1_2) < 1e-12);
  assert(Math.abs(q[3] - Math.SQRT1_2) < 1e-12);
  assert.deepEqual(
    applyEntityAlign(identity, { type: "align" }, [0, 0, 0], refs),
    identity,
  );
  assert(isEntityAlign({ type: "align", joint: "" }));
  assert(!isEntityAlign({ type: "align", joint: "panel" }));
  assert.throws(() => isEntityAlign({ type: "align", joint: 0 }));
  assert.throws(() => normalizeOrientation([0, 0, 0, 0]));
  assert.deepEqual(
    entityAlignDependencies({
      type: "align",
      primary: { type: "point", target: "earth" },
      secondary: { type: "align", target: "sun" },
    }),
    [
      { id: "earth", state: "position" },
      { id: "sun", state: "orientation" },
    ],
  );
});

import { rotateVector } from "../eyes-controllers.ts";
const near = (a: readonly number[], b: readonly number[]) =>
  a.forEach((x, i) => assert(Math.abs(x - b[i]) < 1e-10, `${a} != ${b}`));
const X = { expression: "Pioneer.Vector3.XAxis" },
  Y = { expression: "Pioneer.Vector3.YAxis" },
  Z = { expression: "Pioneer.Vector3.ZAxis" };
test("dual axes, velocity, target orientation and stable antiparallel are deterministic", () => {
  const q = applyEntityAlign(
    identity,
    {
      type: "align",
      primary: { type: "velocity", target: "craft", axis: X },
      secondary: { type: "align", target: "frame", axis: Y, targetAxis: Y },
    },
    [0, 0, 0],
    refs,
  );
  near(rotateVector([1, 0, 0], q), [0, 0, 1]);
  near(rotateVector([0, 1, 0], q), [0, 1, 0]);
  const opposite = { ...refs, position: () => [-1, 0, 0] as const };
  const controller = {
    type: "align" as const,
    primary: { type: "point" as const, target: "ref" },
  };
  const reverse = applyEntityAlign(identity, controller, [0, 0, 0], opposite);
  near(rotateVector([1, 0, 0], reverse), [-1, 0, 0]);
  assert.deepEqual(
    applyEntityAlign(identity, controller, [0, 0, 0], opposite),
    reverse,
  );
  const roll = [Math.SQRT1_2, Math.SQRT1_2, 0, 0] as const;
  near(
    applyEntityAlign(
      roll,
      { type: "align", primary: { type: "none" } },
      [0, 0, 0],
      refs,
    ),
    roll,
  );
});
test("all source axis forms resolve without expression execution", () => {
  for (const direction of ["X", "Y", "Z"])
    for (const negative of ["", "Neg"]) {
      const axis = {
        expression: `Pioneer.Vector3.${direction}Axis${negative}`,
      };
      assert.doesNotThrow(() =>
        applyEntityAlign(
          identity,
          { type: "align", primary: { type: "point", target: "ref", axis } },
          [0, 0, 0],
          refs,
        ),
      );
    }
  for (const values of [
    [-0.707, -0.707, 0],
    [{ expression: "Math.sqrt(.5)" }, { expression: "-Math.sqrt(.5)" }, 0],
  ])
    assert.doesNotThrow(() =>
      applyEntityAlign(
        identity,
        {
          type: "align",
          primary: {
            type: "velocity",
            target: "ref",
            axis: { constructor: "Vector3", values },
          },
        },
        [0, 0, 0],
        refs,
      ),
    );
  for (const axis of [
    { expression: "process.exit()" },
    { constructor: "Vector3", values: [0, 0, 0] },
    { constructor: "Vector3", values: [NaN, 1, 0] },
    { constructor: "Vector3", values: [{ expression: "Math.sqrt(2)" }, 1, 0] },
  ])
    assert.throws(() =>
      applyEntityAlign(
        identity,
        { type: "align", primary: { type: "point", target: "ref", axis } },
        [0, 0, 0],
        refs,
      ),
    );
});
test("degenerate references, collinear secondary and joints explicitly fail", () => {
  const c = {
    type: "align" as const,
    primary: { type: "point" as const, target: "ref" },
  };
  assert.throws(() => applyEntityAlign(identity, c, [0, 1, 0], refs), /zero/);
  assert.throws(
    () =>
      applyEntityAlign(
        identity,
        { ...c, secondary: { type: "point", target: "ref" } },
        [0, 0, 0],
        refs,
      ),
    /collinear/,
  );
  assert.throws(
    () =>
      applyEntityAlign(identity, c, [0, 0, 0], {
        ...refs,
        position() {
          throw Error("missing reference");
        },
      }),
    /missing reference/,
  );
  assert.throws(
    () => applyEntityAlign(identity, { ...c, joint: "panel" }, [0, 0, 0], refs),
    /joint/,
  );
  assert.throws(
    () =>
      applyEntityAlign(
        identity,
        { type: "align", primary: { type: "align", target: "frame" } },
        [0, 0, 0],
        { ...refs, orientation: () => [0, 0, 0, 0] },
      ),
    /zero quaternion/,
  );
});

import { eyesDefinitions } from "../eyes-catalog.ts";
import type { Vec3 } from "../eyes-orientation.ts";

test("real catalog entity align schema and axis compatibility (not attitude accuracy)", (t) => {
  // Synthetic references exercise recovered source shapes only; they are not ephemerides
  // and passing this test does not certify the physical attitude at any epoch.
  const validateAxis = (axis: unknown) => {
    if (axis === undefined) return;
    assert(axis && typeof axis === "object");
    const value = axis as {
      expression?: string;
      constructor?: unknown;
      values?: unknown;
    };
    if (value.expression !== undefined) {
      assert.match(value.expression, /^Pioneer\.Vector3\.[XYZ]Axis(?:Neg)?$/);
      return;
    }
    assert.equal(value.constructor, "Vector3");
    assert(Array.isArray(value.values));
    assert.equal(value.values.length, 3);
    for (const component of value.values) {
      if (typeof component === "number") assert(Number.isFinite(component));
      else {
        assert(component && typeof component === "object");
        assert.deepEqual(Object.keys(component), ["expression"]);
        assert(
          ["Math.sqrt(.5)", "-Math.sqrt(.5)"].includes(component.expression),
        );
      }
    }
  };
  const stable = (id: string, salt: number): Vec3 => {
    let hash = salt;
    for (const char of id)
      hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    return [
      1 + (hash % 97) / 97,
      0.3 + ((hash >>> 8) % 89) / 89,
      0.7 + ((hash >>> 16) % 83) / 83,
    ];
  };
  const synthetic = {
    position: (id: string) => stable(id, 7),
    velocity: (id: string) => stable(id, 101),
    orientation: (id: string) => normalizeOrientation([1, ...stable(id, 307)]),
  };
  let count = 0;
  const degenerate: string[] = [];
  for (const [id, definition] of Object.entries(eyesDefinitions))
    for (const [index, controller] of (
      definition.controllers ?? []
    ).entries()) {
      if (!isEntityAlign(controller)) continue;
      count++;
      for (const rule of [controller.primary, controller.secondary]) {
        if (rule === undefined) continue;
        assert(
          ["none", "point", "velocity", "align"].includes(rule.type),
          `${id} rule type`,
        );
        validateAxis(rule.axis);
        validateAxis(rule.targetAxis);
        if (rule.type !== "none") {
          assert.equal(typeof rule.target, "string");
          assert(
            Object.hasOwn(eyesDefinitions, rule.target!),
            `${id} target ${rule.target}`,
          );
        }
      }
      const expected = [controller.primary, controller.secondary]
        .filter((rule) => rule && rule.type !== "none")
        .map((rule) => ({
          id: rule!.target!,
          state:
            rule!.type === "point"
              ? "position"
              : rule!.type === "velocity"
                ? "velocity"
                : "orientation",
        }));
      assert.deepEqual(
        entityAlignDependencies(controller),
        expected.filter(
          (item, i) =>
            expected.findIndex(
              (other) => item.id === other.id && item.state === other.state,
            ) === i,
        ),
      );
      try {
        const q = applyEntityAlign(
          identity,
          controller,
          [0.1, -0.2, 0.3],
          synthetic,
        );
        assert(q.every(Number.isFinite));
        assert(Math.abs(Math.hypot(...q) - 1) < 1e-12);
      } catch (error) {
        assert.equal(
          String(error),
          "Error: Orientation zero vector or collinear axes",
          `${id} controller ${index}: unexpected schema/math failure`,
        );
        degenerate.push(`${id}:${index}`);
      }
    }
  assert.equal(count, 169);
  t.diagnostic(
    `source shape coverage: ${count} entity controllers; synthetic degeneracies: ${degenerate.join(", ") || "none"}`,
  );
});
