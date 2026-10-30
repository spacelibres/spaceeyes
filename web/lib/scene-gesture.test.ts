import { test } from "node:test";
import assert from "node:assert/strict";
import { SceneGesture, type ScenePointer } from "./scene-gesture.ts";
const point = (changes: Partial<ScenePointer> = {}): ScenePointer => ({
  pointerId: 1,
  clientX: 50,
  clientY: 60,
  button: 0,
  isPrimary: true,
  ...changes,
});
test("stationary primary release selects once, without conflating pointer identities", () => {
  const gesture = new SceneGesture();
  gesture.begin(point());
  assert.equal(gesture.end(point({ pointerId: 2 })), undefined);
  gesture.begin(point());
  assert.deepEqual(gesture.end(point({ clientX: 53 })), [53, 60]);
  assert.equal(gesture.end(point()), undefined);
});
test("dragging out and back never turns into a click", () => {
  const gesture = new SceneGesture();
  gesture.begin(point());
  gesture.move(point({ clientX: 80 }));
  gesture.move(point());
  assert.equal(gesture.end(point()), undefined);
  gesture.begin(point());
  assert.equal(gesture.end(point({ clientY: 70 })), undefined);
});
test("secondary buttons, cancellation, and multi-touch cannot select", () => {
  const gesture = new SceneGesture();
  gesture.begin(point({ button: 2 }));
  assert.equal(gesture.end(point()), undefined);
  gesture.begin(point());
  gesture.cancel();
  assert.equal(gesture.end(point()), undefined);
  gesture.begin(point());
  gesture.begin(point({ pointerId: 2, isPrimary: false }));
  assert.equal(gesture.end(point()), undefined);
});
