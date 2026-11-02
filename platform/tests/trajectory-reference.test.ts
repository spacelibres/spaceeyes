import test from "node:test";
import assert from "node:assert/strict";
import { snapshotTrajectoryStyle } from "../trajectory-contract.ts";
test("reference orientation and visibility style validates types and origin", () => {
  for (const style of [
    { referenceOrientation: 1 },
    { referenceOrientation: true },
    { visibleInterval: "Never" },
  ])
    assert.throws(() => snapshotTrajectoryStyle(style as any, 2));
  const style = snapshotTrajectoryStyle(
    {
      originId: "earth",
      referenceOrientation: true,
      visibleInterval: "AlwaysVisible",
    },
    2,
  );
  assert.equal(style.referenceOrientation, true);
  assert.equal(
    snapshotTrajectoryStyle({ referenceOrientation: false }, 2)
      .referenceOrientation,
    false,
  );
  assert.equal(snapshotTrajectoryStyle({}, 2).referenceOrientation, undefined);
});

test("authored draw range is finite, ordered and snapshotted", () => {
  const range: [number, number] = [0, 5];
  const s = snapshotTrajectoryStyle(
    {
      kind: "trail",
      trailDurationSeconds: 5,
      drawRangeTdbSeconds: range,
    } as any,
    2,
  ) as any;
  range[0] = 4;
  assert.deepEqual(s.drawRangeTdbSeconds, [0, 5]);
  assert.ok(Object.isFrozen(s.drawRangeTdbSeconds));
  for (const range of [[5, 0], [0, 0], [0, Infinity], [0], [0, 1, 2]])
    assert.throws(() =>
      snapshotTrajectoryStyle({ drawRangeTdbSeconds: range } as any, 2),
    );
});
test("relative draw edges require finite build epoch and explicit range", () => {
  for (const fields of [
    { drawRelativeStart: true },
    { drawRelativeEnd: true },
    { drawEpochTdbSeconds: Infinity },
    { drawRelativeStart: 1 },
    { drawRelativeEnd: "true" },
    { drawRelativeStart: true, drawEpochTdbSeconds: 0 },
  ])
    assert.throws(() =>
      snapshotTrajectoryStyle(
        { kind: "trail", trailDurationSeconds: 5, ...fields } as any,
        2,
      ),
    );
  const s = snapshotTrajectoryStyle(
    {
      kind: "trail",
      trailDurationSeconds: 5,
      drawRangeTdbSeconds: [0, 5],
      drawEpochTdbSeconds: 5,
      drawRelativeStart: true,
      drawRelativeEnd: false,
    } as any,
    2,
  ) as any;
  assert.equal(s.drawEpochTdbSeconds, 5);
  assert.equal(s.drawRelativeEnd, false);
  assert.ok(Object.isFrozen(s));
});
