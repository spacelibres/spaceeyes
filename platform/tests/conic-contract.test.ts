import test from "node:test";
import assert from "node:assert/strict";
import { snapshotTrajectoryStyle } from "../trajectory-contract.ts";
const conic = () => ({
  semiLatusRectumKm: 10,
  radialUnit: [1, 0, 0],
  transverseUnit: [0, 1, 0],
  eccentricityRadial: 0.2,
  eccentricityTransverse: 0.3,
});
test("conic snapshot validates and isolates nested caller arrays", () => {
  const input = conic();
  const result = snapshotTrajectoryStyle(
    { kind: "orbit", conic: input } as any,
    2,
  ) as any;
  input.radialUnit[0] = 9;
  assert.equal(result.conic.radialUnit[0], 1);
  assert.ok(Object.isFrozen(result.conic));
  assert.ok(Object.isFrozen(result.conic.radialUnit));
  assert.ok(Object.isFrozen(result.conic.transverseUnit));
});
test("conic rejects invalid geometry, fields and incompatible paths", () => {
  for (const patch of [
    { semiLatusRectumKm: 0 },
    { semiLatusRectumKm: 1e16 },
    { semiLatusRectumKm: NaN },
    { radialUnit: [2, 0, 0] },
    { radialUnit: [1, NaN, 0] },
    { transverseUnit: [1, 0, 0] },
    { eccentricityRadial: 1 },
    { eccentricityTransverse: Infinity },
    { extra: true },
  ])
    assert.throws(() =>
      snapshotTrajectoryStyle(
        { kind: "orbit", conic: { ...conic(), ...patch } } as any,
        2,
      ),
    );
  assert.throws(() =>
    snapshotTrajectoryStyle(
      { conic: conic(), kind: "trail", trailDurationSeconds: 10 } as any,
      2,
    ),
  );
  assert.throws(() =>
    snapshotTrajectoryStyle(
      { kind: "orbit", conic: conic(), breakIndices: [1] } as any,
      2,
    ),
  );
  assert.throws(() =>
    snapshotTrajectoryStyle({ kind: "orbit", conic: conic() } as any, 1),
  );
  assert.throws(() => snapshotTrajectoryStyle({ conic: conic() } as any, 2));
});
