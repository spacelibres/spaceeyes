import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameMonitor } from "./frame-monitor.ts";
test("strict frame cadence includes skipped elapsed and resets on resume", () => {
  const m = new FrameMonitor();
  assert.equal(m.accept(0, 60), 0);
  assert.equal(m.accept(8, 60), undefined);
  assert.equal(m.accept(17, 60), 0.017);
  assert.equal(m.accept(33, 60), undefined);
  assert.equal(m.accept(34, 60), 0.017);
  m.reset();
  assert.equal(m.accept(1000, 30), 0);
  assert.equal(m.accept(1033, 30), undefined);
  assert.equal(m.accept(1034, 30), 0.034);
});
test("phase pacing tolerates RAF jitter without exceeding elapsed allowance or catching up", () => {
  const m = new FrameMonitor();
  let admitted = 0;
  for (let i = 0; i < 600; i++) {
    const now = (i * 1000) / 60 + (i % 2 ? -0.1 : 0);
    if (m.accept(now, 60) !== undefined) admitted++;
    assert.ok(admitted <= Math.floor((now * 60) / 1000) + 1);
  }
  assert.ok(admitted >= 598);
  assert.notEqual(m.accept(20000, 60), undefined);
  assert.equal(m.accept(20000, 60), undefined);
  assert.ok(m.snapshot(20000).admittedIntervalMs.samples > 0);
});
test("late admission never creates adjacent catchup burst", () => {
  const m = new FrameMonitor();
  m.accept(0, 60);
  assert.notEqual(m.accept(32, 60), undefined);
  assert.equal(m.accept(33.34, 60), undefined);
  assert.notEqual(m.accept(50, 60), undefined);
});
test("30Hz phase on 144Hz RAF retains thirty average within absolute sixty ceiling", () => {
  const m = new FrameMonitor();
  let frames = 0,
    last: number | undefined;
  const intervals: number[] = [];
  for (let i = 0; i < 1440; i++) {
    const now = (i * 1000) / 144;
    if (m.accept(now, 30) !== undefined) {
      frames++;
      if (last !== undefined) {
        assert.ok(now - last >= 1000 / 60 - 0.5);
        intervals.push(now - last);
      }
      last = now;
    }
    assert.ok(frames <= Math.floor((now * 30) / 1000 + 1e-7) + 1);
  }
  assert.ok(frames >= 295);
  intervals.sort((a, b) => a - b);
  assert.ok(intervals[Math.ceil(intervals.length * 0.95) - 1] <= 40);
});
test("async phase metrics are bounded and preserve throws", () => {
  let clock = 0;
  const m = new FrameMonitor(() => clock);
  for (let i = 0; i < 300; i++)
    m.measurePhase("configure", () => {
      clock += i;
    });
  m.recordPhase("unknown" as any, 999);
  m.recordPhase("checkpoint", NaN);
  assert.throws(
    () =>
      m.measurePhase("reloadApply", () => {
        clock += 7;
        throw Error("original");
      }),
    /original/,
  );
  const s = m.snapshot(clock).asyncPhases;
  assert.equal(s.configure.samples, 240);
  assert.equal(s.configure.latest, 299);
  assert.equal(s.configure.max, 299);
  assert.equal(s.configure.mean, 179.5);
  assert.equal(s.configure.p50, 179);
  assert.equal(s.reloadApply.latest, 7);
  assert.equal(s.checkpoint.samples, 0);
  assert.equal(Object.keys(s).length, 4);
});
