import { eyesDefinitions } from "../eyes-catalog.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SolarSystemData, hasDisplayCatalog, solarCatalog } from "../solar-system.ts";
import type { PluginContext } from "../plugin-host.ts";
function orb(radius: number) {
  const b = new Uint8Array(28 + 144),
    v = new DataView(b.buffer);
  v.setInt16(0, 2, true);
  b.set([111, 114, 98, 0, 3], 2);
  v.setFloat64(7, 1, true);
  v.setFloat64(15, 2, true);
  b[23] = 1;
  v.setInt32(24, 2, true);
  for (let i = 0; i < 2; i++) {
    const p = 28 + i * 72;
    [i * 10, radius, 0, 0, 0, 1, 0, 0, 0].forEach((x, j) =>
      v.setFloat64(p + j * 8, x, true),
    );
  }
  return b;
}
function context() {
  const states = new Map();
  return {
    states,
    ctx: {
      signal: new AbortController().signal,
      onDispose() {},
      data: {
        publish(id: string, s: unknown) {
          states.set(id, s);
        },
        remove(id: string) {
          states.delete(id);
        },
      },
    },
  } as unknown as {
    states: Map<string, unknown>;
    ctx: PluginContext;
  };
}

test("orientation-only rotation leaves fixed scientific position and zero velocity available",()=>{
 const {ctx}=context(),original=eyesDefinitions.earth.controllers;
 const source=new SolarSystemData(ctx,{fetch:async()=>{throw Error("Unexpected resource request");}});
 try {
  eyesDefinitions.earth.controllers=[
   {type:"fixed",position:{constructor:"Vector3",values:[1,2,3]}},
   {type:"rotateByEntityOrientation",entityForOrientation:"sun",rotatingPosition:false,rotatingOrientation:true},
  ];
  assert.deepEqual(source.position("earth",5),[1,2,3]);
  assert.deepEqual(source.sourceVelocity("earth",5),[0,0,0]);
 } finally {eyesDefinitions.earth.controllers=original;source.dispose();}
});

test("dynamic cache cannot override a later fixed phase velocity when jumping both ways",async()=>{
 const {ctx}=context(),original=eyesDefinitions.earth.controllers;
 const bytes=orb(10),view=new DataView(bytes.buffer);
 for(const offset of [28,100])view.setFloat64(offset+24,0.1,true);
 const source=new SolarSystemData(ctx,{fetch:async()=>new Response(bytes)});
 try {
  eyesDefinitions.earth.controllers=[
   {type:"dynamo",url:"earth/sun",coverage:[0,5]},
   {type:"fixed",position:{constructor:"Vector3",values:[1,2,3]},coverage:[5,10]},
   {type:"rotateByEntityOrientation",rotatingPosition:false,rotatingOrientation:true,coverage:[5,10]},
  ];
  for(const t of [2,5,2,5]) {
   await source.load(["earth"],t,[]);
   assert.equal(source.status("earth")?.status,"ready");
   if(t===5) {
    assert.deepEqual(source.position("earth",t),[1,2,3]);
    assert.deepEqual(source.sourceVelocity("earth",t),[0,0,0]);
   } else assert.ok(Math.hypot(...source.sourceVelocity("earth",t))>0);
  }
 } finally {eyesDefinitions.earth.controllers=original;source.dispose();}
});

test("static position provenance and velocity share fixed/orbital declaration order",async()=>{
 const {ctx}=context(),original=eyesDefinitions.earth.controllers;
 const source=new SolarSystemData(ctx,{fetch:async()=>{throw Error("Unexpected request");}});
 const orbital={type:"orbitalElements",epoch:0,semiMajorAxis:90,eccentricity:0,meanAngularMotion:0.01,meanAnomalyAtEpoch:0,orientation:{values:[1,0,0,0]},coverage:[0,10]};
 const fixed={type:"fixed",position:{constructor:"Vector3",values:[1,2,3]},coverage:[2,8]};
 try {
  eyesDefinitions.earth.controllers=[fixed,orbital];
  await source.load(["earth"],5,[]);
  assert.equal(source.status("earth")?.positionSource,"orbital-elements");
  assert.ok(Math.hypot(...source.sourceVelocity("earth",5))>0);
  eyesDefinitions.earth.controllers=[orbital,fixed];
  await source.load(["earth"],5,[]);
  assert.equal(source.status("earth")?.positionSource,"fixed");
  assert.deepEqual(source.sourceVelocity("earth",5),[0,0,0]);
 } finally {eyesDefinitions.earth.controllers=original;source.dispose();}
});

test("overlapping position controllers invalidate same-parent cached data and rollback restores track identity",async()=>{
 const {ctx,states}=context(),old=eyesDefinitions.moon.controllers;
 eyesDefinitions.moon.controllers=[{type:"dynamo",url:"moon/earth/a",coverage:[0,10]},{type:"dynamo",url:"moon/earth/b",coverage:[5,8]}];
 let requests=0;
 const source=new SolarSystemData(ctx,{fetch:async input=>{
   const url=new URL(String(input),"http://localhost"),epoch=Number(url.searchParams.get("epoch"));
   if(url.pathname.endsWith("/moon"))requests++;
   return new Response(orb(url.pathname.endsWith("/moon")?(epoch>=5&&epoch<=8?20:2):10000));
 }});
 try {
   await source.load(["moon"],4,[]);source.publishAt(4);
   const restore=source.checkpoint();
   assert.equal(source.needsPositionRefresh("moon",5),true);
   assert.throws(()=>source.position("moon",5),/Outside source controller coverage/);
   await source.load(["moon"],5,[]);source.publishAt(5);
   assert.equal(requests,2,"new overlapping controller needs its own payload despite broad cached DYN coverage");
   assert.deepEqual(source.position("moon",5),[10020,0,0]);
   restore();source.publishAt(4);
   assert.deepEqual(source.position("moon",4),[10002,0,0]);
   await source.load(["moon"],5,[]);source.publishAt(5);
   assert.equal(requests,3);
   await source.load(["moon"],9,[]);source.publishAt(9);
   assert.equal(requests,4);
   assert.deepEqual(source.position("moon",9),[10002,0,0]);
   assert.equal((states.get("moon") as any).epochTdbSeconds,9);
 }finally{source.dispose();eyesDefinitions.moon.controllers=old;}
});

test("resolved controller metadata invalidates broad data when undeclared root coverage starts",async()=>{
 const {ctx}=context(),old=eyesDefinitions.moon.controllers;
 eyesDefinitions.moon.controllers=[{type:"dynamo",url:"moon/earth/a"},{type:"dynamo",url:"moon/other/b"}];
 let requests=0;
 const source=new SolarSystemData(ctx,{fetch:async input=>{
   const url=new URL(String(input),"http://localhost"),t=Number(url.searchParams.get("epoch"));
   if(!url.pathname.endsWith("/moon"))return new Response(orb(10000));
   requests++;
   const later=t>=5&&t<=8;
   return new Response(orb(later?20:2),{headers:{"x-dyn-controller-selection":JSON.stringify(later?{track:"moon/other/b"}:
     {track:"moon/earth/a",...(t<5?{upperExclusive:5}:{lowerExclusive:8})})}});
 }});
 try {
   await source.load(["moon"],4,[]);
   assert.equal(source.needsPositionRefresh("moon",4.99),false);
   assert.equal(source.needsPositionRefresh("moon",5),true);
   const restore=source.checkpoint();
   await source.load(["moon"],5,[]);
   assert.equal(requests,2);
   assert.deepEqual(source.position("moon",5),[10020,0,0]);
   restore();
   assert.equal(source.needsPositionRefresh("moon",5),true,"rollback restores open-boundary eligibility");
   await source.load(["moon"],9,[]);
   assert.equal(requests,3);
   assert.equal(source.needsPositionRefresh("moon",8),true);
   assert.equal(source.needsPositionRefresh("moon",8.01),false);
 }finally{source.dispose();eyesDefinitions.moon.controllers=old;}
});

test("private history preserves inclusive endpoints across same-parent root-controller switches",async()=>{
 const {ctx,states}=context(),id="sc_psyche",epoch=880000000;
 const oldControllers=eyesDefinitions[id].controllers,oldTrail=eyesDefinitions[id].trail;
 eyesDefinitions[id].controllers=[{type:"dynamo",url:"sc_psyche/sun/a"},{type:"dynamo",url:"sc_psyche/sun/b"}];
 eyesDefinitions[id].trail={length:6};
 const source=new SolarSystemData(ctx,{fetch:async input=>{
   const t=Number(new URL(String(input),"http://localhost").searchParams.get("epoch"));
   const later=t>=epoch-3&&t<=epoch+1;
   const bytes=new Uint8Array(76),v=new DataView(bytes.buffer);
   v.setInt16(0,2,true);bytes.set([108,105,110,0,3,1],2);v.setInt32(8,2,true);
   for(let i=0;i<2;i++){v.setFloat64(12+i*32,later?epoch-3+i*4:epoch-1000+i*2000,true);v.setFloat64(20+i*32,later?20:2,true);}
   return new Response(bytes,{headers:{"x-dyn-controller-selection":JSON.stringify(later?{track:"sc_psyche/sun/b"}:
     {track:"sc_psyche/sun/a",...(t<epoch-3?{upperExclusive:epoch-3}:{lowerExclusive:epoch+1})})}});
 }});
 try {
   await source.load([id],epoch+2,[]);source.publishAt(epoch+2);
   const published=JSON.stringify([...states]);
   assert.equal(await source.prepareTrailHistory(id,epoch+2),true);
   const trail=source.trailSamples(id,epoch+2,64);
   for(const t of [epoch-3,epoch+1]) {
     const index=trail.epochsTdbSeconds.indexOf(t);
     assert.ok(index>=0,`exact controller boundary ${t} is sampled: ${trail.epochsTdbSeconds.join(",")}`);
     assert.deepEqual(trail.points[index],[20,0,0]);
   }
   assert.ok(trail.breakIndices.length>0,"real controller discontinuities remain explicit breaks");
   assert.equal(JSON.stringify([...states]),published);
 }finally{source.dispose();eyesDefinitions[id].controllers=oldControllers;eyesDefinitions[id].trail=oldTrail;}
});
test("moon positions compose the true loaded parent and all publishes share epoch", async () => {
  const { ctx, states } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async (input) =>
      String(input).includes("type=ori")
        ? new Response("", { status: 404 })
        : new Response(orb(String(input).includes("/moon?") ? 2 : 10)),
  });
  await source.load(["moon", "sun"], 5);
  assert.deepEqual(source.position("moon", 5), [12, 0, 0]);
  source.publishAt(5);
  assert.equal(
    (
      states.get("moon") as {
        epochTdbSeconds: number;
      }
    ).epochTdbSeconds,
    5,
  );
  assert.deepEqual(source.coverage("sun"), [5, 5]);
  source.dispose();
  assert.equal(states.size, 0);
});

test("moon displayed orbit remains parent-relative while world state includes Earth's motion", async () => {
  const { ctx } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async (input) => {
      const moon = String(input).includes("/moon?");
      const bytes = orb(moon ? 2 : 10000);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < 2; i++) {
        view.setFloat64(28 + i * 72 + 24, 0.1, true);
        view.setFloat64(28 + i * 72 + 32, i, true);
      }
      return new Response(bytes);
    },
  });
  await source.load(["moon"], 5, []);
  const trail = source.trajectorySamples("moon", 5, 256);
  assert.equal(trail.originId, "earth");
  assert.equal('conic' in trail, false);
  assert.ok(trail.points.every((p) => Math.abs(Math.hypot(...p) - 2) < 1e-8));
  const p = source.position("moon", 5),
    earth = source.position("earth", 5),
    i = trail.epochsTdbSeconds.indexOf(5);
  assert.deepEqual(
    trail.points[i].map((v, j) => v + earth[j]),
    p,
  );
  const ellipse = source.trajectorySamples(
    "moon",
    5,
    256,
    false,
    "instantaneous",
  );
  assert.equal(ellipse.originId, "earth");
  assert.ok('conic' in ellipse && ellipse.conic);
  assert.ok(ellipse.conic.semiLatusRectumKm > 0);
  assert.deepEqual(ellipse.points[0], ellipse.points.at(-1));
  assert.deepEqual(
    ellipse.points[ellipse.epochsTdbSeconds.indexOf(5)].map(
      (v, j) => v + earth[j],
    ),
    p,
  );
  source.dispose();
});

test("trajectory sampling contains the exact current epoch, refines locally and preserves real endpoints", async () => {
  const { ctx } = context();
  const bytes = orb(5e7);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 2; i++) {
    view.setFloat64(28 + i * 72 + 24, 0.1, true);
    view.setFloat64(28 + i * 72 + 32, i, true);
  }
  const source = new SolarSystemData(ctx, {
    fetch: async () => new Response(bytes),
  });
  await source.load(["earth"], 5, []);
  const epoch = 5.1234567;
  const trail = source.trajectorySamples("earth", epoch, 2048, true);
  const i = trail.epochsTdbSeconds.indexOf(epoch);
  assert.ok(i > 0 && i < trail.points.length - 1);
  assert.deepEqual(trail.points[i], source.position("earth", epoch));
  assert.ok(trail.points.length <= 2048);
  assert.ok(trail.epochsTdbSeconds.every((t, j, a) => j === 0 || t > a[j - 1]));
  assert.ok(trail.epochsTdbSeconds[i + 1] - epoch < 1e-5);
  assert.deepEqual(trail.points[0], source.position("earth", 0));
  assert.deepEqual(trail.points.at(-1), source.position("earth", 10));
  assert.notDeepEqual(trail.points[0], trail.points.at(-1));
  source.dispose();
});
test("instantaneous ellipse closes beyond DYN coverage without publishing extrapolated states", async () => {
  const { ctx, states } = context();
  const bytes = orb(10),
    view = new DataView(bytes.buffer);
  // A circular two-body fixture: mu=1+2=3, n=sqrt(mu/a^3).
  const n = Math.sqrt(3 / 1000);
  for (let i = 0; i < 2; i++) {
    view.setFloat64(28 + i * 72 + 24, n, true);
    view.setFloat64(28 + i * 72 + 32, n * i * 10, true);
  }
  const source = new SolarSystemData(ctx, {
    fetch: async () => new Response(bytes),
  });
  await source.load(["neptune"], 5, []);
  const before = structuredClone([...states]);
  const trail = source.trajectorySamples(
    "neptune",
    5,
    256,
    false,
    "instantaneous",
  );
  assert.deepEqual(trail.points[0], trail.points.at(-1));
  assert.ok(trail.points.every((p) => Math.abs(Math.hypot(...p) - 10) < 1e-8));
  assert.deepEqual(
    trail.points[trail.epochsTdbSeconds.indexOf(5)],
    source.position("neptune", 5),
  );
  assert.ok(
    trail.epochsTdbSeconds[0] < 0 && trail.epochsTdbSeconds.at(-1)! > 10,
  );
  assert.deepEqual([...states], before);
  assert.throws(() => source.position("neptune", 11), /coverage/);
  source.dispose();
});

