import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptiveTrailTimes, AdaptiveTrailState, shareAdaptiveTrailStates } from "../adaptive-trail.ts";
test("grazing camera refines the whole chord, including a close pass between probe points", () => {
  const r=1.5e8, curve=(t:number)=>[r*Math.cos(t),r*Math.sin(t),0];
  for(const angle of [.037,-.047,-1.713]) {
    const center=curve(angle),observer=[center[0],center[1],1];
    const result=adaptiveTrailTimes(-6,0,.1,512,curve,2*Math.PI,[],observer);
    let worst=0;
    for(let i=1;i<result.times.length;i++) {
      const a=curve(result.times[i-1]),b=curve(result.times[i]),m=curve((result.times[i-1]+result.times[i])/2);
      const delta=b.map((x,j)=>x-a[j]),length2=delta.reduce((sum,x)=>sum+x*x,0);
      const u=Math.max(0,Math.min(1,delta.reduce((sum,x,j)=>sum+x*(observer[j]-a[j]),0)/length2));
      const distance=Math.hypot(...a.map((x,j)=>x+u*delta[j]-observer[j]));
      worst=Math.max(worst,Math.hypot(...m.map((x,j)=>x-(a[j]+b[j])/2))/Math.max(1e-6,distance));
    }
    assert.ok(worst<=.0005,`grazing chord error ${worst}`);
    assert.equal(result.times[0],-6);
    assert.equal(result.times.at(-1),.1);
    assert.equal(result.unresolved.size,0);
    assert.ok(result.times.length<=512);
  }
});
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


test("retained moving windows extend real source edges in both directions", async () => {
  const { AdaptiveTrailState } = await import("../adaptive-trail.ts");
  for (const direction of [1, -1]) {
    const state = new AdaptiveTrailState();
    let probes = 0;
    const curve = (t: number) => { probes++; return [100 * Math.cos(t), 100 * Math.sin(t), 0]; };
    const first = adaptiveTrailTimes(-1, 0, .1, 256, curve, 2*Math.PI, [], undefined, state);
    const initialProbes = probes;
    probes = 0;
    const shift = direction * .001;
    const next = adaptiveTrailTimes(-1+shift, shift, .1+shift, 256, curve, 2*Math.PI, [], undefined, state);
    assert.equal(next.times[0], -1+shift);
    assert.equal(next.times.at(-1), .1+shift);
    assert.ok(next.times.includes(shift));
    assert.ok(next.times.filter(t => first.times.includes(t)).length > first.times.length/2);
    assert.ok(probes < initialProbes/2, `${probes} versus ${initialProbes}`);
    assert.ok(!next.unresolved.size);
    assert.ok(state.samples.size <= 256*32);
  }
});


test("retained state respects gaps, observer changes, pause and distant seeks", async () => {
  const { AdaptiveTrailState } = await import("../adaptive-trail.ts");
  const state = new AdaptiveTrailState();
  let missing = true;
  const source = (t: number) => {
    if (missing && t > -.6 && t < -.4) throw Error("gap");
    return [100*Math.cos(t), 100*Math.sin(t), 0];
  };
  const gap = adaptiveTrailTimes(-1, 0, .1, 128, source, 6, [], undefined, state);
  assert.ok(gap.unresolved.size > 0);
  missing = false;
  const loaded = adaptiveTrailTimes(-1, 0, .1, 128, source, 6, [], undefined, state);
  assert.equal(loaded.unresolved.size, 0);
  const paused = adaptiveTrailTimes(-1, 0, .1, 128, source, 6, [], undefined, state);
  assert.deepEqual(paused.times, loaded.times);
  adaptiveTrailTimes(-1, 0, .1, 128, source, 6, [], [100,0,1], state);
  assert.equal(state.observerKey, "[100,0,1]");
  const seek = adaptiveTrailTimes(100, 101, 101.1, 128, source, 6, [], undefined, state);
  assert.equal(seek.times[0], 100);
  assert.equal(seek.times.at(-1), 101.1);
  assert.ok([...state.samples.keys()].every(t => t>=100 && t<=101.1));
});


test("a changed near observer reallocates a full far-camera point budget", async () => {
  const {AdaptiveTrailState}=await import("../adaptive-trail.ts");
  const state=new AdaptiveTrailState();
  const circle=(t:number)=>[100*Math.cos(t),100*Math.sin(t),0];
  adaptiveTrailTimes(0,1,6,64,circle,2*Math.PI,[],[1000,1000,1000],state);
  const near=[99,10,0];
  const retained=adaptiveTrailTimes(0,1,6,64,circle,2*Math.PI,[],near,state);
  const fresh=adaptiveTrailTimes(0,1,6,64,circle,2*Math.PI,[],near);
  assert.deepEqual(retained.times,fresh.times);
  assert.deepEqual(retained.unresolved,fresh.unresolved);
});


