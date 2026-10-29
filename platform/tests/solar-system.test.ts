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