test("reviewed source identity and selected coverage survive into published provenance", async () => {
  const { ctx, states } = context();
  const rawHash = "a".repeat(64),
    selection = JSON.stringify({ records: [17, 50], coverage: [0, 10] });
  const source = new SolarSystemData(ctx, {
    fetch: async () =>
      new Response(orb(10), {
        headers: {
          "x-dyn-source-sha256": rawHash,
          "x-dyn-selection": selection,
        },
      }),
  });
  await source.load(["earth"], 5, []);
  const provenance = source.provenance("earth")[0];
  assert.equal(provenance.sourceSha256, rawHash);
  assert.equal(provenance.selection, selection);
  assert.match(provenance.sha256, /^[a-f0-9]{64}$/);
  source.publishAt(5);
  assert.ok(
    (states.get("earth") as { source: string }).source.includes(rawHash),
  );
  assert.deepEqual(source.coverage("earth"), [0, 10]);
  source.dispose();
});

test("disposed delayed fetch cannot resurrect objects", async () => {
  const { ctx, states } = context();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const source = new SolarSystemData(ctx, {
    fetch: async () => {
      await gate;
      return new Response(orb(10));
    },
  });
  const task = source.load(["earth"], 5);
  source.dispose();
  release();
  await task;
  source.publishAt(5);
  assert.equal(states.size, 0);
  assert.deepEqual(source.status(), []);
});
test("checkpoint restores previous cache and provenance after a failed load, never after dispose", async () => {
  const { ctx, states } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("epoch=20") || url.includes("type=ori"))
        return new Response("", { status: 503 });
      return new Response(orb(10));
    },
  });
  await source.load(["earth"], 5);
  const previousState = structuredClone(source.status("earth"));
  const previousProvenance = structuredClone(source.provenance("earth"));
  const restore = source.checkpoint();
  await source.load(["earth"], 20);
  assert.equal(source.status("earth")?.status, "failed");
  restore();
  assert.deepEqual(source.status("earth"), previousState);
  assert.deepEqual(source.provenance("earth"), previousProvenance);
  source.publishAt(5);
  assert.equal(
    (states.get("earth") as { epochTdbSeconds: number }).epochTdbSeconds,
    5,
  );
  source.dispose();
  restore();
  assert.deepEqual(source.status(), []);
  assert.equal(states.size, 0);
  assert.throws(() => source.position("earth", 5), /unavailable/);
});

test("missing catalog definitions stay unsupported without source requests", async () => {
  const { ctx } = context();
  let fetched = 0;
  const source = new SolarSystemData(ctx, {
    fetch: async () => {
      fetched++;
      throw Error("unexpected");
    },
  });
  await source.load(["sc_isas", "sc_lunar_trailblazer", "sc_lunir"], 0, []);
  assert.equal(fetched, 0);
  for (const id of ["sc_isas", "sc_lunar_trailblazer", "sc_lunir"])
    assert.equal(source.status(id)?.status, "unsupported");
});

test("default load stays baseline ten and retain removes published states", async () => {
  const { ctx, states } = context();
  const ids = new Set<string>();
  const source = new SolarSystemData(ctx, {
    fetch: async (input) => {
      const u = new URL(String(input), "https://local");
      ids.add(u.pathname.split("/").at(-1)!);
      return u.searchParams.has("type")
        ? new Response("", { status: 404 })
        : new Response(orb(10));
    },
  });
  await source.load();
  assert.equal(source.status().length, 10);
  assert.ok(!ids.has("sc_iss"));
  source.publishAt(0);
  source.retain(["sun"]);
  assert.equal(source.status().length, 1);
  assert.deepEqual([...states.keys()], ["sun"]);
});

test("retain removes only states owned by a successful publish", async () => {
  const { ctx, states } = context();
  ctx.data.remove = (id: string) => {
    assert.ok(states.has(id), "cannot remove unpublished " + id);
    states.delete(id);
  };
  const source = new SolarSystemData(ctx, {
    fetch: async () => new Response("", { status: 404 }),
  });
  await source.load(["sc_isas", "mars"], 0, []);
  source.retain(["sun"]);
  assert.equal(source.status().length, 0);
  await source.load(["sun"]);
  source.publishAt(0);
  source.retain([]);
  assert.equal(states.size, 0);
});

test("deferred static parent cannot resurrect landing state after retain or dispose", async () => {
  for (const stop of ["retain", "dispose"]) {
    const { ctx } = context();
    let release!: (r: Response) => void;
    const gate = new Promise<Response>((r) => (release = r));
    const source = new SolarSystemData(ctx, { fetch: async () => gate });
    const loading = source.load(["sc_mars_2020_landing_site"], 700000000, []);
    await Promise.resolve();
    if (stop === "retain") source.retain([]);
    else source.dispose();
    release(new Response(orb(10)));
    await loading;
    assert.equal(source.status("sc_mars_2020_landing_site"), undefined);
  }
});

test("child-only epoch jump reloads its parent segment", async () => {
  const { ctx } = context();
  let earthRequests = 0;
  const source = new SolarSystemData(ctx, {
    fetch: async (input) => {
      const u = new URL(String(input), "https://local");
      const epoch = Number(u.searchParams.get("epoch"));
      const later = epoch >= 20;
      if (u.pathname.endsWith("/earth")) earthRequests++;
      const b = orb(u.pathname.endsWith("/moon") ? 2 : later ? 20 : 10);
      if (later) {
        const v = new DataView(b.buffer);
        v.setFloat64(28, 20, true);
        v.setFloat64(100, 30, true);
      }
      return new Response(b);
    },
  });
  await source.load(["moon"], 5, []);
  assert.deepEqual(source.position("moon", 5), [12, 0, 0]);
  await source.load(["moon"], 25, []);
  assert.equal(earthRequests, 2);
  assert.deepEqual(source.position("moon", 25), [22, 0, 0]);
});

test("checkpoint restores retention and published ownership alongside data state", async () => {
  const { ctx, states } = context();
  ctx.data.remove = (id: string) => {
    assert.ok(states.has(id));
    states.delete(id);
  };
  const source = new SolarSystemData(ctx);
  source.retain(["sun"]);
  await source.load(["sun"]);
  source.publishAt(0);
  const restore = source.checkpoint();
  source.retain([]);
  assert.equal(states.size, 0);
  restore();
  source.publishAt(0);
  assert.ok(
    states.has("sun"),
    "rollback must restore a removed published object",
  );
  source.retain([]);
  assert.equal(states.size, 0);
});

test("source network reads are bounded and disposal never starts queued fetches", async () => {
  const { ctx } = context();
  let active = 0,
    peak = 0,
    calls = 0;
  const releases: (() => void)[] = [];
  const source = new SolarSystemData(ctx, {
    fetch: async (_input, options) => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
        options?.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      active--;
      options?.signal?.throwIfAborted();
      return new Response(orb(10));
    },
  });
  const loading = source.load(
    [
      "mercury",
      "venus",
      "earth",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptune",
    ],
    0,
    [],
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 4);
  assert.equal(calls, 4);
  source.dispose();
  for (const release of releases) release();
  await loading;
  assert.equal(calls, 4);
});

test("instantaneous request falls back to covered linear source history", async () => {
  const { ctx } = context();
  const b = new Uint8Array(76),
    v = new DataView(b.buffer);
  v.setInt16(0, 2, true);
  b.set([108, 105, 110, 0, 3, 1], 2);
  v.setInt32(8, 2, true);
  v.setFloat64(44, 10, true);
  v.setFloat64(52, 10, true);
  const source = new SolarSystemData(ctx, {
    fetch: async () => new Response(b),
  });
  await source.load(["sc_voyager_1"], 5, []);
  const path = source.trajectorySamples(
    "sc_voyager_1",
    5,
    8,
    false,
    "instantaneous",
  );
  assert.ok(path.points.length <= 8);
  assert.ok(path.points.every((p) => p.every(Number.isFinite)));
});

test("declared orbital elements expose finite covered trajectory history", async () => {
  const { ctx } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async (input) =>
      String(input).includes("type=ori")
        ? new Response("", { status: 404 })
        : new Response(orb(10)),
  });
  await source.load(["dactyl"], 5, []);
  const path = source.trajectorySamples("dactyl", 5, 8, false, "instantaneous");
  assert.ok(path.conic, 'Declared bound orbital elements need the same analytic display');
  assert.ok(path.points.length <= 8);
  assert.ok(path.points.every((p) => p.every(Number.isFinite)));
});

test("trail samples include the current epoch and covered future cache", async () => {
  const { ctx } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async () => {
      const bytes = orb(2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < 2; i++) view.setFloat64(28 + i * 72 + 24, 0.1, true);
      return new Response(bytes);
    },
  });
  assert.throws(() => source.trailSamples("moon", 5));
  await source.load(["moon"], 5, []);
  const trail = source.trailSamples("moon", 5, 32);
  assert.equal(trail.originId, "earth");
  assert.equal('conic' in trail, false);
  assert.ok(trail.epochsTdbSeconds.includes(5));
  assert.ok(trail.epochsTdbSeconds.at(-1)! > 5);
  assert.ok(trail.epochsTdbSeconds[0] >= 0);
  assert.ok(trail.epochsTdbSeconds.at(-1)! <= 10);
  assert.ok(trail.points.length <= 32);
  assert.ok(trail.points.every((p) => p.every(Number.isFinite)));
  for (const count of [NaN, Infinity, 7, 4097])
    assert.throws(() => source.trailSamples("moon", 5, count));
  source.dispose();
});

test("trail uses a full past period against a moving parent and caches future", async () => {
  const { ctx } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async (input) => {
      const radius=String(input).includes("/moon?") ? 2 : 10000;
      const b = orb(radius);
      const v = new DataView(b.buffer);
      v.setFloat64(7,radius**3*((2*Math.PI)/100)**2,true);
      v.setFloat64(15,0,true);
      for (let i = 0; i < 2; i++) {
        v.setFloat64(28 + i * 72, i * 1000, true);
        v.setFloat64(28 + i * 72 + 24, (2 * Math.PI) / 100, true);
        v.setFloat64(28 + i * 72 + 32, i * 20 * Math.PI, true);
      }
      return new Response(b);
    },
  });
  await source.load(["moon"], 500, []);
  const trail = source.trailSamples("moon", 500, 160);
  assert.ok(Math.abs(trail.durationSeconds - 100) < 1e-8);
  assert.ok(Math.abs(trail.epochsTdbSeconds[0] - 400) < 1e-8);
  assert.ok(Math.abs(trail.epochsTdbSeconds.at(-1)! - 506.25) < 1e-8);
  for (let i = 0; i < trail.points.length; i++) {
    const t = trail.epochsTdbSeconds[i];
    assert.deepEqual(
      trail.points[i],
      source
        .position("moon", t)
        .map((v, j) => v - source.position("earth", t)[j]),
    );
  }
  source.dispose();
});
test("retain aborts active transport requests", async () => {
  const { ctx } = context();
  let active!: AbortSignal;
  const source = new SolarSystemData(ctx, {
    fetch: async (_input, init) => {
      active = init!.signal!;
      return await new Promise<Response>((_resolve, reject) =>
        active.addEventListener("abort", () => reject(active.reason), {
          once: true,
        }),
      );
    },
  });
  const loading = source.load(["earth"], 5, []);
  while (!active) await Promise.resolve();
  source.retain([]);
  assert.equal(active.aborted, true);
  await loading;
  source.dispose();
});

test("retained pending planet retries immediately after scene cancellation", async () => {
  const { ctx } = context();
  let requests = 0;
  let firstSignal!: AbortSignal;
  const source = new SolarSystemData(ctx, {
    fetch: async (_input, init) => {
      requests++;
      if (requests > 1) return new Response(orb(10));
      firstSignal = init!.signal!;
      return await new Promise<Response>((_resolve, reject) =>
        firstSignal.addEventListener(
          "abort",
          () => reject(firstSignal.reason),
          { once: true },
        ),
      );
    },
  });
  const first = source.load(["earth"], 5, []);
  while (!firstSignal) await Promise.resolve();
  source.retain(["earth"]);
  const second = source.load(["earth"], 5, []);
  await Promise.all([first, second]);
  assert.equal(firstSignal.aborted, true);
  assert.equal(requests, 2);
  assert.equal(source.status("earth")?.status, "ready");
  assert.deepEqual(source.position("earth", 5), [10, 0, 0]);
  source.dispose();
});

test("decoded caches and evidence are bounded by retained scene and record budget", async () => {
  const { ctx } = context();
  const source = new SolarSystemData(ctx, {
    maxCachedRecords: 2,
    fetch: async () => new Response(orb(10)),
  });
  source.retain(["earth"]);
  await source.load(["earth"], 5, []);
  assert.equal(source.cacheStats().records, 2);
  assert.equal(source.provenance("earth").length, 1);
  assert.throws(() => source.retain(["unknown"]));
  assert.throws(() => source.retain(["earth", "earth"]));
  assert.equal(source.cacheStats().records, 2);
  source.retain(["earth", "mars"]);
  await source.load(["mars"], 5, []);
  assert.equal(source.status("mars")?.status, "failed");
  assert.equal(source.cacheStats().records, 2);
  assert.equal(source.provenance("mars").length, 0);
  const restore = source.checkpoint();
  source.retain(["mars"]);
  assert.equal(source.cacheStats().records, 0);
  restore();
  assert.equal(source.cacheStats().records, 2);
  const discard = source.checkpoint();
  discard.discard();
  source.retain([]);
  discard();
  assert.equal(source.cacheStats().records, 0);
  source.dispose();
  assert.equal(source.cacheStats().provenance, 0);
});

