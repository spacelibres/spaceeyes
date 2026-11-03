import { test } from "node:test";
import assert from "node:assert/strict";
import { TrajectoryWorkQueue,latestTrajectory } from "./trajectory-work.ts";

test("accelerated pending trajectories capture simulation epoch only when admitted",()=>{
 const q=new TrajectoryWorkQueue<number>(()=>0);let epoch=846972583.005967;const samples:number[]=[];
 for(const id of ['busy-a','busy-b'])q.enqueue({objectId:id,revision:1,create:function*(){yield;yield;return 0;},commit:()=>{}});
 q.enqueue({objectId:'satellite',revision:1,create:latestTrajectory(()=>epoch,function*(time){return time;}),commit:time=>samples.push(time)});
 q.turn({budgetMs:1,maxSteps:2});epoch+=3600;
 for(let i=0;i<6;i++)q.turn({budgetMs:1,maxSteps:16});
 assert.deepEqual(samples,[epoch]);
});
test("queue bounds work, coalesces revisions and releases cancellation", () => {
  let clock = 0,
    released = 0;
  const committed: number[] = [];
  const q = new TrajectoryWorkQueue<number>(() => clock);
  const job = (revision: number) => ({
    objectId: "a",
    revision,
    create: function* () {
      for (let i = 0; i < 10; i++) {
        clock++;
        yield;
      }
      return revision;
    },
    commit: (v: number) => committed.push(v),
    release: () => released++,
  });
  q.enqueue(job(1));
  assert.equal(q.turn({ budgetMs: 2, maxSteps: 100 }).steps, 2);
  q.enqueue(job(2));
  assert.equal(released, 1);
  q.turn({ budgetMs: 100, maxSteps: 100 });
  assert.deepEqual(committed, [2]);
  assert.equal(released, 2);
});
test("round robin and bounded ownership allow completions within the remaining turn budget", () => {
  const order: string[] = [];
  const committed: string[] = [];
  let released = 0;
  const q = new TrajectoryWorkQueue<string>(() => 0, 2);
  for (const id of ["a", "b", "c"])
    q.enqueue({
      objectId: id,
      revision: 1,
      create: function* () {
        order.push(id);
        yield;
        return id;
      },
      commit: (v) => committed.push(v),
      release: () => released++,
    });
  assert.equal(released, 1);
  assert.equal(q.turn({ budgetMs: 1, maxSteps: 2 }).active, 1);
  assert.deepEqual(order, ["b"]);
  assert.deepEqual(committed,["b"]);
  assert.equal(q.turn({ budgetMs: 1, maxSteps: 20 }).completed, 1);
  assert.equal(committed.length, 2);
  q.clear();
  assert.equal(released, 3);
});
test("aborted work cannot commit and releases held resources", () => {
  const controller = new AbortController();
  let released = 0,
    committed = 0;
  const q = new TrajectoryWorkQueue<number>(() => 0);
  q.enqueue({
    objectId: "a",
    revision: 1,
    signal: controller.signal,
    create: function* () {
      yield;
      return 1;
    },
    commit: () => committed++,
    release: () => released++,
  });
  q.turn({ budgetMs: 1, maxSteps: 1 });
  controller.abort();
  q.turn({ budgetMs: 1, maxSteps: 20 });
  assert.equal(committed, 0);
  assert.equal(released, 1);
});
test("older revisions cannot replace current pending work", () => {
  const q = new TrajectoryWorkQueue<number>(() => 0);
  const commits: number[] = [];
  for (const revision of [2, 1])
    q.enqueue({
      objectId: "a",
      revision,
      create: function* () {
        return revision;
      },
      commit: (v) => commits.push(v),
    });
  q.turn({ budgetMs: 1, maxSteps: 10 });
  assert.deepEqual(commits, [2]);
});
test("job errors are isolated and publication cost is separate", () => {
  let now = 0;
  const errors: unknown[] = [];
  let commits = 0;
  const q = new TrajectoryWorkQueue<number>(() => now);
  q.enqueue({
    objectId: "bad",
    revision: 1,
    create: function* () {
      throw Error("gap");
    },
    commit: () => {},
    onError: (e) => errors.push(e),
  });
  q.enqueue({
    objectId: "good",
    revision: 1,
    create: function* () {
      yield;
      return 1;
    },
    commit: () => {
      now += 4;
      commits++;
    },
  });
  const result = q.turn({ budgetMs: 2, maxSteps: 10 });
  assert.equal(errors.length, 1);
  assert.equal(commits, 1);
  assert.equal(result.commitMs, 4);
  assert.equal(result.samplingMs, 0);
});
test("cancelled jobs never call error handlers", () => {
  let errors = 0;
  const controller = new AbortController();
  const q = new TrajectoryWorkQueue<number>(() => 0);
  q.enqueue({
    objectId: "a",
    revision: 1,
    signal: controller.signal,
    create: function* () {
      try {
        yield;
        return 1;
      } finally {
        throw Error("dispose");
      }
    },
    commit: () => {},
    onError: () => errors++,
  });
  q.turn({ budgetMs: 1, maxSteps: 1 });
  assert.doesNotThrow(() => controller.abort());
  assert.equal(errors, 0);
});
test("publication errors are isolated from other objects", () => {
  let errors = 0,
    commits = 0;
  const q = new TrajectoryWorkQueue<number>(() => 0);
  q.enqueue({
    objectId: "bad",
    revision: 1,
    create: function* () {
      return 1;
    },
    commit: () => {
      throw Error("publish");
    },
    onError: () => errors++,
  });
  q.enqueue({
    objectId: "good",
    revision: 1,
    create: function* () {
      return 2;
    },
    commit: () => commits++,
  });
  q.turn({ budgetMs: 1, maxSteps: 10 });
  q.turn({ budgetMs: 1, maxSteps: 10 });
  assert.equal(errors, 1);
  assert.equal(commits, 1);
});
test("exhausted sampling stages publication until the next turn", () => {
  let clock = 0,
    commits = 0;
  const q = new TrajectoryWorkQueue<number>(() => clock);
  q.enqueue({
    objectId: "a",
    revision: 1,
    create: function* () {
      clock = 2;
      return 1;
    },
    commit: () => commits++,
  });
  assert.equal(q.turn({ budgetMs: 1, maxSteps: 10 }).completed, 0);
  assert.equal(commits, 0);
  assert.equal(q.turn({ budgetMs: 1, maxSteps: 10 }).completed, 1);
});


