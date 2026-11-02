import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotStarfield } from "../starfield-contract.ts";
const valid = () => ({
  frame: "ICRF" as const,
  source: "test",
  positionsKm: [1, 0, 0],
  colorsRgb: [1, 0, 0],
  magnitudes: [1],
  absoluteMagnitudes: [2],
});
test("starfield snapshots clone and freeze every array", () => {
  const s = valid();
  const copy = snapshotStarfield(s);
  s.positionsKm[0] = 9;
  assert.equal(copy.positionsKm[0], 1);
  assert.ok(Object.isFrozen(copy));
  for (const key of [
    "positionsKm",
    "colorsRgb",
    "magnitudes",
    "absoluteMagnitudes",
  ] as const)
    assert.ok(Object.isFrozen(copy[key]));
});
test("starfield rejects malformed and extra fields", () => {
  for (const patch of [
    { frame: "OTHER" },
    { source: "" },
    { positionsKm: [0, 0, 0] },
    { colorsRgb: [0, 0, 0] },
    { colorsRgb: [2, 0, 0] },
    { magnitudes: [NaN] },
    { absoluteMagnitudes: [] },
    { extra: 1 },
  ])
    assert.throws(() => snapshotStarfield({ ...valid(), ...patch } as never));
});