test("replacement and repeated epochs retain only latest accepted evidence", async () => {
  const { ctx } = context();
  const source = new SolarSystemData(ctx, {
    maxCachedRecords: 2,
    fetch: async (input) => {
      const epoch = Number(
        new URL(String(input), "http://test").searchParams.get("epoch"),
      );
      const bytes = orb(10);
      const view = new DataView(bytes.buffer);
      view.setFloat64(28, epoch, true);
      view.setFloat64(100, epoch + 10, true);
      return new Response(bytes);
    },
  });
  source.retain(["earth"]);
  for (const epoch of [0, 20, 40, 60]) {
    await source.load(["earth"], epoch, []);
    assert.equal(source.cacheStats().records, 2);
    assert.equal(source.provenance("earth").length, 1);
    assert(source.provenance("earth")[0].url.endsWith("epoch=" + epoch));
  }
  const restore = source.checkpoint();
  source.retain([]);
  restore();
  source.retain([]);
  restore();
  assert.equal(source.cacheStats().records, 0);
  source.dispose();
});
test("rollback aborts in-flight requests without reviving cancelled results", async () => {
  const { ctx } = context();
  let finish!: (r: Response) => void;
  let wait = false;
  let started!: () => void;
  const fetched = new Promise<void>((resolve) => {
    started = resolve;
  });
  const source = new SolarSystemData(ctx, {
    fetch: async () =>
      wait
        ? await new Promise<Response>((r) => {
            finish = r;
            started();
          })
        : new Response(orb(10)),
  });
  source.retain(["earth"]);
  await source.load(["earth"], 5, []);
  const prior = source.provenance("earth");
  const restore = source.checkpoint();
  wait = true;
  source.retain(["mars"]);
  const pending = source.load(["mars"], 5, []);
  await fetched;
  restore();
  finish(new Response(orb(20)));
  await pending;
  assert.deepEqual(source.provenance("earth"), prior);
  assert.equal(source.provenance("mars").length, 0);
  assert.equal(source.status("mars"), undefined);
  assert.equal(source.cacheStats().records, 2);
  source.dispose();
});
test("invalid cache budgets and oversized retain reject without mutations", () => {
  const { ctx } = context();
  for (const value of [0, -1, NaN, Infinity, 1.5, 1000001])
    assert.throws(() => new SolarSystemData(ctx, { maxCachedRecords: value }));
  const source = new SolarSystemData(ctx);
  source.retain(["sun"]);
  assert.throws(() => source.retain(Array(257).fill("sun")));
  assert.equal(source.cacheStats().records, 0);
  source.dispose();
  assert(Object.isFrozen(source.cacheStats()));
});

function orientation(start = 0) {
  const bytes = new Uint8Array(12 + 128);
  const view = new DataView(bytes.buffer);
  view.setInt16(0, 2, true);
  bytes.set([111, 114, 105, 0, 3, 1], 2);
  view.setInt32(8, 2, true);
  for (let i = 0; i < 2; i++)
    [start + i * 10, 1, 0, 0, 0, 0, 0, 0].forEach((value, j) =>
      view.setFloat64(12 + i * 64 + j * 8, value, true),
    );
  return bytes;
}
test("orientation budget and coverage failure are explicit while position remains ready", async () => {
  for (const outside of [false, true]) {
    const { ctx } = context();
    const source = new SolarSystemData(ctx, {
      maxCachedRecords: outside ? 4 : 2,
      fetch: async (input) =>
        new Response(
          String(input).includes("type=ori")
            ? orientation(outside ? 20 : 0)
            : orb(10),
        ),
    });
    await source.load(["earth"], 5);
    assert.equal(source.status("earth")?.status, "ready");
    assert.equal(source.status("earth")?.orientationStatus, "unavailable");
    assert.match(
      source.status("earth")?.orientationError ?? "",
      outside ? /coverage/ : /budget/,
    );
    assert.equal(source.cacheStats().orientationEntries, 0);
    assert.equal(source.provenance("earth").length, 1);
    source.dispose();
  }
  const { ctx } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async (input) =>
      new Response(
        String(input).includes("type=ori") ? orientation() : orb(10),
      ),
  });
  await source.load(["earth"], 5);
  assert.equal(source.status("earth")?.orientationStatus, "ready");
  await source.load(["earth"], 5, []);
  assert.equal(source.status("earth")?.orientationStatus, "not-requested");
  source.dispose();
});

test("rollback removes newly published scene objects before restoring ownership", async () => {
  const { ctx, states } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async () => new Response(orb(10)),
  });
  source.retain(["earth"]);
  await source.load(["earth"], 5, []);
  source.publishAt(5);
  const restore = source.checkpoint();
  source.retain(["mars"]);
  await source.load(["mars"], 5, []);
  source.publishAt(5);
  assert(states.has("mars"));
  restore();
  assert(!states.has("mars"));
  source.publishAt(5);
  assert(states.has("earth"));
  assert(!states.has("mars"));
  source.dispose();
  assert.equal(states.size, 0);
});

test("fixed and sequential entity align orientations publish with explicit provenance", async () => {
  const old = eyesDefinitions.earth.controllers;
  try {
    eyesDefinitions.earth.controllers = [
      {
        type: "fixed",
        orientation: { constructor: "Quaternion", values: [2, 0, 0, 0] },
      },
      {
        type: "align",
        coverage: [0, 10],
        primary: {
          type: "point",
          target: "sun",
          axis: { expression: "Pioneer.Vector3.XAxis" },
        },
      },
    ];
    const { ctx, states } = context();
    const source = new SolarSystemData(ctx, {
      fetch: async () => new Response(orb(10)),
    });
    await source.load(["earth"], 5);
    source.publishAt(5);
    const state = states.get("earth") as { orientationWxyz: number[] };
    assert.ok(state.orientationWxyz);
    assert.ok(Math.abs(state.orientationWxyz[0]) < 1e-12);
    assert.equal(source.status("earth")?.orientationSource, "derived");
    assert.equal(source.status("earth")?.orientationStatus, "ready");
    source.dispose();
  } finally {
    eyesDefinitions.earth.controllers = old;
  }
});
test("fixed quaternion publishes without ORI request and invalid attitude preserves position", async () => {
  const old = eyesDefinitions.earth.controllers;
  try {
    eyesDefinitions.earth.controllers = [
      {
        type: "fixed",
        orientation: { constructor: "Quaternion", values: [2, 0, 0, 0] },
      },
    ];
    const { ctx, states } = context();
    let oriRequests = 0;
    const source = new SolarSystemData(ctx, {
      fetch: async (input) => {
        if (String(input).includes("type=ori")) oriRequests++;
        return new Response(orb(10));
      },
    });
    await source.load(["earth"], 5);
    source.publishAt(5);
    assert.deepEqual(
      (states.get("earth") as any).orientationWxyz,
      [1, 0, 0, 0],
    );
    assert.equal(source.status("earth")?.orientationSource, "fixed");
    assert.equal(oriRequests, 0);
    eyesDefinitions.earth.controllers = [
      {
        type: "fixed",
        orientation: { constructor: "Quaternion", values: [0, 0, 0, 0] },
      },
    ];
    source.publishAt(5);
    assert.equal(source.status("earth")?.orientationStatus, "unavailable");
    assert.ok(states.has("earth"));
    assert.equal((states.get("earth") as any).orientationWxyz, undefined);
    source.dispose();
  } finally {
    eyesDefinitions.earth.controllers = old;
  }
});
test("orientation reference cycles reject without awaiting own pending load", async () => {
  const earth = eyesDefinitions.earth.controllers,
    moon = eyesDefinitions.moon.controllers;
  try {
    eyesDefinitions.earth.controllers = [
      { type: "align", primary: { type: "align", target: "moon" } },
    ];
    eyesDefinitions.moon.controllers = [
      { type: "align", primary: { type: "align", target: "earth" } },
    ];
    const { ctx } = context();
    const source = new SolarSystemData(ctx, {
      fetch: async () => new Response(orb(10)),
    });
    await source.load(["earth"], 5);
    assert.equal(source.status("earth")?.status, "ready");
    assert.equal(source.status("earth")?.orientationStatus, "unavailable");
    assert.match(
      source.status("earth")?.orientationError ?? "",
      /dependency cycle/,
    );
    source.dispose();
  } finally {
    eyesDefinitions.earth.controllers = earth;
    eyesDefinitions.moon.controllers = moon;
  }
});

test("self velocity align uses analytic parent plus child world velocity without self await", async () => {
  const earth = eyesDefinitions.earth.controllers,
    moon = eyesDefinitions.moon.controllers;
  try {
    eyesDefinitions.earth.controllers = [{ type: "dynamo", url: "earth/ori" }];
    eyesDefinitions.moon.controllers = [
      { type: "dynamo", url: "earth/ori" },
      {
        type: "align",
        primary: {
          type: "velocity",
          target: "moon",
          axis: { expression: "Pioneer.Vector3.XAxis" },
        },
      },
    ];
    const { ctx, states } = context();
    const source = new SolarSystemData(ctx, {
      fetch: async (input) => {
        if (String(input).includes("type=ori"))
          return new Response(orientation());
        const bytes = orb(String(input).includes("/moon?") ? 2 : 10),
          v = new DataView(bytes.buffer);
        for (let i = 0; i < 2; i++) v.setFloat64(28 + i * 72 + 24, 0.1, true);
        return new Response(bytes);
      },
    });
    await source.load(["moon"], 5);
    const v = source.velocity("moon", 5);
    assert.ok(Math.abs(v[1] - 1.2 * Math.cos(0.5)) < 1e-12);
    source.publishAt(5);
    assert.equal(source.status("moon")?.orientationSource, "derived");
    assert.ok((states.get("moon") as any).orientationWxyz);
    assert.deepEqual(source.velocity("moon", 5), v);
    source.dispose();
  } finally {
    eyesDefinitions.earth.controllers = earth;
    eyesDefinitions.moon.controllers = moon;
  }
});

test("fresh InSight surface load waits for Mars ORI and publishes finite source coverage", async () => {
  const epoch = 846620500;
  const { ctx, states } = context();
  let requestedMarsOri = false;
  const source = new SolarSystemData(ctx, {
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("type=ori")) {
        if (url.includes("/mars?")) requestedMarsOri = true;
        return new Response(orientation(epoch - 5));
      }
      const bytes = orb(1e8),
        v = new DataView(bytes.buffer);
      for (let i = 0; i < 2; i++)
        v.setFloat64(28 + i * 72, epoch - 5 + i * 10, true);
      return new Response(bytes);
    },
  });
  await source.load(["sc_insight"], epoch);
  assert.equal(requestedMarsOri, true);
  source.publishAt(epoch);
  const state = states.get("sc_insight") as {
    coverageTdbSeconds: number[];
    source: string;
  };
  assert.ok(state, source.status("sc_insight")?.error);
  assert.ok(state.coverageTdbSeconds.every(Number.isFinite));
  assert.equal(state.coverageTdbSeconds[1], 1e12);
  assert.equal(source.status("sc_insight")?.positionSource, "fixed");
  assert.match(state.source, /fixed position controller/);
  assert.doesNotMatch(state.source, /NASA Eyes DYN/);
  source.dispose();
});

test("declared ecliptic reference is internal and retention stops at solar boundary", async () => {
  const old = eyesDefinitions.moon.controllers;
  try {
    eyesDefinitions.moon.controllers = eyesDefinitions.l1.controllers;
    const { ctx, states } = context();
    const requested: string[] = [];
    const source = new SolarSystemData(ctx, {
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(
          String(input).includes("type=ori")
            ? orientation()
            : orb(String(input).includes("/moon?") ? 2 : 10),
        );
      },
    });
    assert.equal(hasDisplayCatalog("j2000_ecliptic"), false);
    source.retain(["moon", "earth", "sun"]);
    await source.load(["moon"], 5);
    source.publishAt(5);
    assert.equal(
      source.status("moon")?.orientationStatus,
      "ready",
      source.status("moon")?.orientationError,
    );
    assert.equal(source.status("moon")?.orientationSource, "derived");
    assert.equal(source.status("j2000_ecliptic"), undefined);
    assert.equal(states.has("j2000_ecliptic"), false);
    assert.ok(!requested.some((url) => /j2000|milky|universe/i.test(url)));
    source.dispose();
  } finally {
    eyesDefinitions.moon.controllers = old;
  }
});

test("deferred static entity ORI cannot resurrect ready state after retain or dispose", async () => {
  const old = eyesDefinitions.earth.controllers;
  try {
    eyesDefinitions.earth.controllers = [
      {
        type: "fixed",
        position: { constructor: "Vector3", values: [10, 0, 0] },
      },
      { type: "dynamo", url: "earth/ori" },
    ];
    for (const stop of ["retain", "dispose"]) {
      const { ctx } = context();
      let release!: (value: Response) => void;
      let entered!: () => void;
      const requested = new Promise<void>((resolve) => (entered = resolve));
      const gate = new Promise<Response>((resolve) => (release = resolve));
      const source = new SolarSystemData(ctx, {
        fetch: async (input) => {
          assert.match(String(input), /type=ori/);
          entered();
          return gate;
        },
      });
      const loading = source.load(["earth"], 5);
      await requested;
      if (stop === "retain") source.retain([]);
      else source.dispose();
      release(new Response(orientation()));
      await loading;
      assert.equal(source.status("earth"), undefined);
      assert.equal(source.cacheStats().orientationEntries, 0);
    }
  } finally {
    eyesDefinitions.earth.controllers = old;
  }
});