test("active moving-window sampling catches up without stale publication or queue readmission", () => {
  for (const direction of [1, -1]) {
    let epoch = 0, attempts = 0;
    const build = latestTrajectory(() => epoch, function* (at: number) {
      attempts++;
      yield;
      return {at, range: [at - 1, at + 1]};
    }, (value, live) => live >= value.range[0] && live <= value.range[1]);
    const work = build();
    assert.equal(work.next().done, false);
    epoch = direction * 100;
    assert.equal(work.next().done, false);
    assert.equal(work.next().done, false);
    const result = work.next();
    assert.equal(result.done, true);
    assert.equal(result.value.at, epoch);
    assert.equal(attempts, 2);
  }
});


test("continuously moving stale jobs cannot starve admission of another object", () => {
  const queue = new TrajectoryWorkQueue<number>(() => 0);
  let epoch = 0, thirdStarted = false, published = 0;
  for (const id of ["a", "b", "c"]) queue.enqueue({
    objectId: id, revision: 1,
    create: latestTrajectory(() => epoch, function* (at) {
      if (id === "c") thirdStarted = true;
      yield;
      return at;
    }, (at, live) => Math.abs(at-live)<.1),
    commit: () => { published++; },
  });
  for (let frame=0;frame<100;frame++) {
    epoch++;
    queue.turn({budgetMs:1,maxSteps:1});
  }
  assert.equal(thirdStarted, true);
  assert.equal(published, 0);
  // Pausing allows every retained iterator to publish and releases ownership.
  for (let frame=0;frame<30;frame++) queue.turn({budgetMs:1,maxSteps:1});
  assert.equal(published, 3);
});


test("real retained adaptive jobs publish throughout 20x and 3600x forward/reverse playback", async () => {
  const {AdaptiveTrailState, adaptiveTrailSteps}=await import("../../platform/adaptive-trail.ts");
  for(const duration of [5000,86400]) for(const rate of [20,-20,3600,-3600]) {
    let epoch=0;
    let samplingClock=0;
    const queue=new TrajectoryWorkQueue< { times:number[]; unresolved:Set<number>; at:number; range:number[] } >(()=>samplingClock+=.001);

    const jobs=[{id:"selected",count:512,detail:true,state:new AdaptiveTrailState(),published:0,last:0},
      {id:"other",count:128,detail:false,state:new AdaptiveTrailState(),published:0,last:0}];
    const enqueue=(job:typeof jobs[number])=>queue.enqueue({objectId:job.id,revision:1,
      create:latestTrajectory(()=>epoch,function*(at){
        const reuse=duration/(job.detail?1024:16);
        const observer=job.detail ? [1.1e8*Math.cos(at*2*Math.PI/duration),1.1e8*Math.sin(at*2*Math.PI/duration),1e6] : undefined;
        const result=yield* adaptiveTrailSteps(at-duration-reuse,at,at+reuse,job.count,
          t=>[1e8*Math.cos(t*2*Math.PI/duration),1e8*Math.sin(t*2*Math.PI/duration),0],duration,[],observer,job.state);
        // Real publication assembly is also cooperative in SolarSystemData.
        for(let i=0;i<result.times.length;i+=16) yield;
        return {...result,at,range:[at-reuse,at+reuse]};
      },(value,live)=>live>=value.range[0]&&live<=value.range[1]),
      commit:value=>{
        assert.ok(epoch>=value.range[0]&&epoch<=value.range[1]);
        assert.ok(value.times[0]<=epoch-duration);
        assert.ok(value.times.at(-1)!>=epoch);
        assert.equal(value.unresolved.size,0);
        job.published++;job.last=epoch;
      },release:()=>{}});
    for(let frame=0;frame<180;frame++) {
      epoch+=rate/60;
      for(const job of jobs) enqueue(job);
      const result=queue.turn({budgetMs:1.5,maxSteps:2048});
      assert.ok(result.steps<=2048);
    }
    for(const job of jobs) {
      assert.ok(job.published>=10,`${rate} ${job.id}: ${job.published} publications`);
      assert.ok(Math.abs(epoch-job.last)<Math.abs(rate)*2,`${rate} ${job.id}: stopped publishing`);
    }
  }
});


