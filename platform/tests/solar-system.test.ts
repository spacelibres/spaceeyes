import { eyesDefinitions } from "../eyes-catalog.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SolarSystemData, hasDisplayCatalog } from "../solar-system.ts";
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
  const trail = source.trailSamples("moon", 500, 256);
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