test("real Rumba declaration derives attitude without requesting absent ORI", async () => {
  const { ctx, states } = context();
  let rumbaOri = 0;
  const source = new SolarSystemData(ctx, {
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("type=ori")) {
        if (url.includes("sc_cluster_ii_fm5")) {
          rumbaOri++;
          return new Response("", { status: 503 });
        }
        return new Response(orientation());
      }
      const bytes = orb(url.includes("sc_cluster_ii_fm5") ? 23444 : 1e8),
        view = new DataView(bytes.buffer);
      for (let i = 0; i < 2; i++) view.setFloat64(28 + i * 72 + 24, 0.1, true);
      return new Response(bytes);
    },
  });
  await source.load(["sc_cluster_ii_fm5"], 5);
  source.publishAt(5);
  assert.equal(rumbaOri, 0);
  assert.equal(
    source.status("sc_cluster_ii_fm5")?.orientationStatus,
    "ready",
    source.status("sc_cluster_ii_fm5")?.orientationError,
  );
  assert.equal(
    source.status("sc_cluster_ii_fm5")?.orientationSource,
    "derived",
  );
  assert.ok((states.get("sc_cluster_ii_fm5") as any).orientationWxyz);
  source.dispose();
});

test("cached ORI still publishes after position-only dependency load downgrades requested status", async () => {
  const { ctx, states } = context();
  let reads = 0;
  const source = new SolarSystemData(ctx, {
    fetch: async (input) => {
      reads++;
      return new Response(
        String(input).includes("type=ori") ? orientation() : orb(10),
      );
    },
  });
  await source.load(["earth"], 5);
  await source.load(["earth"], 5, []);
  assert.equal(source.status("earth")?.orientationStatus, "not-requested");
  const before = reads;
  source.publishAt(5);
  assert.equal(reads, before);
  assert.deepEqual((states.get("earth") as any).orientationWxyz, [1, 0, 0, 0]);
  assert.equal(source.status("earth")?.orientationStatus, "ready");
  assert.equal(source.status("earth")?.orientationSource, "dyn");
  source.dispose();
});

test("source Align velocity direction ignores fast parent translation", async () => {
  const earth = eyesDefinitions.earth.controllers,
    moon = eyesDefinitions.moon.controllers;
  try {
    eyesDefinitions.earth.controllers = [{ type: "dynamo", url: "earth/orb" }];
    eyesDefinitions.moon.controllers = [
      { type: "dynamo", url: "moon/orb" },
      {
        type: "align",
        primary: {
          type: "velocity",
          target: "moon",
          axis: { expression: "Pioneer.Vector3.XAxis" },
        },
      },
    ];
    const quaternions: number[][] = [];
    for (const parentRadius of [10, 1e8]) {
      const { ctx, states } = context();
      const source = new SolarSystemData(ctx, {
        fetch: async (input) => {
          const child = String(input).includes("/moon?");
          const bytes = orb(child ? 2 : parentRadius),
            v = new DataView(bytes.buffer);
          for (let i = 0; i < 2; i++) {
            v.setFloat64(28 + i * 72 + 24, 0.1, true);
            v.setFloat64(28 + i * 72 + 32, child ? 0 : Math.PI / 2, true);
          }
          return new Response(bytes);
        },
      });
      await source.load(["moon"], 5);
      source.publishAt(5);
      quaternions.push((states.get("moon") as any).orientationWxyz);
      source.dispose();
    }
    assert.deepEqual(quaternions[0], quaternions[1]);
  } finally {
    eyesDefinitions.earth.controllers = earth;
    eyesDefinitions.moon.controllers = moon;
  }
});

test("trajectory eligibility follows current position phase, not historical ORI or flight declarations", () => {
  const { ctx } = context();
  const source = new SolarSystemData(ctx);
  assert.equal(source.hasTrajectory("sc_insight", 846620500), false);
  assert.equal(source.hasTrajectory("earth", 5), true);
  const old = eyesDefinitions.moon.controllers;
  try {
    eyesDefinitions.moon.controllers = [
      { type: "dynamo", url: "moon/orb", coverage: [0, 9] },
      { type: "dynamo", url: "moon/ori", coverage: [0, 20] },
      {
        type: "fixed",
        position: { constructor: "Vector3", values: [0, 0, 0] },
        coverage: [10, 20],
      },
    ];
    assert.equal(source.hasTrajectory("moon", 9), true);
    assert.equal(source.hasTrajectory("moon", 10), false);
    assert.equal(source.hasTrajectory("moon", 20), false);
    assert.equal(source.hasTrajectory("moon", 21), false);
  } finally {
    eyesDefinitions.moon.controllers = old;
    source.dispose();
  }
});

test("spin source anchor survives checkpoint and clears with retained scene", async () => {
  const original = eyesDefinitions.moon.controllers;
  const { ctx, states } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async () => new Response(orb(10)),
  });
  try {
    eyesDefinitions.moon.controllers = [
      {
        type: "fixed",
        position: { constructor: "Vector3", values: [1, 0, 0] },
      },
      {
        type: "spin",
        axis: { expression: "Pioneer.Vector3.ZAxis" },
        periodInHours: 1,
      },
    ];
    await source.load(["moon", "sun"], 5);
    source.publishAt(5);
    const initial = (states.get("moon") as any).orientationWxyz;
    assert.deepEqual(initial, [1, 0, 0, 0]);
    const restore = source.checkpoint();
    source.retain(["sun"]);
    restore();
    source.publishAt(6);
    const shifted = (states.get("moon") as any).orientationWxyz;
    assert.ok(shifted[3] > 0);
    source.publishAt(5);
    assert.deepEqual((states.get("moon") as any).orientationWxyz, initial);
    assert.match(
      source.status("moon")?.orientationNote ?? "",
      /no absolute phase/,
    );
    source.retain(["sun"]);
    source.retain(["moon", "earth", "sun"]);
    await source.load(["moon"], 6);
    source.publishAt(6);
    assert.deepEqual((states.get("moon") as any)?.orientationWxyz, initial);
  } finally {
    source.dispose();
    eyesDefinitions.moon.controllers = original;
  }
});

test("finite trail budget shortens accelerating source arcs and retains exact source states", async () => {
  const { ctx } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async () => {
      const bytes = orb(2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < 2; i++) view.setFloat64(28 + i * 72 + 24, 0.01, true);
      return new Response(bytes);
    },
  });
  await source.load(["moon"], 5, []);
  const original = source.position.bind(source);
  // An accelerating curved evaluator has zero instantaneous velocity at epoch;
  // local-rate-only sizing misses all of its historical curvature.
  source.position = (id, t) => {
    if (id !== "moon") return original(id, t);
    const parent = original("earth", t);
    const phase = 4 * (t - 5) ** 2;
    return parent.map(
      (v, i) => v + [2 * Math.cos(phase), 2 * Math.sin(phase), 0][i],
    ) as [number, number, number];
  };
  const trail = source.trailSamples("moon", 5, 24);
  assert.ok(trail.points.length <= 24);
  assert.ok(trail.durationSeconds < 1);
  assert.ok(trail.epochsTdbSeconds.includes(5));
  assert.ok(trail.epochsTdbSeconds.at(-1)! > 5);
  for (let i = 0; i < trail.points.length; i++) {
    const t = trail.epochsTdbSeconds[i];
    assert.deepEqual(
      trail.points[i],
      source
        .position("moon", t)
        .map((v, k) => v - source.position("earth", t)[k]),
    );
    if (i && !trail.breakIndices.includes(i)) {
      assert.ok(
        Math.hypot(
          ...trail.points[i].map((v, k) => v - trail.points[i - 1][k]),
        ) <
          2 * 0.053,
      );
    }
  }
  source.dispose();
});

for (const mode of [
  "interior gap",
  "parent interior gap",
  "unresolved discontinuity",
] as const) {
  test(`trail never bridges ${mode} after bounded refinement`, async () => {
    const { ctx } = context();
    const source = new SolarSystemData(ctx, {
      fetch: async () => {
        const bytes = orb(2),
          view = new DataView(bytes.buffer);
        for (let i = 0; i < 2; i++)
          view.setFloat64(28 + i * 72 + 24, 0.01, true);
        return new Response(bytes);
      },
    });
    await source.load(["moon"], 5, []);
    const original = source.position.bind(source);
    source.position = (id, t) => {
      if (
        mode === "parent interior gap" &&
        id === "earth" &&
        t > 4.1 &&
        t < 4.2
      )
        throw Error("Synthetic parent coverage gap");
      if (id !== "moon") return original(id, t);
      if (mode === "interior gap" && t > 4.1 && t < 4.2)
        throw Error("Synthetic interior coverage gap");
      const parent = original("earth", t);
      const x = mode === "unresolved discontinuity" && t < 5 ? -2 : 2;
      return [parent[0] + x, parent[1], parent[2]];
    };
    const trail = source.trailSamples("moon", 5, 8);
    assert.ok(trail.points.length <= 8);
    assert.ok(trail.epochsTdbSeconds.includes(5));
    if (mode === "unresolved discontinuity") {
      const current = trail.epochsTdbSeconds.indexOf(5);
      assert.ok(current > 0);
      assert.ok(
        trail.breakIndices.includes(current),
        "unresolved jump must remain a line break",
      );
    } else {
      for (let i = 1; i < trail.epochsTdbSeconds.length; i++) {
        if (trail.breakIndices.includes(i)) continue;
        assert.ok(
          trail.epochsTdbSeconds[i] <= 4.1 ||
            trail.epochsTdbSeconds[i - 1] >= 4.2,
          "unbroken segment must not span known gap",
        );
      }
    }
    source.dispose();
  });
}

test("publication reuses parent evaluation only within its exact invocation", async () => {
  const { ctx } = context();
  const source = new SolarSystemData(ctx, {
    fetch: async (input) => String(input).includes("type=ori")
      ? new Response("", { status: 404 })
      : new Response(orb(String(input).includes("/moon?") ? 2 : 10)),
  });
  await source.load(["earth", "moon"], 5, []);
  let earthEvaluations = 0;
  const parentAt = source.parentAt.bind(source);
  source.parentAt = (id, epoch) => {
    if (id === "earth") earthEvaluations++;
    return parentAt(id, epoch);
  };
  source.position("earth", 5);
  const oneEvaluation = earthEvaluations;
  assert.ok(oneEvaluation > 0);
  earthEvaluations = 0;
  source.publishAt(5);
  assert.equal(earthEvaluations, oneEvaluation, "Earth and its child share one evaluation");
  earthEvaluations = 0;
  source.publishAt(5);
  assert.equal(earthEvaluations, oneEvaluation, "same epoch in a new invocation recomputes");
  earthEvaluations = 0;
  source.publishAt(6);
  assert.equal(earthEvaluations, oneEvaluation, "new exact epoch recomputes");
  earthEvaluations = 0;
  source.position("earth", 6);
  source.position("earth", 6);
  assert.equal(earthEvaluations, 2 * oneEvaluation, "public evaluations retain no cache");
  const restore = source.checkpoint();
  source.retain([]);
  assert.throws(() => source.position("earth", 6), /unavailable/);
  restore();
  earthEvaluations = 0;
  source.publishAt(6);
  assert.equal(earthEvaluations, oneEvaluation, "restored state recomputes");
  source.dispose();
  restore();
  assert.throws(() => source.position("earth", 6), /unavailable/);
});

test("non-orbital circular source uses local dynamics rather than its coverage length", async () => {
  const {ctx} = context();
  const bytes = new Uint8Array(76), view = new DataView(bytes.buffer);
  view.setInt16(0, 2, true);
  bytes.set([108,105,110,0,3,1], 2);
  view.setInt32(8, 2, true);
  view.setFloat64(44, 1000, true);
  view.setFloat64(52, 10, true);
  const originalTrail = eyesDefinitions.sc_voyager_1.trail;
  eyesDefinitions.sc_voyager_1.trail = undefined; // This fixture explicitly exercises the no-policy fallback.
  const source = new SolarSystemData(ctx, {fetch: async () => new Response(bytes)});
  try {
  await source.load(["sc_voyager_1"], 500, []);
  const original = source.position.bind(source);
  source.position = (id,t) => id === "sc_voyager_1"
    ? [100 * Math.cos(t * 2 * Math.PI / 100),100 * Math.sin(t * 2 * Math.PI / 100),0]
    : original(id,t);
  const trail = source.trailSamples("sc_voyager_1", 500, 160);
  assert.ok(Math.abs(trail.durationSeconds - 100) < 0.001);
  assert.ok(trail.points.length <= 160);
  assert.deepEqual(trail.breakIndices, []);
  } finally {
    source.dispose();
    eyesDefinitions.sc_voyager_1.trail = originalTrail;
  }
});

test("automatic deep-space spacecraft history is not truncated to 30 days or by point count", async () => {
  const {ctx} = context();
  const period = 300 * 86400;
  const epoch = 880000000;
  const source = new SolarSystemData(ctx, {fetch: async () => {
    const bytes = orb(1e8), view = new DataView(bytes.buffer);
    view.setFloat64(7, 1e24 * (2*Math.PI/period)**2, true);
    view.setFloat64(15, 0, true);
    for (let i=0; i<2; i++) {
      view.setFloat64(28+i*72, epoch - period*2 + i*period*4, true);
      view.setFloat64(28+i*72+24, 2*Math.PI/period, true);
      view.setFloat64(28+i*72+32, i*8*Math.PI, true);
    }
    return new Response(bytes);
  }});
  try {
    await source.load(["sc_psyche"], epoch, []);
    for (const count of [32, 128]) {
      const trail = source.trailSamples("sc_psyche", epoch, count);
      assert.ok(Math.abs(trail.durationSeconds-period) < 1, "NASA auto orbital period must survive budget");
      assert.equal(trail.drawRangeTdbSeconds[0], epoch-period);
      assert.ok(trail.epochsTdbSeconds[0]<epoch-period);
      assert.ok(trail.epochsTdbSeconds.at(-1)!>epoch);
      assert.ok(trail.points.length <= count);
    }
    const next=source.trailSamples("sc_psyche",epoch+1,128);
    assert.equal(next.drawEpochTdbSeconds,epoch+1);
    assert.ok(!next.epochsTdbSeconds.includes(epoch+1),"moving drawEnd must not reinsert a certified interior head");
    const headIndex=next.epochsTdbSeconds.findIndex(t=>t>epoch+1);
    assert.ok(headIndex>0 && !next.breakIndices.includes(headIndex),"exact live head remains inside contiguous scientific coverage");
    const predictiveWork=source.trailSampleSteps("sc_psyche",epoch,128,false,undefined,period/2);
    let predictiveStep=predictiveWork.next();while(!predictiveStep.done)predictiveStep=predictiveWork.next();
    const predictive=predictiveStep.value;
    assert.equal(predictive.durationSeconds,source.trailSamples("sc_psyche",epoch,128).durationSeconds);
    assert.equal(predictive.drawRangeTdbSeconds[0],epoch-period);
    assert.equal(predictive.drawRangeTdbSeconds[1],epoch);
    assert.ok(predictive.epochsTdbSeconds[0]<=epoch-period*1.5);
    assert.ok(predictive.epochsTdbSeconds.at(-1)!>=epoch+period*.5);
    assert.ok(predictive.points.length<=3*128,"independent guards have a bounded additive allocation");
    const {adaptiveTrailTimes}=await import("../adaptive-trail.ts");
    const visible=adaptiveTrailTimes(epoch-period,epoch,epoch,128,t=>source.position("sc_psyche",t),period);
    assert.deepEqual(predictive.epochsTdbSeconds.filter(t=>t>=epoch-period && t<=epoch),visible.times,"visible allocation is independent of additional guard work");
  } finally { source.dispose(); }
});

