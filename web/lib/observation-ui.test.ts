import { test } from "node:test";
import assert from "node:assert/strict";
import {
  timeKnob,
  observationClock,
  RateDispatcher,
} from "./observation-ui.ts";
import { STARTUP_STAGES, startupProgress } from "./startup-progress.ts";

test("NASA knob reaches both ends, center and symmetric curve without changing the rate table", () => {
  assert.equal(timeKnob(0).x, 0);
  assert.equal(timeKnob(100).x, 1);
  assert.equal(timeKnob(50).y, 37.5);
  assert(Math.abs(timeKnob(0).y - 1.875) < 1e-10);
  for (let i = 0; i <= 100; i++)
    assert(Math.abs(timeKnob(i).y - timeKnob(100 - i).y) < 1e-10);
  assert.equal(timeKnob(-10).x, 0);
  assert.equal(timeKnob(110).x, 1);
  assert.throws(() => timeKnob(NaN));
});
test("clock stays in UTC and handles unavailable time", () => {
  assert.equal(observationClock("2026-11-01T23:59:58.123Z").time, "23:59:58");
  assert(observationClock("2026-11-01T23:59:58.123Z").date.includes("11"));
  assert.equal(observationClock("").time, "—");
  assert.equal(observationClock("invalid").date, "等待仿真时间");
});
test("progress reports completed stages, not simulated download bytes", () => {
  assert.deepEqual(
    STARTUP_STAGES.map(([id]) => startupProgress(id).completedStages),
    [0, 1, 2, 3, 4],
  );
  assert.equal(startupProgress("ready").completedStages, 5);
  assert.equal(startupProgress("wasm").totalStages, 5);
});
test("drag dispatch is bounded, flushes the final value and cancels stale changes", () => {
  let now = 0,
    serial = 0;
  const timers = new Map<number, { callback: () => void; due: number }>();
  const sent: number[] = [];
  const dispatcher = new RateDispatcher(
    (value) => sent.push(value),
    () => now,
    (callback, delay) => {
      const id = ++serial;
      timers.set(id, { callback, due: now + delay });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    (timer) => {
      timers.delete(timer as unknown as number);
    },
  );
  dispatcher.request(1);
  for (let i = 2; i <= 100; i++) {
    now = i;
    dispatcher.request(i);
  }
  assert.deepEqual(sent, [1]);
  assert.equal(timers.size, 1);
  now = 200;
  const ready = [...timers.values()][0];
  timers.clear();
  ready.callback();
  assert.deepEqual(sent, [1, 100]);
  now = 210;
  dispatcher.request(-3600);
  dispatcher.flush();
  assert.deepEqual(sent, [1, 100, -3600]);
  assert.equal(timers.size, 0);
  dispatcher.request(86400);
  dispatcher.cancel();
  dispatcher.flush();
  assert.deepEqual(sent, [1, 100, -3600]);
  assert.equal(timers.size, 0);
  assert.throws(() => dispatcher.request(Infinity));
});
