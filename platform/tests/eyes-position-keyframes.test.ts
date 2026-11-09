import test from "node:test";
import assert from "node:assert/strict";
test("reviewed Huygens literal keyframes replace DYN only inside their closed source coverages", async () => {
  const api = await import("../eyes-position-keyframes.ts");
  const a = api.eyesPositionKeyframe("sc_huygens", 158965616.707);
  assert.deepEqual(
    a?.position,
    [-74.84608000701567, -3832.0774028380238, -305.9513410781612],
  );
  assert.equal(
    api.eyesPositionKeyframe("sc_huygens", 158965616.706),
    undefined,
  );
  const b = api.eyesPositionKeyframe("sc_huygens", 158974766.184);
  assert.deepEqual(
    b?.position,
    [-251.2479743710496, -2548.813556954952, -266.5500089234507],
  );
  const t = (158965616.707 + 158965667.7750001) / 2;
  const mid = api.eyesPositionKeyframe("sc_huygens", t)!;
  const p0 = a!.position,
    p1 = [-168.19015737501377, -3541.733393771429, -291.12326824195395],
    p2 = [-376.8992769951708, -2686.9622048526126, -273.33138256355716];
  const scale =
    (158965667.7750001 - 158965616.707) / (158965894.184 - 158965667.7750001);
  const expected = p0.map(
    (v, i) =>
      0.5 * v +
      0.125 * (p1[i] - v) +
      0.5 * p1[i] -
      0.125 * (0.5 * (p1[i] - v) + 0.5 * scale * (p2[i] - p1[i])),
  );
  mid.position.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6));
});