test("orb automatic history uses interpolated eccentricity, combined mu and local state rather than mean motion", async () => {
 const {ctx}=context();
 const epoch=880000000, span=100000;
 const original=eyesDefinitions.sc_psyche.trail;
 eyesDefinitions.sc_psyche.trail=undefined;
 const source=new SolarSystemData(ctx,{fetch:async()=>{
   const bytes=orb(100),view=new DataView(bytes.buffer);
   view.setFloat64(7,200,true);view.setFloat64(15,100,true);
   for(let i=0;i<2;i++) {
     const p=28+i*72;
     [epoch-span+i*2*span,100,0.2+i*0.4,0.02,-span*0.02+i*2*span*0.02,1,0,0,0]
       .forEach((x,j)=>view.setFloat64(p+j*8,x,true));
   }
   return new Response(bytes);
 }});
 try {
   await source.load(["sc_psyche"],epoch,[]);
   for(const t of [epoch-100,epoch,epoch+100]) {
     const r=source.position("sc_psyche",t),v=source.sourceVelocity("sc_psyche",t);
     const h2=Math.hypot(r[1]*v[2]-r[2]*v[1],r[2]*v[0]-r[0]*v[2],r[0]*v[1]-r[1]*v[0])**2;
     const e=0.2+0.4*((t-(epoch-span))/(2*span));
     const energy=-(300**2)*(1-e*e)/(2*h2);
     const expected=2*Math.PI*300/Math.sqrt(8*Math.abs(Math.min(1,energy**3)));
     const trail=source.trailSamples("sc_psyche",t,32);
     assert.ok(Math.abs(trail.durationSeconds-expected)<expected*1e-12,`${trail.durationSeconds} != ${expected}`);
     assert.ok(trail.points.length<=32);
   }
   eyesDefinitions.sc_psyche.trail={length:500};
   assert.equal(source.trailSamples("sc_psyche",epoch,32).durationSeconds,500,"authored duration remains authoritative");
 }finally{source.dispose();eyesDefinitions.sc_psyche.trail=original;}
});

test("automatic spacecraft histories remain publishable for radial and stationary limits", async () => {
  const {ctx} = context();
  const epoch = 880000000;
  const bytes = new Uint8Array(76), view = new DataView(bytes.buffer);
  view.setInt16(0,2,true); bytes.set([108,105,110,0,3,1],2); view.setInt32(8,2,true);
  view.setFloat64(12,epoch-1e7,true); view.setFloat64(44,epoch+1e7,true);
  const source = new SolarSystemData(ctx,{fetch:async()=>new Response(bytes)});
  try {
    await source.load(["sc_psyche"],epoch,[]);
    for(const velocity of [[1,1e-12,0],[0,0,0],[1e-20,0,0]]) {
      source.position = (id,t) => id === "sc_psyche"
        ? [100+(t-epoch)*velocity[0],(t-epoch)*velocity[1],0] : [0,0,0];
      const trail=source.trailSamples("sc_psyche",epoch,32);
      assert.ok(Number.isFinite(trail.durationSeconds) && trail.durationSeconds >= 1 && trail.durationSeconds <= 946080000);
      assert.ok(trail.points.length <= 32);
    }
  } finally {source.dispose();}
});

test("known ORI root coverage skips its controller without erasing prior align", async () => {
  const old=eyesDefinitions.earth.controllers;
  try {
    eyesDefinitions.earth.controllers=[{type:"align",primary:{type:"point",target:"sun",axis:{expression:"Pioneer.Vector3.XAxis"}}},{type:"dynamo",url:"earth/ori"}];
    const {ctx,states}=context();
    const source=new SolarSystemData(ctx,{fetch:async input=>String(input).includes("type=ori")
      ?new Response("outside",{status:502,headers:{"x-dyn-orientation-coverage":"[100,110]"}}):new Response(orb(10))});
    try {await source.load(["earth"],5);source.publishAt(5);
      assert.equal(source.status("earth")?.orientationStatus,"ready");
      assert.equal(source.status("earth")?.orientationSource,"derived");
      assert.ok((states.get("earth") as any).orientationWxyz);
      source.publishAt(6);assert.equal(source.status("earth")?.orientationStatus,"ready");
      assert.equal(source.needsOrientationRefresh("earth",6),false);
      assert.equal(source.needsOrientationRefresh("earth",100),true);
      assert.equal(source.needsOrientationRefresh("earth",110),true);
      assert.equal(source.needsOrientationRefresh("earth",111),false);
      const restore=source.checkpoint();source.retain([]);
      assert.equal(source.needsOrientationRefresh("earth",100),false);restore();
      assert.equal(source.needsOrientationRefresh("earth",100),true);
    }finally{source.dispose();}
  }finally{eyesDefinitions.earth.controllers=old;}
});

test("ORI absence and failures never fabricate a body orientation", async () => {
 const old=eyesDefinitions.earth.controllers;
 try {
  for(const mode of ["only-ori","joint-only","network","malformed-bounds","decode"]) {
   const align={type:"align",primary:{type:"point",target:"sun",axis:{expression:"Pioneer.Vector3.XAxis"}}};
   eyesDefinitions.earth.controllers=mode === "joint-only" ? [{...align,joint:"Array"},{type:"dynamo",url:"earth/ori"}]
     : mode === "only-ori" ? [{type:"dynamo",url:"earth/ori"}] : [align,{type:"dynamo",url:"earth/ori"}];
   const {ctx,states}=context();
   const source=new SolarSystemData(ctx,{fetch:async input=>{
    if(!String(input).includes("type=ori"))return new Response(orb(10));
    if(mode==="network")throw Error("network offline");
    if(mode==="decode")return new Response(new Uint8Array([1,2,3]));
    return new Response("outside",{status:502,headers:{"x-dyn-orientation-coverage":mode==="malformed-bounds"?"[110,100]":"[100,110]"}});
   }});
   try {await source.load(["earth"],5);source.publishAt(5);
    assert.equal(source.status("earth")?.orientationStatus,"unavailable",mode);
    assert.equal((states.get("earth") as any).orientationWxyz,undefined,mode);
   }finally{source.dispose();}
  }
 }finally{eyesDefinitions.earth.controllers=old;}
});
test("valid ORI still overrides align in source controller order", async()=>{
 const old=eyesDefinitions.earth.controllers;
 try {
  eyesDefinitions.earth.controllers=[{type:"align",primary:{type:"point",target:"sun",axis:{expression:"Pioneer.Vector3.XAxis"}}},{type:"dynamo",url:"earth/ori"}];
  const {ctx,states}=context();const source=new SolarSystemData(ctx,{fetch:async input=>new Response(String(input).includes("type=ori")?orientation():orb(10))});
  try{await source.load(["earth"],5);source.publishAt(5);assert.deepEqual((states.get("earth") as any).orientationWxyz,[1,0,0,0]);assert.equal(source.status("earth")?.orientationSource,"dyn");}finally{source.dispose();}
 }finally{eyesDefinitions.earth.controllers=old;}
});

test("actual LRO and Psyche align definitions remain valid outside their optional ORI epochs", async()=>{
 const epoch=846724000;
 for(const id of ["sc_lunar_reconnaissance_orbiter","sc_psyche"]) {
  const {ctx,states}=context();
  const source=new SolarSystemData(ctx,{fetch:async input=>{
   const url=String(input);
   if(url.includes("type=ori")) return new Response("outside",{status:502,headers:{"x-dyn-orientation-coverage":"[0,10]"}});
   const bytes=orb(url.includes("/sc_")?2:10000),v=new DataView(bytes.buffer);
   for(let i=0;i<2;i++) {v.setFloat64(28+i*72,-4e9+i*8e9,true);v.setFloat64(28+i*72+24,1e-5,true);v.setFloat64(28+i*72+32,i*8e4,true);}
   return new Response(bytes);
  }});
  try {await source.load([id],epoch,[id]);source.publishAt(epoch);
   assert.equal(source.status(id)?.orientationStatus,"ready",id+": "+source.status(id)?.orientationError);
   assert.equal(source.status(id)?.orientationSource,"derived");
   assert.ok((states.get(id) as any).orientationWxyz.every(Number.isFinite));
   if(id==="sc_psyche")assert.ok(source.jointAims(id,epoch).length>0);
  }finally{source.dispose();}
 }
});

test("private mission history crosses parent phases in the current frame without mutating published state", async () => {
 const {ctx,states}=context();
 const boundary=139219264.185, epoch=boundary+1000;
 let jump = false, broken = false, requests = 0;
 const original=eyesDefinitions.sc_cassini.trail;
 eyesDefinitions.sc_cassini.trail={length:2000};
 const source=new SolarSystemData(ctx,{fetch:async input=>{
   requests++;
   if (broken) throw Error("historical source offline");
   const url=new URL(String(input),"http://localhost"), t=Number(url.searchParams.get("epoch"));
   const craft=url.pathname.endsWith("/sc_cassini");
   const radius=craft?(t<boundary?(jump?2010:1010):10):1000;
   const bytes=new Uint8Array(76),v=new DataView(bytes.buffer);
   v.setInt16(0,2,true);bytes.set([108,105,110,0,3,1],2);v.setInt32(8,2,true);
   for(let i=0;i<2;i++){v.setFloat64(12+i*32,boundary-10000+i*20000,true);v.setFloat64(20+i*32,radius,true);}
   return new Response(bytes);
 }});
 try {
   await source.load(["sc_cassini"],epoch,[]);source.publishAt(epoch);
   const published=JSON.stringify([...states]), position=source.position("sc_cassini",epoch);
   const local=source.trailSamples("sc_cassini",epoch,32);
   assert.equal(local.epochsTdbSeconds[0],boundary);
   assert.equal(await source.prepareTrailHistory("sc_cassini",epoch),true);
   const history=source.trailSamples("sc_cassini",epoch,32);
   assert.equal(history.drawRangeTdbSeconds[0],epoch-2000);
   assert.ok(history.epochsTdbSeconds[0]<history.drawRangeTdbSeconds[0]);
   assert.ok(history.epochsTdbSeconds.at(-1)!>epoch);
   assert.ok(history.epochsTdbSeconds.includes(boundary));
   for(const point of history.points) assert.deepEqual(point,[10,0,0]);
   assert.deepEqual(source.position("sc_cassini",epoch),position);
   assert.equal(JSON.stringify([...states]),published);
   const preparedRequests = requests;
   for (const offset of [-1, -50, 20, -60, -2000/32, 2000/32]) {
     const t = epoch + offset;
     const reused = source.trailSamples("sc_cassini",t,32);
     assert.ok(reused.refreshRange[0]<t && reused.refreshRange[1]>t,"cosmetic reuse band extends both directions independently of draw end");
     assert.equal(reused.drawRangeTdbSeconds[0],t-2000,"reverse playback retains the complete requested history window");
     assert.equal(reused.drawRangeTdbSeconds[1],t,"source default end time remains the current epoch");
     assert.equal(await source.prepareTrailHistory("sc_cassini",t),false,"valid prepared history is reused in both directions");
     assert.equal(requests,preparedRequests,"changing playback direction must not fetch historical sources again");
     for (const point of reused.points) assert.deepEqual(point,[10,0,0]);
   }
   assert.equal(JSON.stringify([...states]),published);
   assert.equal(await source.prepareTrailHistory("sc_cassini",epoch+100),true,"leaving the reuse band prepares a new history");
   await source.load(["sc_cassini"],boundary-20,[]);
   assert.equal(await source.prepareTrailHistory("sc_cassini",boundary-20),false,"changed frame with complete past coverage does not need private history");
   assert.equal(source.trailSamples("sc_cassini",boundary-20,32).originId,"sun");
   await source.load(["sc_cassini"],epoch,[]);
   assert.equal(await source.prepareTrailHistory("sc_cassini",epoch),true);
   eyesDefinitions.sc_cassini.trail={length:2000,lengthCoverages:[[1800,epoch-10,epoch+10]]};
   assert.equal(await source.prepareTrailHistory("sc_cassini",epoch),true,"changed authored duration invalidates history even at the same epoch");
   assert.equal(source.trailSamples("sc_cassini",epoch,32).drawRangeTdbSeconds[0],epoch-1800);
   eyesDefinitions.sc_cassini.trail={length:2000};
   source.clearTrailHistory();
   const localRequests = requests;
   assert.equal(await source.prepareTrailHistory("sc_cassini",boundary+5000),false,"complete main-source coverage does not need private history");
   assert.equal(requests,localRequests);
   jump = true;
   await source.prepareTrailHistory("sc_cassini",epoch);
   assert.ok(source.trailSamples("sc_cassini",epoch,32).breakIndices.length > 0, "discontinuous source handoff must break the line");
   source.clearTrailHistory();
   assert.equal(source.trailSamples("sc_cassini",epoch,32).epochsTdbSeconds[0],boundary);
   broken = true;
   await assert.rejects(source.prepareTrailHistory("sc_cassini",epoch));
   assert.doesNotThrow(() => source.trailSamples("sc_cassini",epoch,32));
   assert.deepEqual(source.position("sc_cassini",epoch),position);
 }finally{source.dispose();eyesDefinitions.sc_cassini.trail=original;}
});

