import test from "node:test";
import assert from "node:assert/strict";
import { icrfCubeFaces } from "./galaxy-hdr.ts";
test("cube X/Z remap preserves all cardinal faces and pixel orientation", () => {
  const n = 3,
    faces = Array.from({ length: 6 }, (_, f) =>
      Float32Array.from(
        { length: n * n * 4 },
        (_, i) => f * 100 + Math.floor(i / 4),
      ),
    );
  const out = icrfCubeFaces(faces, n);
  assert.deepEqual(
    out.map((p) => p[16]),
    [404, 504, 204, 304, 4, 104],
  );
  assert.equal(out[0][0], 402);
  assert.equal(out[2][4], 203);
  assert.equal(out[3][4], 305);
});
