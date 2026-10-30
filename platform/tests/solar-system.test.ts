import { test } from "node:test";
import assert from "node:assert/strict";
import { SolarSystemData } from "../solar-system.ts";
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
  assert.ok(trail.points.every((p) => Math.abs(Math.hypot(...p) - 2) < 1e-8));
  const p = source.position("moon", 5),
    earth = source.position("earth", 5),
    i = trail.epochsTdbSeconds.indexOf(5);
  assert.deepEqual(
    trail.points[i].map((v, j) => v + earth[j]),
    p,
  );
  const ellipse = source.trajectorySamples("moon", 5, 256, false, "instantaneous");
  assert.equal(ellipse.originId,"earth");
  assert.deepEqual(ellipse.points[0],ellipse.points.at(-1));
  assert.deepEqual(ellipse.points[ellipse.epochsTdbSeconds.indexOf(5)].map((v,j)=>v+earth[j]),p);
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
  const bytes = orb(10), view = new DataView(bytes.buffer);
  // A circular two-body fixture: mu=1+2=3, n=sqrt(mu/a^3).
  const n = Math.sqrt(3 / 1000);
  for (let i = 0; i < 2; i++) {
    view.setFloat64(28 + i * 72 + 24, n, true);
    view.setFloat64(28 + i * 72 + 32, n * i * 10, true);
  }
  const source = new SolarSystemData(ctx, { fetch: async () => new Response(bytes) });
  await source.load(["neptune"], 5, []);
  const before = structuredClone([...states]);
  const trail = source.trajectorySamples("neptune", 5, 256, false, "instantaneous");
  assert.deepEqual(trail.points[0], trail.points.at(-1));
  assert.ok(trail.points.every(p => Math.abs(Math.hypot(...p) - 10) < 1e-8));
  assert.deepEqual(trail.points[trail.epochsTdbSeconds.indexOf(5)], source.position("neptune", 5));
  assert.ok(trail.epochsTdbSeconds[0] < 0 && trail.epochsTdbSeconds.at(-1)! > 10);
  assert.deepEqual([...states], before);
  assert.throws(() => source.position("neptune", 11), /coverage/);
  source.dispose();
});

test("reviewed source identity and selected coverage survive into published provenance", async () => {
  const {ctx,states}=context();
  const rawHash="a".repeat(64), selection=JSON.stringify({records:[17,50],coverage:[0,10]});
  const source=new SolarSystemData(ctx,{fetch:async()=>new Response(orb(10),{headers:{
    "x-dyn-source-sha256":rawHash,"x-dyn-selection":selection,
  }})});
  await source.load(["earth"],5,[]);
  const provenance=source.provenance("earth")[0];
  assert.equal(provenance.sourceSha256,rawHash);
  assert.equal(provenance.selection,selection);
  assert.match(provenance.sha256,/^[a-f0-9]{64}$/);
  source.publishAt(5);
  assert.ok((states.get("earth") as {source:string}).source.includes(rawHash));
  assert.deepEqual(source.coverage("earth"),[0,10]);
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