test("an expired valid ORI segment requests the next segment without a known-absence record", async () => {
 const {ctx,states}=context();let requests=0;
 const source=new SolarSystemData(ctx,{fetch:async input=>{
   const url=String(input);
   if(url.includes("type=ori")){requests++;return new Response(orientation(Number(new URL(url,"http://localhost").searchParams.get("epoch"))<10?0:10));}
   const bytes=orb(10);new DataView(bytes.buffer).setFloat64(100,20,true);return new Response(bytes);
 }});
 try {
   await source.load(["earth"],5);source.publishAt(5);
   assert.equal(source.needsOrientationRefresh("earth",5),false);
   assert.equal(source.needsOrientationRefresh("earth",11),true);
   const before=JSON.stringify([...states]);
   await source.refreshOrientation("earth",11);
   assert.equal(requests,2);
   assert.equal(source.needsOrientationRefresh("earth",11),false);
   assert.equal(JSON.stringify([...states]),before);
 } finally {source.dispose();}
});
test('trail sampling exposes a resumable generator and historical orientation API',()=>{
 const {ctx}=context();const source=new SolarSystemData(ctx);
 assert.equal(typeof source.trailSampleSteps,'function');
 assert.equal(typeof source.orientation,'function');source.dispose();
});
import { TrailHistory } from '../trail-history.ts';
test('history inverse-rotates each sample by reference attitude at its historical epoch',async()=>{
 const requests:readonly string[][]=[] as any;
 const manager=new TrailHistory({parentAt:()=>null,boundaries:()=>[],createSource:()=>({
  async load(ids,t,orientationIds){(requests as string[][]).push([...orientationIds]);},
  position(id,t){return id==='craft'?[1,0,0]:[0,0,0];},
  orientation(id,t){return t===0?[1,0,0,0]:[Math.SQRT1_2,0,0,Math.SQRT1_2];},
  coverage:()=>[0,10],dispose(){},
 })});
 try {const history=await manager.prepare('craft',5,0,10,'reference',undefined,{referenceOrientation:true});
 assert.deepEqual(requests,[['reference']]);assert.deepEqual(history.position(0),[1,0,0]);
 const p=history.position(5);assert.ok(Math.abs(p[0])<1e-12);assert.ok(Math.abs(p[1]+1)<1e-12);
 }finally{manager.dispose();}
});
import trailPhases from '../eyes-trail-phases.json' with {type:'json'};
test('authored past-only windows clamp sampling anchor and retain exact draw interval',async()=>{
 const {ctx}=context(),epoch=880000000;
 const original=eyesDefinitions.sc_psyche.trail;
 eyesDefinitions.sc_psyche.trail={length:1000};
 const slot:any={entity:'sc_psyche',controllerIndex:100,coverage:['-Infinity','Infinity'],phase:'enter',sourceSha256:'test',patch:{endTime:-100}};
 trailPhases.slots.push(slot);
 const source=new SolarSystemData(ctx,{fetch:async()=>{
 const bytes=orb(100),v=new DataView(bytes.buffer);for(let i=0;i<2;i++){v.setFloat64(28+i*72,epoch-2000+i*4000,true);v.setFloat64(28+i*72+24,.001,true);}return new Response(bytes);
 }});
 try{await source.load(['sc_psyche'],epoch,[]);
 const trail=source.trailSamples('sc_psyche',epoch,32);
 assert.deepEqual(trail.drawRangeTdbSeconds,[epoch-1000,epoch-100]);
 assert.ok(trail.epochsTdbSeconds.includes(trail.drawRangeTdbSeconds[0]));
 assert.ok(trail.epochsTdbSeconds.includes(trail.drawRangeTdbSeconds[1]));
 assert.equal(trail.drawEpochTdbSeconds,epoch);
 assert.equal(trail.drawRelativeEnd,true);
 assert.ok(trail.epochsTdbSeconds.at(-1)!>epoch-100);
 assert.ok(!trail.epochsTdbSeconds.includes(epoch));
 slot.patch={startTime:100,startTimeMultiplier:-1,endTime:100,endTimeMultiplier:2};
 const future=source.trailSamples('sc_psyche',epoch,32);
 assert.deepEqual(future.drawRangeTdbSeconds,[epoch+100,epoch+200]);
 assert.ok(future.epochsTdbSeconds[0]<epoch+100);
 assert.ok(future.epochsTdbSeconds.at(-1)!>epoch+200);
 assert.ok(!future.epochsTdbSeconds.includes(epoch));
 slot.patch={startTime:4000,endTime:0};
 const clipped=source.trailSamples('sc_psyche',epoch,32);
 assert.equal(clipped.drawRangeTdbSeconds[0],epoch-4000);
 assert.equal(clipped.epochsTdbSeconds[0],epoch-2000);
 const advanced=source.trailSamples('sc_psyche',epoch+10,32);
 assert.equal(advanced.drawRangeTdbSeconds[0],epoch+10-4000);
 assert.equal(advanced.epochsTdbSeconds[0],epoch-2000,'scientific edge stays fixed as raw relative edge advances');
 slot.patch={startTime:epoch,relativeStartTime:false,endTime:0};
 assert.equal(source.hasTrajectory('sc_psyche',epoch),false);
 }finally{source.dispose();trailPhases.slots.pop();eyesDefinitions.sc_psyche.trail=original;}
});
test('fixed LLA reference orientation is derived from source landing frame rather than absent ORI',()=>{
 const {ctx}=context();const source=new SolarSystemData(ctx);
 eyesDefinitions.test_ground={parents:[[-100,'test_ground_parent']],controllers:[{type:'fixed',llaOnSpheroid:{constructor:'LatLonAlt',values:[0,0,0]}}]};
 eyesDefinitions.test_ground_parent={spheroid:{equatorialRadius:10,polarRadius:10,planetographic:true},controllers:[{type:'fixed',orientation:{constructor:'Quaternion',values:[1,0,0,0]}}]};
 try{assert.deepEqual(source.orientation('test_ground',0),[.5,.5,.5,.5]);}finally{source.dispose();delete eyesDefinitions.test_ground;delete eyesDefinitions.test_ground_parent;}
});
test('reviewed Huygens landing keyframes load without requesting uncovered spacecraft DYN',async()=>{
 const {ctx,states}=context(),original=eyesDefinitions.titan;
 eyesDefinitions.titan={parents:[],controllers:[{type:'fixed',position:{constructor:'Vector3',values:[1000,0,0]},orientation:{constructor:'Quaternion',values:[1,0,0,0]}}]};
 const source=new SolarSystemData(ctx,{fetch:async()=>{throw Error('unexpected DYN');}});
 try{
 const t=158965617.707;await source.load(['sc_huygens'],t,[]);
 assert.equal(source.status('sc_huygens')?.status,'ready');
 const p=source.position('sc_huygens',t);
 assert.ok(p[0]>900 && p[0]<1000,JSON.stringify(p));
 assert.equal(source.hasTrajectory('sc_huygens',t),true);
 const trail=source.trailSamples('sc_huygens',t,32,true);
 assert.equal(trail.originId,'titan');assert.equal(trail.referenceOrientation,true);
 source.publishAt(t);
 assert.match(String((states.get('sc_huygens') as any)?.source),/NASA reviewed position keyframes/);
 const end=158974766.184;
 await source.load(['sc_huygens'],end-1,[]);
 const before=source.position('sc_huygens',end-1);
 await source.load(['sc_huygens'],end,[]);
 const at=source.position('sc_huygens',end);
 assert.equal(source.parentAt('sc_huygens',end),'titan');
 assert.ok(Math.hypot(...at.map((x,i)=>x-before[i]))<1,'closed keyframe endpoint retains explicit Titan frame');
 assert.equal(source.trailSamples('sc_huygens',end,32,true).originId,'titan');
 }finally{source.dispose();eyesDefinitions.titan=original;}
});
test('InSight landed LLA orientation overrides earlier uncovered ORI without requesting it',async()=>{
 const {ctx}=context(),old=eyesDefinitions.mars;
 eyesDefinitions.mars={spheroid:{equatorialRadius:3396.19,polarRadius:3376.2,planetographic:false},controllers:[{type:'fixed',position:{constructor:'Vector3',values:[1e8,0,0]},orientation:{constructor:'Quaternion',values:[1,0,0,0]}}]};
 const source=new SolarSystemData(ctx,{fetch:async()=>{throw Error('earlier ORI must not be fetched after fixed LLA overrides');}});
 try{await source.load(['sc_insight'],596533603,['sc_insight']);assert.equal(source.status('sc_insight')?.orientationStatus,'ready');assert.ok(source.orientation('sc_insight',596533603).every(Number.isFinite));assert.equal(source.hasTrajectory('sc_insight',596533603),false);}
 finally{source.dispose();eyesDefinitions.mars=old;}
});

test('ORI cache identity and source ordering survive forward/reverse covered-stage switches',async()=>{
 const old=eyesDefinitions.earth.controllers;
 eyesDefinitions.earth.controllers=[{type:'dynamo',url:'earth/a/ori'},{type:'dynamo',url:'earth/b/ori',coverage:[4,6]}];
 const {ctx}=context();let requests=0;
 const source=new SolarSystemData(ctx,{fetch:async input=>{
  const url=String(input);if(!url.includes('type=ori'))return new Response(orb(10));
  requests++;const t=Number(new URL(url,'http://localhost').searchParams.get('epoch')),b=t>=4&&t<=6;const bytes=orientation(),v=new DataView(bytes.buffer);
  if(b)for(let i=0;i<2;i++){v.setFloat64(20+i*64,0,true);v.setFloat64(44+i*64,1,true);}
  return new Response(bytes,{headers:{'x-dyn-controller-selection':JSON.stringify({track:b?'earth/b/ori':'earth/a/ori'})}});
 }});
 try{
  await source.load(['earth'],3);assert.deepEqual(source.orientation('earth',3),[1,0,0,0]);
  const restore=source.checkpoint();
  for(const t of [4,6.001,5,3]){assert.equal(source.needsOrientationRefresh('earth',t),true);await source.refreshOrientation('earth',t);assert.deepEqual(source.orientation('earth',t),t>=4&&t<=6?[0,0,0,1]:[1,0,0,0]);}
  assert.equal(requests,5);source.retain([]);restore();assert.deepEqual(source.orientation('earth',3),[1,0,0,0]);assert.equal(source.needsOrientationRefresh('earth',4),true);
 }finally{source.dispose();eyesDefinitions.earth.controllers=old;}
});
test('ORI effective cache domain refreshes an overlapping source despite unchanged declared set',async()=>{
 const old=eyesDefinitions.earth.controllers;eyesDefinitions.earth.controllers=[{type:'dynamo',url:'earth/a/ori'},{type:'dynamo',url:'earth/b/ori'}];
 const {ctx}=context();const source=new SolarSystemData(ctx,{fetch:async input=>new Response(String(input).includes('type=ori')?orientation():orb(10),String(input).includes('type=ori')?{headers:{'x-dyn-controller-selection':JSON.stringify({track:'earth/a/ori',upperExclusive:4})}}:{})});
 try{await source.load(['earth'],3);assert.equal(source.needsOrientationRefresh('earth',3.5),false);assert.equal(source.needsOrientationRefresh('earth',4),true);assert.throws(()=>source.orientation('earth',4),/orientation/i);}
 finally{source.dispose();eyesDefinitions.earth.controllers=old;}
});
test('ORI proven multi-source absence retains fixed attitude only inside its open domain',async()=>{
 const old=eyesDefinitions.earth.controllers;eyesDefinitions.earth.controllers=[{type:'fixed',orientation:{constructor:'Quaternion',values:[1,0,0,0]}},{type:'dynamo',url:'earth/a/ori'},{type:'dynamo',url:'earth/b/ori'}];
 const {ctx}=context();const source=new SolarSystemData(ctx,{fetch:async input=>String(input).includes('type=ori')?new Response('outside',{status:502,headers:{'x-dyn-orientation-absence':JSON.stringify({track:'orientation-absence',lowerExclusive:2,upperExclusive:8})}}):new Response(orb(10))});
 try{await source.load(['earth'],5);assert.equal(source.status('earth')?.orientationStatus,'ready');assert.deepEqual(source.orientation('earth',5),[1,0,0,0]);assert.equal(source.needsOrientationRefresh('earth',6),false);assert.equal(source.needsOrientationRefresh('earth',2),true);assert.equal(source.needsOrientationRefresh('earth',8),true);assert.throws(()=>source.orientation('earth',8),/orientation/i);}
 finally{source.dispose();eyesDefinitions.earth.controllers=old;}
});

test('ORI selected earlier source is not replayed at an uncovered later slot after align',async()=>{
 const old=eyesDefinitions.earth.controllers;eyesDefinitions.earth.controllers=[{type:'dynamo',url:'earth/a/ori'},{type:'align',primary:{type:'point',target:'sun',axis:{expression:'Pioneer.Vector3.XAxis'}}},{type:'dynamo',url:'earth/b/ori'}];
 const {ctx}=context();const source=new SolarSystemData(ctx,{fetch:async input=>String(input).includes('type=ori')?new Response(orientation(),{headers:{'x-dyn-controller-selection':JSON.stringify({track:'earth/a/ori',upperExclusive:20})}}):new Response(orb(10))});
 try{await source.load(['earth'],5);assert.deepEqual(source.orientation('earth',5),[0,0,0,1]);}finally{source.dispose();eyesDefinitions.earth.controllers=old;}
});
test('unproven ORI absence or foreign controller metadata cannot fabricate valid attitude',async()=>{
 const old=eyesDefinitions.earth.controllers;eyesDefinitions.earth.controllers=[{type:'fixed',orientation:{constructor:'Quaternion',values:[1,0,0,0]}},{type:'dynamo',url:'earth/a/ori'},{type:'dynamo',url:'earth/b/ori'}];
 try{for(const mode of ['wrong-domain','empty-domain','foreign-track','missing-track']){
  const {ctx,states}=context();const source=new SolarSystemData(ctx,{fetch:async input=>{
   if(!String(input).includes('type=ori'))return new Response(orb(10));
   if(mode==='foreign-track'||mode==='missing-track')return new Response(orientation(),mode==='foreign-track'?{headers:{'x-dyn-controller-selection':JSON.stringify({track:'foreign/ori'})}}:{});
   return new Response('bad',{status:502,headers:{'x-dyn-orientation-absence':JSON.stringify(mode==='wrong-domain'?{track:'orientation-absence',lowerExclusive:6,upperExclusive:8}:{track:'orientation-absence'})}});
  }});
  try{await source.load(['earth'],5);source.publishAt(5);assert.equal(source.status('earth')?.orientationStatus,'unavailable',mode);assert.equal((states.get('earth') as any).orientationWxyz,undefined,mode);}finally{source.dispose();}
 }}finally{eyesDefinitions.earth.controllers=old;}
});

