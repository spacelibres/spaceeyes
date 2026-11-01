import { test } from "node:test";
import assert from "node:assert/strict";
import { TrailHistory } from "../trail-history.ts";

test("inclusive controller end uses its matching phase source instead of the next interval",async()=>{
 const phase=(t:number)=>t>=3&&t<=5?"overlap":"base";
 const history=new TrailHistory({
   parentAt:()=>"sun",boundaries:()=>[3,5],phaseAt:(_id,t)=>phase(t),
   createSource:()=>{
     let at=0;
     return {async load(_ids:readonly string[],t:number){at=t;},coverage:()=>[0,10],
       position:(_id:string,t:number)=>{assert.equal(phase(t),phase(at));return [phase(at)==="overlap"?20:2,0,0];},dispose(){}};
   },
 });
 try {
   const prepared=await history.prepare("craft",7,0,10);
   assert.deepEqual(prepared.position(3),[20,0,0]);
   assert.deepEqual(prepared.position(5),[20,0,0]);
   assert.deepEqual(prepared.position(5.01),[2,0,0]);
 }finally{history.dispose();}
});

test("an isolated combination at an inclusive shared boundary gets a bounded private source",async()=>{
 const phase=(t:number)=>t===5?"both":t<5?"before":"after";
 let count=0;
 const history=new TrailHistory({parentAt:()=>"sun",boundaries:()=>[5],phaseAt:(_id,t)=>phase(t),
   createSource:()=>{
     let at=0;count++;
     return {async load(_ids:readonly string[],t:number){at=t;},coverage:()=>[0,10],
       position:(_id:string,t:number)=>{assert.equal(phase(t),phase(at));return [at,0,0];},dispose(){}};
   }});
 try {
   const prepared=await history.prepare("craft",7,0,10);
   assert.deepEqual(prepared.position(5),[5,0,0]);
   assert.equal(count,3);
 }finally{history.dispose();}
});
test("history converts changing parents into one current reference without publishing", async () => {
  let disposed = 0;
  const h = new TrailHistory({
    parentAt: (_id, t) => (t < 5 ? "earth" : "sun"),
    boundaries: () => [5],
    createSource: () => ({
      async load() {},
      coverage: () => [0, 10],
      position: (id, t) => (id === "craft" ? [t + 100, 0, 0] : [100, 0, 0]),
      dispose() {
        disposed++;
      },
      cacheStats: () => ({ records: 2 }),
    }),
  });
  const result = await h.prepare("craft", 7, 0, 10, "earth");
  assert.deepEqual(result.position(3), [3, 0, 0]);
  assert.deepEqual(result.position(7), [7, 0, 0]);
  assert.ok(result.boundaries.includes(5));
  h.dispose();
  assert.equal(disposed, 2);
});
test("segments follow actual coverage and right boundary wins", async () => {
  const h = new TrailHistory({
    parentAt: () => "sun",
    boundaries: () => [],
    createSource: () => {
      let at = 0;
      return {
        async load(_ids, t) {
          at = t;
        },
        coverage: () => (at < 5 ? [0, 5] : [5, 10]),
        position: (_id, t) => [t, at < 5 ? 1 : 2, 0],
        dispose() {},
      };
    },
  });
  const result = await h.prepare("craft", 8, 0, 10);
  assert.equal(result.position(5)[1], 2);
  assert.equal(result.position(2)[1], 1);
  h.dispose();
});
test("record budget and cancellation release private sources", async () => {
  let disposed = 0;
  const controller = new AbortController();
  const h = new TrailHistory({
    maxRecords: 1,
    parentAt: () => "sun",
    boundaries: () => [],
    createSource: () => ({
      async load() {},
      coverage: () => [0, 10],
      position: () => [0, 0, 0],
      dispose() {
        disposed++;
      },
      cacheStats: () => ({ records: 2 }),
    }),
  });
  await assert.rejects(h.prepare("craft", 5, 0, 10), /budget/);
  assert.equal(disposed, 1);
  controller.abort();
  await assert.rejects(
    h.prepare("craft", 5, 0, 10, undefined, controller.signal),
  );
  h.dispose();
});
test("failed history intervals stay gaps and late cancelled load cannot survive", async () => {
  const gaps = new TrailHistory({
    parentAt: () => "sun",
    boundaries: () => [5],
    createSource: () => {
      let at = 0;
      return {
        async load(_ids, t) {
          at = t;
          if (t < 5) throw Error("source missing");
        },
        coverage: () => [5, 10],
        position: () => [1, 2, 3],
        dispose() {},
      };
    },
  });
  const result = await gaps.prepare("craft", 8, 0, 10);
  assert.deepEqual(result.gaps, [[0, 5]]);
  assert.throws(() => result.position(2), /gap/);
  assert.deepEqual(result.position(5), [1, 2, 3]);
  gaps.dispose();
  let release!: () => void;
  let disposed = 0;
  const controller = new AbortController();
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const late = new TrailHistory({
    parentAt: () => "sun",
    boundaries: () => [],
    createSource: () => ({
      async load() {
        await gate;
      },
      coverage: () => [0, 10],
      position: () => [0, 0, 0],
      dispose() {
        disposed++;
      },
    }),
  });
  const pending = late.prepare("craft", 5, 0, 10, undefined, controller.signal);
  controller.abort();
  assert.equal(disposed, 1);
  release();
  await assert.rejects(pending);
  assert.equal(disposed, 1);
  late.dispose();
});

test("each new source receives the remaining global cache allowance before loading", async () => {
  const allowances: number[] = [];
  let held = 0,
    peak = 0;
  const history = new TrailHistory({
    maxRecords: 10,
    parentAt: () => "sun",
    boundaries: () => [5],
    createSource: (_signal, remaining) => {
      allowances.push(remaining);
      let records = 0;
      return {
        async load() {
          if (remaining < 6) throw Error("local cache budget");
          records = 6;
          held += records;
          peak = Math.max(peak, held);
        },
        coverage: () => [0, 10],
        position: () => [0, 0, 0],
        cacheStats: () => ({ records }),
        dispose() {
          held -= records;
          records = 0;
        },
      };
    },
  });
  const prepared = await history.prepare("craft", 7, 0, 10);
  assert.deepEqual(allowances, [10, 4]);
  assert.equal(peak, 6);
  assert.deepEqual(prepared.gaps, [[5, 10]]);
  history.dispose();
  assert.equal(held, 0);
});
