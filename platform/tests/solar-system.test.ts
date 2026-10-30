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
  const ellipse = source.trajectorySamples(
    "moon",
    5,
    256,
    false,
    "instantaneous",
  );
  assert.equal(ellipse.originId, "earth");
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
      const b = orb(String(input).includes("/moon?") ? 2 : 10000);
      const v = new DataView(b.buffer);
      for (let i = 0; i < 2; i++) {
        v.setFloat64(28 + i * 72, i * 1000, true);
        v.setFloat64(28 + i * 72 + 24, (2 * Math.PI) / 100, true);
        v.setFloat64(28 + i * 72 + 32, i * 20 * Math.PI, true);
      }
      return new Response(b);
    },
  });
  await source.load(["moon"], 500, []);
  const trail = source.trailSamples("moon", 500, 128);
  assert.ok(Math.abs(trail.durationSeconds - 100) < 1e-8);
  assert.ok(Math.abs(trail.epochsTdbSeconds[0] - 400) < 1e-8);
  assert.ok(Math.abs(trail.epochsTdbSeconds.at(-1)! - 525) < 1e-8);
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