test("all 83 Earth spacecraft retain progress without the former 64-owner eviction cycle", () => {
  const queue=new TrajectoryWorkQueue<number>(()=>0,256);
  const published=new Set<number>();
  for(let id=0;id<83;id++)queue.enqueue({objectId:String(id),revision:1,
    create:function*(){for(let probe=0;probe<100;probe++)yield;return id;},
    commit:value=>published.add(value)});
  for(let frame=0;frame<20;frame++)queue.turn({budgetMs:1,maxSteps:1024});
  assert.equal(published.size,83);
});


test("83 real retained adaptive jobs remain current under measured scientific work deadlines", async () => {
  const {AdaptiveTrailState, adaptiveTrailSteps}=await import("../../platform/adaptive-trail.ts");
  for(const duration of [5000]) for(const rate of [3600,-3600]) {
    let epoch=0;
    let samplingClock=0;
    const queue=new TrajectoryWorkQueue< { times:number[]; unresolved:Set<number>; at:number; range:number[] } >(()=>samplingClock+=.001,256);

    const jobs=[{id:"selected",count:512,detail:true,state:new AdaptiveTrailState(),published:0,last:0},
      {id:"other",count:128,detail:false,state:new AdaptiveTrailState(),published:0,last:0}];
    for(let id=2;id<83;id++)jobs.push({...jobs[1],id:`craft${id}`,state:new AdaptiveTrailState()});
    const enqueue=(job:typeof jobs[number])=>queue.enqueue({objectId:job.id,revision:1,
      create:latestTrajectory(()=>epoch,function*(at){
        const reuse=duration/(job.detail?1024:16);
        const observer=job.detail ? [1.1e8*Math.cos(at*2*Math.PI/duration),1.1e8*Math.sin(at*2*Math.PI/duration),1e6] : undefined;
        const result=yield* adaptiveTrailSteps(at-duration-reuse,at,at+reuse,job.count,
          t=>{samplingClock+=.01;return [1e8*Math.cos(t*2*Math.PI/duration),1e8*Math.sin(t*2*Math.PI/duration),0];},duration,[],observer,job.state,true);
        // Real publication assembly is also cooperative in SolarSystemData.
        for(let i=0;i<result.times.length;i+=16) yield;
        return {...result,at,range:[at-reuse,at+reuse]};
      },(value,live)=>live>=value.range[0]&&live<=value.range[1]),
      commit:value=>{
        assert.ok(epoch>=value.range[0]&&epoch<=value.range[1]);
        assert.ok(value.times[0]<=epoch-duration);
        assert.ok(value.times.at(-1)!>=epoch);
        assert.equal(value.unresolved.size,0);
        job.published++;job.last=epoch;
      },release:()=>{}});
    for(let frame=0;frame<300;frame++) {
      epoch+=rate/30;
      for(const job of jobs) enqueue(job);
      const result=queue.turn({budgetMs:17,maxSteps:65536});
      assert.ok(result.steps<=65536);
    }
    for(const job of jobs) {
      assert.ok(job.published>=5,`${rate} ${job.id}: ${job.published} publications; all=${jobs.map(j=>j.published).join(",")}`);
      assert.ok(Math.abs(epoch-job.last)<Math.abs(rate)*2,`${rate} ${job.id}: stopped publishing`);
    }
  }
});

test("selected continuations receive half each frame while normal work keeps progressing",()=>{
  let clock=0,selectedSteps=0,normalSteps=0,completed=false;
  const queue=new TrajectoryWorkQueue<number>(()=>clock,256);
  queue.enqueue({objectId:"selected",revision:1,priority:true,create:function*(){
    for(let i=0;i<8000;i++){clock+=.01;selectedSteps++;yield;}return 1;
  },commit:()=>{completed=true;}});
  for(let id=0;id<110;id++)queue.enqueue({objectId:String(id),revision:1,create:function*(){
    for(let i=0;i<100;i++){clock+=.01;normalSteps++;yield;}return id;
  },commit:()=>{}});
  for(let frame=0;frame<20&&!completed;frame++) {
    const selectedBefore=selectedSteps,normalBefore=normalSteps,started=clock;
    queue.turn({budgetMs:12,maxSteps:65536});
    assert.ok(selectedSteps>selectedBefore,"selected continuation progresses every frame");
    assert.ok(normalSteps>normalBefore,"selected work cannot consume the normal share");
    assert.ok(clock-started<=12.02,"both shares obey the one measured deadline");
  }
  assert.equal(completed,true);
});
