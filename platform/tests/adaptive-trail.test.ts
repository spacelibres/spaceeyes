import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptiveTrailTimes } from "../adaptive-trail.ts";
test("near observer refines real source curvature without shortening the year-long path", () => {
  const r=1.5e8, observer=[r,0,1000], curve=(t:number)=>[r*Math.cos(t),r*Math.sin(t),0];
  const result=adaptiveTrailTimes(-6,0,0.1,512,curve,2*Math.PI,[],observer);
  assert.equal(result.times[0],-6);
  assert.equal(result.times.at(-1),0.1);
  assert.equal(result.unresolved.size,0);
  assert.ok(result.times.length<=512);
  let worst=0;
  for(let i=1;i<result.times.length;i++) {
    const a=curve(result.times[i-1]),b=curve(result.times[i]),m=curve((result.times[i-1]+result.times[i])/2);
    const error=Math.hypot(...m.map((x,j)=>x-(a[j]+b[j])/2));
    const distance=Math.max(1e-6,Math.min(...[a,b,m].map(p=>Math.hypot(...p.map((x,j)=>x-observer[j])))));
    worst=Math.max(worst,error/distance);
  }
  assert.ok(worst<=0.0005,`angular chord error ${worst}`);
});
test("adaptive history retains both temporal ends and spends points on curved portions", () => {
  const curve = (t: number) => [2 * Math.cos(t * t), 2 * Math.sin(t * t), 0];
  const result = adaptiveTrailTimes(0, 2, 2.1, 160, curve, Math.PI);
  assert.equal(result.times[0], 0);
  assert.equal(result.times.at(-1), 2.1);
  assert.ok(result.times.includes(2));
  assert.ok(result.times.length <= 160);
  assert.ok(
    result.times.filter((t) => t > 1).length >
      result.times.filter((t) => t < 1).length,
  );
});
test("long straight escape paths are not shortened by radial distance or point budgets", () => {
  const result = adaptiveTrailTimes(0, 946080000, 946080000, 160, (t) => [
    1e8 + t * 10,
    0,
    0,
  ]);
  assert.equal(result.times[0], 0);
  assert.equal(result.times.at(-1), 946080000);
  assert.equal(result.unresolved.size, 0);
  assert.ok(result.times.length <= 160);
});
test("unresolved source gaps remain broken without shrinking the time window", () => {
  const result = adaptiveTrailTimes(0, 5, 10, 32, (t) => {
    if (t > 4 && t < 4.5) throw Error("gap");
    return [100, t, 0];
  });
  assert.equal(result.times[0], 0);
  assert.equal(result.times.at(-1), 10);
  assert.ok(result.unresolved.size > 0);
});

test("budget exhaustion preserves a continuous covered multi-revolution trail", () => {
  const result = adaptiveTrailTimes(
    0,
    12,
    12.5,
    256,
    (t) => [100 * Math.cos(t), 100 * Math.sin(t), 0],
    2 * Math.PI,
  );
  assert.equal(result.times[0], 0);
  assert.equal(result.times.at(-1), 12.5);
  assert.ok(result.times.includes(12));
  assert.equal(result.unresolved.size, 0);
  assert.ok(result.times.length <= 256);
});

test("history phase and data boundaries are retained inside the same finite sample budget", () => {
  const result = adaptiveTrailTimes(
    0,
    5,
    10,
    16,
    (t) => [t, 0, 0],
    Infinity,
    [2, 3, 8],
  );
  for (const boundary of [0, 2, 3, 5, 8, 10])
    assert.ok(result.times.includes(boundary));
  assert.ok(result.times.length <= 16);
  assert.throws(
    () =>
      adaptiveTrailTimes(
        0,
        5,
        10,
        8,
        (t) => [t, 0, 0],
        Infinity,
        [1, 2, 3, 4, 6, 7, 8],
      ),
    /budget/,
  );
});

test("cooperative sampler yields during seed evaluations and preserves output", async () => {
  const { adaptiveTrailSteps } = await import("../adaptive-trail.ts");
  let calls = 0;
  const curve = (t: number) => {
    calls++;
    return [Math.cos(t), Math.sin(t), 0];
  };
  const work = adaptiveTrailSteps(0, 1, 6, 80, curve);
  let result;
  do {
    const before = calls;
    result = work.next();
    assert.ok(calls - before <= 1);
  } while (!result.done);
  assert.deepEqual(result.value, adaptiveTrailTimes(0, 1, 6, 80, curve));
});