test('ORI multi-source absence shares the 256-object budget and retain/rollback lifecycle',async()=>{
 const originalLength=solarCatalog.length,ids=Array.from({length:257},(_,i)=>'test_ori_budget_'+i);
 for(const id of ids){solarCatalog.push({...solarCatalog.find(x=>x.id==='earth')!,id,orbPath:undefined,parentId:null} as any);eyesDefinitions[id]={parents:[],controllers:[{type:'fixed',position:{constructor:'Vector3',values:[10,0,0]},orientation:{constructor:'Quaternion',values:[1,0,0,0]}},{type:'dynamo',url:id+'/a/ori'},{type:'dynamo',url:id+'/b/ori'}]};}
 const {ctx}=context();const source=new SolarSystemData(ctx,{fetch:async()=>new Response('outside',{status:502,headers:{'x-dyn-orientation-absence':JSON.stringify({track:'orientation-absence',lowerExclusive:2,upperExclusive:8})}})});
 try{
  for(const id of ids.slice(0,256)){await source.load([id],5);assert.equal(source.status(id)?.orientationStatus,'ready');}
  await source.load([ids[256]],5);assert.equal(source.status(ids[256])?.orientationStatus,'unavailable');assert.match(source.status(ids[256])?.orientationError??'',/budget/i);
  const restore=source.checkpoint();source.retain([ids[256]]);await source.load([ids[256]],5);assert.equal(source.status(ids[256])?.orientationStatus,'ready');restore();await source.load([ids[256]],5);assert.equal(source.status(ids[256])?.orientationStatus,'unavailable');
 }finally{source.dispose();solarCatalog.splice(originalLength);for(const id of ids)delete eyesDefinitions[id];}
});


test("same-track DYN replacement and retain release retained scientific sampling", async () => {
  const {ctx}=context();
  let wide=false;
  const source=new SolarSystemData(ctx,{fetch:async()=>{
    const bytes=orb(wide?20:2);
    for(let i=0;i<2;i++)new DataView(bytes.buffer).setFloat64(28+i*72+24,.1,true);
    if(wide)new DataView(bytes.buffer).setFloat64(28+72,30,true);
    return new Response(bytes);
  }});
  try {
    await source.load(["moon"],5,[]);
    source.trailSamples("moon",5,32);
    assert.equal(source.cacheStats().trailSamplingEntries,1);
    await source.load(["mars"],5,[]);
    assert.equal(source.cacheStats().trailSamplingEntries,1,"unrelated DYN loading preserves retained Moon work");
    wide=true;
    await source.load(["moon"],20,[]);
    assert.equal(source.cacheStats().trailSamplingEntries,0,"new coverage payload invalidates old scientific certificates");
    source.trailSamples("moon",20,32);
    assert.equal(source.cacheStats().trailSamplingEntries,1);
    source.retain([]);
    assert.equal(source.cacheStats().trailSamplingEntries,0);
  } finally {source.dispose();}
});


test("active scientific trail rejects source replacement between cooperative steps and retries",async()=>{
  const {latestTrajectory}=await import("../../web/lib/trajectory-work.ts");
  const {ctx}=context();
  let radius=2,builds=0;
  const source=new SolarSystemData(ctx,{fetch:async()=>{
    const bytes=orb(radius);
    for(let i=0;i<2;i++)new DataView(bytes.buffer).setFloat64(28+i*72+24,.1,true);
    return new Response(bytes);
  }});
  try {
    await source.load(["moon"],5,[]);
    const work=latestTrajectory(()=>5,epoch=>{builds++;return source.trailSampleSteps("moon",epoch,32);},value=>value.sourceCurrent)();
    assert.equal(work.next().done,false);
    source.retain([]);
    radius=20;
    source.retain(["moon","earth","sun"]);
    await source.load(["moon"],5,[]);
    let result=work.next();while(!result.done)result=work.next();
    assert.equal(builds,2);
    assert.equal(result.value.sourceCurrent,true);
    for(let i=0;i<result.value.points.length;i++) {
      const at=result.value.epochsTdbSeconds[i];
      const expected=source.position("moon",at).map((v,j)=>v-source.position("earth",at)[j]);
      assert.ok(result.value.points[i].every((v,j)=>Math.abs(v-expected[j])<1e-9));
    }
    source.retain([]);
    assert.equal(result.value.sourceCurrent,false,"even completed ready work is invalidated before publication");
  } finally {source.dispose();}
});


test("prepared-history gap fallback remains current instead of retrying forever",async()=>{
  const {TrailHistory}=await import("../trail-history.ts");
  const original=TrailHistory.prototype.prepare;
  const {ctx}=context(),epoch=880000000;
  const source=new SolarSystemData(ctx,{fetch:async()=>{
    const bytes=orb(1e8),view=new DataView(bytes.buffer);
    for(let i=0;i<2;i++) {
      view.setFloat64(28+i*72,epoch-1000000+i*2000000,true);
      view.setFloat64(28+i*72+24,.001,true);
    }
    return new Response(bytes);
  }});
  TrailHistory.prototype.prepare=async function(...args) {
    const prepared=await original.apply(this,args);
    const position=prepared.position;
    let checked=false;
    return {...prepared,position:(time:number)=>{
      if(checked)throw Error("prepared source gap");
      checked=true;
      return position(time);
    }};
  };
  try {
    await source.load(["sc_psyche"],epoch,[]);
    assert.equal(await source.prepareTrailHistory("sc_psyche",epoch),true);
    const fallback=source.trailSamples("sc_psyche",epoch,64);
    assert.equal(fallback.sourceCurrent,true);
    assert.ok(fallback.points.length>=2);
  } finally {TrailHistory.prototype.prepare=original;source.dispose();}
});


test("adjacent real DYN prefetch preserves the current ready interval and stitches continuous source evidence",async()=>{
  const {ctx}=context();
  let conflict=false,gap=false;
  const source=new SolarSystemData(ctx,{fetch:async input=>{
    const at=Number(new URL(String(input),"http://fixture").searchParams.get("epoch"));
    const bytes=orb(2),view=new DataView(bytes.buffer);
    if(at>10)for(let i=0;i<2;i++)view.setFloat64(28+i*72,(gap?11:10)+i*10,true);
    if(conflict && at>10)view.setFloat64(28+8,3,true);
    return new Response(bytes);
  }});
  try {
    await source.load(["moon"],5,[]);
    const old=source.position("moon",5);
    assert.equal(await source.prefetchPosition("earth",11,5,20),true);
    assert.equal(await source.prefetchPosition("moon",11,5,20),true);
    assert.equal(source.status("moon")?.status,"ready");
    assert.deepEqual(source.coverage("moon"),[0,20]);
    assert.deepEqual(source.position("moon",5),old);
    assert.ok(source.position("moon",15).every(Number.isFinite));
    assert.ok(source.cacheStats().records<=1000000);
  } finally {source.dispose();}
  for(const mode of ["conflict","gap"]) {
    conflict=mode==="conflict";gap=mode==="gap";
    const rejected=new SolarSystemData(ctx,{fetch:async input=>{
      const at=Number(new URL(String(input),"http://fixture").searchParams.get("epoch"));
      const bytes=orb(2),view=new DataView(bytes.buffer);
      if(at>10)for(let i=0;i<2;i++)view.setFloat64(28+i*72,(gap?11:10)+i*10,true);
      if(conflict && at>10)view.setFloat64(28+8,3,true);
      return new Response(bytes);
    }});
    try {
      await rejected.load(["moon"],5,[]);
      assert.equal(await rejected.prefetchPosition("moon",11,5,20),false,mode);
      assert.deepEqual(rejected.coverage("moon"),[0,10]);
    } finally {rejected.dispose();}
  }
});


test("mesh-only ORI loads preserve trails while sampled rotating-reference ORI invalidates them",async()=>{
  for(const rotating of [false,true]) {
    const {ctx}=context(),oldMoon=eyesDefinitions.moon.controllers,oldEarth=eyesDefinitions.earth.controllers;
    const source=new SolarSystemData(ctx,{fetch:async input=>{
      const text=String(input),at=Number(new URL(text,"http://fixture").searchParams.get("epoch"));
      if(text.includes("type=ori"))return new Response(orientation(at>10?10:0));
      const bytes=orb(2),view=new DataView(bytes.buffer);
      view.setFloat64(28+72,30,true);
      for(let i=0;i<2;i++)view.setFloat64(28+i*72+24,.1,true);
      return new Response(bytes);
    }});
    try {
      eyesDefinitions.earth.controllers=[{type:"dynamo",url:"earth/sun"},{type:"dynamo",url:"earth/ori"}];
      eyesDefinitions.moon.controllers=[{type:"dynamo",url:"moon/earth"},{type:"dynamo",url:"moon/ori"},
        ...(rotating?[{type:"rotateByEntityOrientation",entityForOrientation:"earth",rotatingPosition:true,rotatingOrientation:false}]:[])];
      await source.load(["moon"],5,[]);
      const trail=source.trailSamples("moon",5,32);
      assert.equal(trail.sourceCurrent,true);
      await source.load(["moon"],5,["moon"]);
      assert.equal(trail.sourceCurrent,true,"own mesh attitude is not a trail-position dependency");
      if(rotating) {
        await source.load(["earth"],15,["earth"]);
        assert.equal(trail.sourceCurrent,false,"sampled rotating reference attitude invalidates dependent science");
      }
    } finally {source.dispose();eyesDefinitions.moon.controllers=oldMoon;eyesDefinitions.earth.controllers=oldEarth;}
  }
});


test("native ISS predictive coverage avoids private history and preserves its full display allocation",async()=>{
  const {ctx}=context(),epoch=880000000;
  const source=new SolarSystemData(ctx,{fetch:async()=>{
    const bytes=orb(10000),view=new DataView(bytes.buffer);
    for(let i=0;i<2;i++) {
      view.setFloat64(28+i*72,epoch-100000+i*200000,true);
      view.setFloat64(28+i*72+24,.001,true);
    }
    return new Response(bytes);
  }});
  try {
    await source.load(["sc_iss"],epoch,[]);
    const work=source.trailSampleSteps("sc_iss",epoch,512,true,undefined,7200);
    let step=work.next();while(!step.done)step=work.next();
    assert.equal(step.value.sourceCurrent,true);
    assert.equal(await source.prepareTrailHistory("sc_iss",epoch,true),false);
    assert.equal(step.value.sourceCurrent,true,"the eight-point coverage probe never replaces the full visible sampler");
  } finally {source.dispose();}
});


test("real spacecraft guards remain valid beyond the instantaneous half-period conic range",async()=>{
 const {ctx}=context(),epoch=880000000;
 const source=new SolarSystemData(ctx,{fetch:async()=>{
  const bytes=orb(7000),view=new DataView(bytes.buffer);
  view.setFloat64(7,398600,true);view.setFloat64(15,0,true);
  for(let i=0;i<2;i++) {
   view.setFloat64(28+i*72,epoch-100000+i*200000,true);
   view.setFloat64(28+i*72+24,2*Math.PI/5573,true);
  }
  return new Response(bytes);
 }});
 try {
  await source.load(["sc_iss"],epoch,[]);
  const work=source.trailSampleSteps("sc_iss",epoch,185,false,undefined,100000);
  let step=work.next();while(!step.done)step=work.next();
  const guard=step.value,live=epoch+guard.durationSeconds*.75;
  assert.ok(live>source.trajectoryRange("sc_iss",epoch)[1],"the conic convenience domain is deliberately shorter");
  assert.ok(live>=guard.refreshRange[0]&&live<=guard.refreshRange[1]);
  assert.ok(guard.epochsTdbSeconds[0]<=live-guard.durationSeconds);
  assert.ok(guard.epochsTdbSeconds.at(-1)!>=live);
  const beyond=guard.epochsTdbSeconds.at(-1)!+1;
  assert.ok(beyond>guard.refreshRange[1],"a real sampled edge is never widened");
  const reverse=epoch-guard.durationSeconds*.75;
  assert.ok(reverse>=guard.refreshRange[0]&&reverse<=guard.refreshRange[1]);
  assert.ok(guard.epochsTdbSeconds[0]<=reverse-guard.durationSeconds);
  source.retain(["sun","earth","sc_iss"]);
  const position=source.position.bind(source);
  source.position=(id,time)=>{
   if(id==="sc_iss"&&time>epoch+guard.durationSeconds*.5&&time<epoch+guard.durationSeconds*.6)throw Error("future source gap");
   return position(id,time);
  };
  const gapWork=source.trailSampleSteps("sc_iss",epoch,185,false,undefined,100000);
  let gapStep=gapWork.next();while(!gapStep.done)gapStep=gapWork.next();
  assert.ok(gapStep.value.breakIndices.length>0);
  assert.ok(gapStep.value.refreshRange[1]<live,"refresh validity never crosses a sampled head gap");
 } finally {source.dispose();}
});