test("moving close observers recycle certified distant nodes instead of rebuilding full allocations",async()=>{
  const {AdaptiveTrailState}=await import("../adaptive-trail.ts");
  const state=new AdaptiveTrailState();
  let calls=0;
  const curve=(t:number)=>{calls++;return [100*Math.cos(t),100*Math.sin(t),0];};
  for(let frame=0;frame<30;frame++) {
    const angle=frame*.12,observer=[100.01*Math.cos(angle),100.01*Math.sin(angle),.01];
    calls=0;
    const result=adaptiveTrailTimes(-6,0,.1,256,curve,2*Math.PI,[],observer,state);
    if(frame>=5)assert.ok(calls<600,`frame ${frame}: ${calls} fresh source evaluations`);
    assert.ok(result.times.length<=256);
    assert.equal(result.unresolved.size,0);
    for(let i=1;i<result.times.length;i++) {
      const a=curve(result.times[i-1]),b=curve(result.times[i]),delta=b.map((x,j)=>x-a[j]);
      const length2=delta.reduce((sum,x)=>sum+x*x,0);
      const u=Math.max(0,Math.min(1,delta.reduce((sum,x,j)=>sum+x*(observer[j]-a[j]),0)/length2));
      const distance=Math.max(1e-6,Math.hypot(...a.map((x,j)=>x+u*delta[j]-observer[j])));
      for(let probe=0;probe<=8;probe++) {
        const fraction=probe/8,p=curve(result.times[i-1]+(result.times[i]-result.times[i-1])*fraction);
        const error=Math.hypot(...p.map((x,j)=>x-(a[j]+delta[j]*fraction)));
        assert.ok(error<=distance*.0005+1e-10,`projected error frame ${frame}`);
      }
    }
  }
});


test("future guard samples transfer into the visible part without shared pruning or observer certificates",()=>{
 const states=[new AdaptiveTrailState(),new AdaptiveTrailState(),new AdaptiveTrailState()];
 const curve=(time:number)=>[100*Math.cos(time),100*Math.sin(time),0];
 const initial=[[-6,0],[-12,-6],[0,6]];
 for(let i=0;i<3;i++)adaptiveTrailTimes(initial[i][0],initial[i][0],initial[i][1],128,curve,2*Math.PI,[],[1000,1000,1000],states[i],true);
 const futurePoint=states[2].samples.get(states[2].times[2])!,futureTime=states[2].times[2];
 shareAdaptiveTrailStates([{state:states[0],start:0,end:6},{state:states[1],start:-6,end:0},{state:states[2],start:6,end:12}],[1000,1000,1000]);
 assert.equal(states[0].samples.get(futureTime),futurePoint);assert.ok(states[0].segments.size>0);
 const transferred=states[0].samples.size;states[2].samples.clear();assert.equal(states[0].samples.size,transferred,'maps belong to each part');
 shareAdaptiveTrailStates([{state:states[0],start:0,end:6}],[99,10,0]);assert.equal(states[0].segments.size,0,'observer-dependent scores are never transferred across observers');
 const actual=adaptiveTrailTimes(0,1,6,128,curve,2*Math.PI,[],[99,10,0],states[0],true);
 assert.ok(actual.times.length<=128);assert.equal(actual.times[0],0);assert.equal(actual.times.at(-1),6);
 assert.equal(actual.unresolved.size,0);
});
test("transferred known failures invalidate successful certificates and cannot be hidden by cached points",()=>{
 const left=new AdaptiveTrailState(),right=new AdaptiveTrailState();
 adaptiveTrailTimes(0,0,1,32,t=>[t,0,0],undefined,[],undefined,left,true);
 right.samples.set(.333,undefined);right.times=[.333];
 shareAdaptiveTrailStates([{state:left,start:0,end:1},{state:right,start:1,end:2}]);
 assert.equal(left.samples.get(.333),undefined);assert.ok([...left.segments.values()].every(segment=>!(segment.a<=.333&&.333<=segment.b)));
 const result=adaptiveTrailTimes(0,0,1,32,t=>[t,0,0],undefined,[],undefined,left,true);
 assert.ok(result.unresolved.size>0,'a failure between cached probes still breaks geometry');assert.ok(result.times.length<=32);
});
test("moving three-part windows reuse future work without reducing any part's allocation or source accuracy",()=>{
 const run=(share:boolean)=>{
  const states=[new AdaptiveTrailState(),new AdaptiveTrailState(),new AdaptiveTrailState()];let calls=0;
  const point=(t:number)=>{calls++;return [100*Math.cos(t),100*Math.sin(t),0];};
  let warm=0;
  for(let frame=0;frame<8;frame++) {
   const epoch=frame*1.2,parts=[{state:states[0],start:epoch-6,end:epoch},{state:states[1],start:epoch-12,end:epoch-6},{state:states[2],start:epoch,end:epoch+6}];
   if(share)shareAdaptiveTrailStates(parts);
   const before=calls;
   for(const {state,start,end} of parts){const result=adaptiveTrailTimes(start,end,end,128,point,2*Math.PI,[],undefined,state,true);
    assert.ok(result.times.length<=128);assert.equal(result.times[0],start);assert.equal(result.times.at(-1),end);assert.equal(result.unresolved.size,0);
    for(const time of result.times){const cached=state.samples.get(time)!;assert.deepEqual(cached,[100*Math.cos(time),100*Math.sin(time),0]);}
   }
   if(frame)warm+=calls-before;
  }
  return warm;
 };
 const independent=run(false),shared=run(true);
 assert.ok(shared<independent*.8,`shared ${shared} vs independent ${independent} actual source evaluations`);
});
