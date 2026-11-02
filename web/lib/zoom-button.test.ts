import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ZoomButtonGesture,
  zoomButtonDelta,
  type Schedule,
} from "./zoom-button.ts";
function harness() {
  let now = 0,
    serial = 0;
  const jobs = new Map<number, { at: number; run: () => void }>();
  const output: number[] = [];
  const schedule: Schedule = (run, ms) => {
    const id = ++serial;
    jobs.set(id, { at: now + ms, run });
    return () => {
      jobs.delete(id);
    };
  };
  const gesture = new ZoomButtonGesture(
    (delta) => output.push(delta),
    schedule,
  );
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      jobs.delete(next[0]);
      next[1].run();
    }
    now = end;
  };
  return { gesture, output, advance, jobs };
}
test("short press commits once on release; synthetic pointer click cannot double step", () => {
  const h = harness();
  h.gesture.begin(1, -1);
  h.advance(100);
  assert.deepEqual(h.output, []);
  h.gesture.end(2);
  assert.deepEqual(h.output, []);
  h.gesture.end(1);
  h.gesture.click(1, -1);
  assert.deepEqual(h.output, [-0.3 * Math.LN2]);
  assert.equal(h.jobs.size, 0);
});
test("NASA hold threshold and repeat interval preserve small continuous steps", () => {
  const h = harness();
  h.gesture.begin(1, 1);
  h.advance(199);
  assert.equal(h.output.length, 0);
  h.advance(1);
  assert.equal(h.output.length, 0);
  h.advance(30);
  assert.deepEqual(h.output, [0.1 * Math.LN2]);
  h.advance(90);
  assert.equal(h.output.length, 4);
  h.gesture.end(1);
  h.advance(1000);
  assert.equal(h.output.length, 4);
  assert.equal(h.jobs.size, 0);
  assert.ok(Math.abs(Math.exp(zoomButtonDelta(1, false)) - 2 ** 0.3) < 1e-14);
  assert.ok(Math.abs(Math.exp(zoomButtonDelta(-1, true)) - 2 ** -0.1) < 1e-14);
});
test("release in NASA threshold gap is not turned into an extra click", () => {
  const h = harness();
  h.gesture.begin(1, -1);
  h.advance(210);
  h.gesture.end(1);
  h.advance(1000);
  assert.deepEqual(h.output, []);
});
test("cancel and opposite press do not retain timers or replay old motion", () => {
  for (const elapsed of [100, 200, 260]) {
    const h = harness();
    h.gesture.begin(1, 1);
    h.advance(elapsed);
    const count = h.output.length;
    h.gesture.cancel();
    h.advance(1000);
    h.gesture.end(1);
    assert.equal(h.output.length, count);
    assert.equal(h.jobs.size, 0);
  }
  const h = harness();
  h.gesture.begin(1, 1);
  h.advance(240);
  h.gesture.begin(2, -1);
  h.advance(100);
  h.gesture.end(1);
  h.gesture.end(2);
  assert.deepEqual(h.output, [0.1 * Math.LN2, -0.3 * Math.LN2]);
});
test("keyboard click works without pointer state and ignores invalid pointer identity", () => {
  const h = harness();
  h.gesture.click(0, -1);
  h.gesture.begin(NaN, 1);
  h.advance(1000);
  assert.deepEqual(h.output, [-0.3 * Math.LN2]);
  assert.equal(h.jobs.size, 0);
});

test("cancellation or replacement from inside an emitted hold cannot resurrect the old timer", () => {
  for (const replace of [false, true]) {
    let callback: (() => void) | undefined;
    const jobs = new Map<number, () => void>();
    let serial = 0;
    const schedule: Schedule = (run) => {
      const id = ++serial;
      jobs.set(id, run);
      return () => {
        jobs.delete(id);
      };
    };
    const output: number[] = [];
    const gesture = new ZoomButtonGesture((delta) => {
      output.push(delta);
      if (output.length === 1) {
        if (replace) gesture.begin(1, -1);
        else gesture.cancel();
      }
    }, schedule);
    const next = () => {
      const entry = jobs.entries().next().value!;
      jobs.delete(entry[0]);
      callback = entry[1];
      callback();
    };
    gesture.begin(1, 1);
    next();
    next();
    assert.equal(jobs.size, replace ? 1 : 0);
    if (replace) {
      gesture.end(1);
      assert.deepEqual(output, [0.1 * Math.LN2, -0.3 * Math.LN2]);
    }
    assert.equal(jobs.size, 0);
  }
});
