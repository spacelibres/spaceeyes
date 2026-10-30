import { test } from "node:test";
import assert from "node:assert/strict";
import { TouchCamera } from "./touch-camera.ts";
test("touch orbit and pinch are bounded and mouse is ignored", () => {
  const t = new TouchCamera();
  assert.equal(t.begin(1, 0, 0, "mouse"), false);
  t.begin(1, 0, 0, "touch");
  assert.deepEqual(t.move(1, 1000, 1000), { orbit: [-0.5, -0.5] });
  t.begin(2, 1100, 1000, "touch");
  assert.ok((t.move(2, 1200, 1000)?.zoom ?? 0) < 0);
  t.clear();
  assert.equal(t.move(1, 2, 3), undefined);
});

test("single tap picks once; drag, pinch and cancellation never pick", () => {
  const t = new TouchCamera();
  t.begin(1, 10, 20, "touch");
  assert.deepEqual(t.end(1), [10, 20]);
  assert.equal(t.end(1), undefined);
  t.begin(1, 10, 20, "touch");
  t.move(1, 40, 20);
  t.move(1, 10, 20);
  assert.equal(t.end(1), undefined);
  t.begin(1, 10, 20, "touch");
  t.begin(2, 20, 20, "touch");
  assert.equal(t.end(2), undefined);
  assert.equal(t.end(1), undefined);
  t.begin(1, 10, 20, "touch");
  t.clear();
  assert.equal(t.end(1), undefined);
});

test("pinch ratio is resolution independent and coincident fingers stay finite", () => {
  const pinch = (scale: number) => {
    const t = new TouchCamera();
    t.begin(1, 0, 0, "touch");
    t.begin(2, 10 * scale, 0, "touch");
    return t.move(2, 20 * scale, 0)?.zoom;
  };
  assert.equal(pinch(1), pinch(20));
  assert.equal(pinch(1), -Math.log(2));
  const t = new TouchCamera();
  t.begin(1, 0, 0, "touch");
  t.begin(2, 0, 0, "touch");
  assert.equal(t.move(2, 10, 0)?.zoom, 0);
});
