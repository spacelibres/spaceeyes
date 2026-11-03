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
test("round robin, bounded pending and one completion per turn", () => {
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
  assert.equal(q.turn({ budgetMs: 1, maxSteps: 2 }).active, 2);
  assert.deepEqual(order, ["b", "c"]);
  assert.equal(q.turn({ budgetMs: 1, maxSteps: 20 }).completed, 1);
  assert.equal(committed.length, 1);
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