test("already partial guarded spacecraft trails remain publishable without claiming a complete tail",async()=>{
 const {ctx}=context(),epoch=880000000;
 const source=new SolarSystemData(ctx,{fetch:async()=>{
  const bytes=orb(7000),view=new DataView(bytes.buffer);view.setFloat64(7,398600,true);view.setFloat64(15,0,true);
  for(let i=0;i<2;i++){view.setFloat64(28+i*72,i?epoch+100000:epoch-1000,true);view.setFloat64(28+i*72+24,2*Math.PI/5573,true);}
  return new Response(bytes);
 }});
 try {
  await source.load(["sc_iss"],epoch,[]);
  const work=source.trailSampleSteps("sc_iss",epoch,185,false,undefined,100000);
  let step=work.next();while(!step.done)step=work.next();
  const partial=step.value;
  assert.ok(partial.epochsTdbSeconds[0]>partial.drawRangeTdbSeconds[0],"missing real tail data remains explicit");
  assert.ok(partial.refreshRange[0]<=epoch&&epoch<=partial.refreshRange[1],"partial geometry can publish without retrying forever");
  assert.ok(partial.epochsTdbSeconds.at(-1)!>=epoch);
  assert.equal(partial.durationSeconds,5573,"source limits never shorten the authored duration");
 } finally {source.dispose();}
});


test("aborted delayed forward prefetch cannot decode or trim a newly reversed scientific source",async()=>{
 const {ctx}=context();let release!:()=>void,started!:()=>void;const pending=new Promise<void>(resolve=>{started=resolve;});
 const source=new SolarSystemData(ctx,{fetch:async input=>{
  const time=Number(new URL(String(input),"http://fixture").searchParams.get("epoch"));
  if(time===11){started();return await new Promise<Response>(resolve=>{release=()=>resolve(new Response(new Uint8Array([0])));});}
  return new Response(orb(2));
 }});
 try {
  await source.load(["moon"],5,[]);const before=source.position("moon",5),coverage=source.coverage("moon");
  const forward=new AbortController(),prefetch=source.prefetchPosition("moon",11,5,20,forward.signal);
  await pending;forward.abort();release();
  await assert.rejects(prefetch,{name:"AbortError"},"aborted payload is rejected before malformed bytes could decode");
  assert.deepEqual(source.coverage("moon"),coverage);assert.deepEqual(source.position("moon",5),before);
  assert.equal(source.status("moon")?.status,"ready");
 } finally {source.dispose();}
});


test("more than eight stitched source chunks keep bounded publish metadata and complete separate provenance",async()=>{
 const {snapshotState}=await import("../state-contract.ts");
 const {ctx}=context(),publish=ctx.data.publish.bind(ctx.data),sizes:number[]=[];
 ctx.data.publish=(id,state)=>{snapshotState(state);if(id==="moon")sizes.push(new TextEncoder().encode(state.source).length);publish(id,state);};
 const source=new SolarSystemData(ctx,{fetch:async input=>{
  const at=Number(new URL(String(input),"http://fixture").searchParams.get("epoch")),start=Math.floor(at/10)*10;
  const bytes=orb(2),view=new DataView(bytes.buffer);for(let i=0;i<2;i++)view.setFloat64(28+i*72,start+i*10,true);
  return new Response(bytes);
 }});
 try {
  await source.load(["moon"],5,[]);const position=source.position("moon",5);
  for(let piece=0;piece<12;piece++) {
   assert.equal(await source.prefetchPosition("moon",source.coverage("moon")![0]-1,5,20),true);
   source.publishAt(5);
   assert.equal(source.status("moon")?.status,"ready");
   assert.deepEqual(source.position("moon",5),position);
  }
  assert.ok(sizes.length>=12&&sizes.every(size=>size<=2048));
  const provenance=source.provenance("moon").find(evidence=>evidence.selection?.includes('"stitched"'))!;
  const pieces=JSON.parse(provenance.selection!).stitched;
  assert.equal(pieces.length,13,"all verified source pieces remain available outside the per-frame payload");
  assert.ok(new TextEncoder().encode(provenance.selection!).length>2048,"the full archive is deliberately larger than the transport field");
 } finally {source.dispose();}
});


test("source I/O concurrency is configurable up to 32 and disposal never admits queued work",async()=>{
 const epoch=846972583;
 for(const limit of [1,8,32]) {
  const {ctx}=context();let active=0,peak=0,calls=0;const releases:(()=>void)[]=[];
  const source=new SolarSystemData(ctx,{maxConcurrentRequests:limit,fetch:async(_input,options)=>{
   calls++;active++;peak=Math.max(peak,active);
   await new Promise<void>(resolve=>{releases.push(resolve);options?.signal?.addEventListener("abort",()=>resolve(),{once:true});});
   active--;options?.signal?.throwIfAborted();return new Response(orb(2));
  }});
  const ids=solarCatalog.filter(body=>body.id!=="sun"&&source.parentAt(body.id,epoch)==="sun"&&(eyesDefinitions[body.id]?.controllers??[]).some(controller=>controller.type==="dynamo"&&typeof controller.url==="string"&&!/(?:ori|quat|quat_v2)$/.test(controller.url)&&(!controller.coverage||(epoch>=Number(controller.coverage[0])&&epoch<=Number(controller.coverage[1]))))).slice(0,40).map(body=>body.id);
  assert.equal(ids.length,40,"exercise more genuine independent sources than the largest I/O pool");
  const loading=source.load(ids,epoch,[]);await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(peak,limit);assert.equal(calls,limit);
  source.dispose();for(const release of releases)release();await loading;
  assert.equal(calls,limit,"aborting the source owner prevents all queued network admissions");
 }
 for(const limit of [0,-1,1.5,33,Infinity,NaN])assert.throws(()=>new SolarSystemData(context().ctx,{maxConcurrentRequests:limit}),/request concurrency/);
});


test("32 header requests retain only four body readers and abort cancels every queued body",async()=>{
 const {ctx}=context(),epoch=846972583;let headers=0,readers=0,peak=0,active=0,queuedBodyCancels=0;
 const source=new SolarSystemData(ctx,{maxConcurrentRequests:32,fetch:async(_input,options)=>{
  headers++;let controller!:ReadableStreamDefaultController<Uint8Array>;
  const stream=new ReadableStream<Uint8Array>({start(value){controller=value;},pull(){return new Promise<void>(()=>{});}},{highWaterMark:0});
  options?.signal?.addEventListener("abort",()=>controller.error(options.signal!.reason),{once:true});
  const getReader=stream.getReader.bind(stream),cancel=stream.cancel.bind(stream);
  Object.defineProperty(stream,"cancel",{value:(reason?:unknown)=>{queuedBodyCancels++;return cancel(reason);}});
  Object.defineProperty(stream,"getReader",{value:()=>{
   readers++;active++;peak=Math.max(peak,active);const reader=getReader(),release=reader.releaseLock.bind(reader);
   reader.releaseLock=()=>{active--;release();};return reader;
  }});
  return new Response(stream);
 }});
 const ids=solarCatalog.filter(body=>body.id!=="sun"&&source.parentAt(body.id,epoch)==="sun"&&(eyesDefinitions[body.id]?.controllers??[]).some(controller=>controller.type==="dynamo"&&typeof controller.url==="string"&&!/(?:ori|quat|quat_v2)$/.test(controller.url)&&(!controller.coverage||(epoch>=Number(controller.coverage[0])&&epoch<=Number(controller.coverage[1]))))).slice(0,40).map(body=>body.id);
 const loading=source.load(ids,epoch,[]);await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(headers,32,"remote response latency overlaps across the enlarged I/O lane");
 assert.equal(readers,4);assert.equal(peak,4);
 source.dispose();await loading;
 assert.equal(headers,32,"queued network requests never start after disposal");
 assert.equal(readers,4,"aborted body waiters never acquire a reader");
 assert.equal(active,0);assert.equal(queuedBodyCancels,28,"already received responses are cancelled without reading their bodies");
});

test("directional guards preserve visible allocation and science within the same total point budget",async()=>{
 const epoch=880000000;
 const make=async(lower=epoch-100000,upper=epoch+100000)=>{const {ctx}=context();const source=new SolarSystemData(ctx,{fetch:async()=>{const bytes=orb(7000),view=new DataView(bytes.buffer);view.setFloat64(7,398600,true);view.setFloat64(15,0,true);for(let i=0;i<2;i++){view.setFloat64(28+i*72,i?upper:lower,true);view.setFloat64(28+i*72+24,2*Math.PI/5573,true);}return new Response(bytes);}});await source.load(['sc_iss'],epoch,[]);return source;};
 const sample=(source:SolarSystemData,count:number,direction:-1|0|1)=>{const work=source.trailSampleSteps('sc_iss',epoch,count,false,undefined,100000,direction);let step=work.next();while(!step.done)step=work.next();return step.value;};
 const baselineSource=await make();const baseline=sample(baselineSource,185,0);baselineSource.dispose();
 const visible=(result:typeof baseline)=>result.epochsTdbSeconds.flatMap((time,i)=>time>=epoch-result.durationSeconds&&time<=epoch?[[time,...result.points[i]]]:[]);
 for(const direction of [1,-1] as const){const source=await make();try{
  const result=sample(source,185,direction),duration=result.durationSeconds,small=Math.floor(185/4);
  assert.equal(duration,baseline.durationSeconds);assert.deepEqual(result.drawRangeTdbSeconds,baseline.drawRangeTdbSeconds);assert.deepEqual(visible(result),visible(baseline),'visible point allocation and exact positions stay unchanged');
  assert.ok(result.points.length<=185*3);assert.equal(result.breakIndices.length,0);
  assert.equal(result.epochsTdbSeconds[0],epoch-duration*(direction>0?1.25:2.75));assert.equal(result.epochsTdbSeconds.at(-1),epoch+duration*(direction>0?1.75:.25));
  const before=result.epochsTdbSeconds.filter(time=>time<=epoch-duration).length,after=result.epochsTdbSeconds.filter(time=>time>=epoch).length;
  assert.ok(before<=(direction>0?small:370-small));assert.ok(after<=(direction<0?small:370-small));
  assert.ok(result.refreshRange[0]<=epoch-duration*(direction>0?.25:1.75));assert.ok(result.refreshRange[1]>=epoch+duration*(direction>0?1.75:.25));
  const outside=epoch-direction*duration*.3;assert.equal(outside>=result.refreshRange[0]&&outside<=result.refreshRange[1],false,'the quarter-period reversal bridge never claims uncovered history');
  const old=result;const reversed=sample(source,185,direction===1?-1:1);assert.equal(old.sourceCurrent,false,'direction changes retire the old allocation');assert.equal(reversed.sourceCurrent,true);
 }finally{source.dispose();}}
 const smallSource=await make();try{assert.deepEqual(sample(smallSource,16,1).epochsTdbSeconds,sample(smallSource,16,0).epochsTdbSeconds,'small allocations keep symmetric compatibility');}finally{smallSource.dispose();}
 for(const direction of [1,-1] as const){const source=await make();try{
  const position=source.position.bind(source),duration=5573;
  source.position=(id,time)=>{const phase=(time-epoch)/duration*direction;if(id==='sc_iss'&&phase>.4&&phase<.5)throw Error('real directional source gap');return position(id,time);};
  const result=sample(source,185,direction);assert.ok(result.breakIndices.length>0);
  assert.ok(direction>0?result.refreshRange[1]<epoch+duration*.5:result.refreshRange[0]>epoch-duration*.5,'current head validity cannot cross a real gap');
 }finally{source.dispose();}}
 const clipped=await make(epoch-6000,epoch+3000);try{for(const direction of [1,-1] as const){const result=sample(clipped,185,direction);assert.ok(result.epochsTdbSeconds[0]>=epoch-6000);assert.ok(result.epochsTdbSeconds.at(-1)!<=epoch+3000);assert.ok(result.refreshRange[1]<=epoch+3000);assert.ok(result.refreshRange[0]>=epoch-6000);}}finally{clipped.dispose();}
 const natural=await make();try{
  await natural.load(['earth'],epoch,[]);
  const build=(direction:-1|0|1)=>{const work=natural.trailSampleSteps('earth',epoch,185,false,undefined,100000,direction);let step=work.next();while(!step.done)step=work.next();return step.value;};
  const original=build(0);for(const direction of [1,-1] as const){const current=build(direction);assert.deepEqual(current.points,original.points);assert.deepEqual(current.epochsTdbSeconds,original.epochsTdbSeconds);assert.deepEqual(current.drawRangeTdbSeconds,original.drawRangeTdbSeconds);}
 }finally{natural.dispose();}
});


test("a malformed-time chunk is failed and later valid source reload recovers without changing definition support",async()=>{
 const {ctx}=context();let phase=0;
 const source=new SolarSystemData(ctx,{fetch:async()=>{
  const bytes=orb(7000);new DataView(bytes.buffer).setFloat64(28+72,phase===1?0:phase===2?20:10,true);
  return new Response(bytes);
 }});
 try{
  await source.load(['sc_jwst'],5,[]);assert.equal(source.status('sc_jwst')?.status,'ready');const position=source.position('sc_jwst',5);
  phase=1;await source.load(['sc_jwst'],11,[]);assert.equal(source.status('sc_jwst')?.status,'failed');assert.match(source.status('sc_jwst')?.error??'',/sample times must increase/);
  phase=2;await source.load(['sc_jwst'],12,[]);assert.equal(source.status('sc_jwst')?.status,'ready');assert.deepEqual(source.position('sc_jwst',5),position);
 }finally{source.dispose();}
});

test("only optional adjacent prefetch adds directional raw-warming hints",async()=>{
 const {ctx}=context(),urls:URL[]=[];
 const source=new SolarSystemData(ctx,{fetch:async input=>{const url=new URL(String(input),'http://fixture');urls.push(url);const epoch=Number(url.searchParams.get('epoch')),bytes=orb(2),view=new DataView(bytes.buffer),start=Math.floor(epoch/10)*10;for(let i=0;i<2;i++)view.setFloat64(28+i*72,start+i*10,true);return new Response(bytes);}});
 try{
  await source.load(['moon'],5,[]);assert.ok(urls.length>0);assert.ok(urls.every(url=>!url.searchParams.has('adjacent')),'normal/static loads never warm siblings');
  assert.equal(await source.prefetchPosition('moon',11,5,20),true);assert.equal(await source.prefetchPosition('moon',-1,5,20),true);
  assert.deepEqual(urls.filter(url=>url.searchParams.has('adjacent')).map(url=>url.searchParams.get('adjacent')),['forward','reverse']);
 }finally{source.dispose();}
});
