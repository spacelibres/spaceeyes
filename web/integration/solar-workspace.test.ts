import type { SceneLinkState } from "../lib/scene-link.ts";
import { StarfieldSource } from "../../platform/starfield-source.ts";
import { solarWorkspaceSettings } from "../lib/solar-settings.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  createWorkspace,
  type HostCore,
  type SolarSnapshot,
} from "../lib/solar-workspace.ts";
const { WasmCore } = createRequire(import.meta.url)(
  "../../core/pkg/spaceeyes_core.js",
);

function sample(orientation = false, end = 4e9): Uint8Array<ArrayBuffer> {
  const type = orientation ? "ori" : "orb";
  const bytes = new Uint8Array(orientation ? 140 : 172);
  const view = new DataView(bytes.buffer);
  let cursor = 0;
  view.setInt16(cursor, 2, true);
  cursor += 2;
  bytes.set(new TextEncoder().encode(type + "\0"), cursor);
  cursor += 4;
  bytes[cursor++] = 3;
  const number = (value: number) => {
    view.setFloat64(cursor, value, true);
    cursor += 8;
  };
  if (!orientation) {
    number(100); // n^2*a^3 for this circular fixture, in km^3/s^2.
    number(0);
  }
  bytes[cursor++] = 1;
  view.setInt32(cursor, 2, true);
  cursor += 4;
  for (const epoch of [-4e9, end]) {
    const values = orientation
      ? [epoch, 1, 0, 0, 0, 0, 0, 0]
      : [epoch, 10000, 0, 0.00001, epoch * 0.00001, 1, 0, 0, 0];
    for (const value of values) number(value);
  }
  return bytes;
}

function harness(initialNullEnvironmentStatus = false) {
  const visuals: { id: string; spec: Record<string, any> }[] = [];
  const focusCalls: string[] = [];
  const solar: Record<string, number>[] = [];
  const trails: {
    id: string;
    epochs: number[];
    count: number;
    closed: boolean;
    kind?: string;
    duration?: number;
    conic?: Record<string, unknown>;
  }[] = [];
  let core: HostCore;
  let timeSession: [string, string];
  let freed = 0;
  let picked: string | undefined;
  let desiredLod = 0;
  let environmentStatusReads = 0;
  let callback: FrameRequestCallback | undefined;
  let pauseSignal: (() => void) | undefined;
  class TestCore {
    constructor() {
      const actual = new WasmCore();
      core = new Proxy(actual, {
        get(target, property) {
          // Rendering is replaced in this harness; GPU projection is checked separately.
          if (property === "environment_status")
            return () =>
              initialNullEnvironmentStatus && environmentStatusReads++ === 0
                ? "null"
                : JSON.stringify({ phase: "disabled", desiredLod });
          if (property === "pick_object") return () => picked;
          if (property === "start_renderer" || property === "stop_renderer")
            return () => {};
          if (property === "free")
            return () => {
              freed++;
              actual.free();
            };
          const value = Reflect.get(target, property);
          if (property === "seek") return (...args: [string, string, number]) => {
            timeSession = [args[0], args[1]];
            return Reflect.apply(value, target, args);
          };
          if (property === "camera_observe")
            return (...args: any[]) => {
              const result = Reflect.apply(value, target, args);
              focusCalls.push(JSON.parse(args[2]).targetId);
              return result;
            };
          if (property === "focus")
            return (...args: any[]) => {
              const result = Reflect.apply(value, target, args);
              focusCalls.push(args[2]);
              return result;
            };
          if (property === "trajectory")
            return (...args: any[]) => {
              const result = Reflect.apply(value, target, args);
              const payload = JSON.parse(args[3]);
              const points = Array.isArray(payload) ? payload : payload.points;
              trails.push({
                id: args[2],
                kind: payload.kind,
                duration: payload.trailDurationSeconds,
                conic: payload.conic,
                epochs: payload.epochs,
                count: points.length,
                closed:
                  points.length > 1 &&
                  JSON.stringify(points[0]) === JSON.stringify(points.at(-1)),
              });
              return result;
            };
          if (property === "tune_stellar")
            return (...args: any[]) => {
              solar.push(JSON.parse(args[3]).settings);
              return Reflect.apply(value, target, args);
            };
          if (property === "set_visual")
            return (...args: any[]) => {
              visuals.push({ id: args[2], spec: JSON.parse(args[3]) });
              return Reflect.apply(value, target, args);
            };
          if (property === "set_playback")
            return (...args: unknown[]) => {
              const result = Reflect.apply(value, target, args);
              if (args[2] === false) {
                const notify = pauseSignal;
                pauseSignal = undefined;
                notify?.();
              }
              return result;
            };
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as HostCore;
      return core;
    }
  }
  return {
    setDesiredLod: (level: number) => {
      desiredLod = level;
    },
    backgroundStars: false,
    backgroundGalaxy: false,
    loadCore: async () => ({
      default: async () => {},
      WasmCore: TestCore as unknown as new () => HostCore,
    }),
    requestFrame: (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    },
    cancelFrame: () => {
      callback = undefined;
    },
    step: (time: number) => callback?.(time),
    visuals: () => visuals,
    solar: () => solar,
    focusCalls: () => focusCalls,
    trails: () => trails,
    setPick: (id: string | undefined) => {
      picked = id;
    },
    freed: () => freed,
    core: () => core!,
    seekEpoch: (epoch: number) => core.seek(...timeSession, epoch),
    focused: () =>
      (
        core as HostCore & { focused_object(): string | undefined }
      ).focused_object(),
    waitForPause: () =>
      new Promise<void>((resolve) => {
        pauseSignal = resolve;
      }),
  };
}

test("scene hit reuses real WASM selection while empty hits do not load and stale hits do not refocus", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  let requests = 0;
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) => {
        requests++;
        return new Response(sample(String(input).includes("type=ori")));
      },
    },
  );
  try {
    const before = requests;
    assert.equal(await app.pick(0.5, 0.5), false);
    assert.equal(requests, before);
    fixtures.setPick("earth");
    assert.equal(await app.pick(0.5, 0.5), true);
    assert.equal(states.at(-1)!.selected, "earth");
    assert.equal(fixtures.focused(), "earth");
    assert.deepEqual(
      fixtures
        .visuals()
        .filter(({ spec }) => spec.faceAssets)
        .map(({ id }) => id),
      ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"],
    );
    fixtures.setPick("moon");
    const pending = app.pick(0.5, 0.5);
    app.overview();
    assert.equal(await pending, false);
    assert.equal(fixtures.focused(), undefined);
    assert.equal(states.at(-1)!.selected, "");
  } finally {
    await app.dispose();
  }
  await assert.rejects(app.pick(0.5, 0.5), /关闭/);
});

test("timed trajectory detail switches from a late catalog object without exceeding core budget", async () => {
  const fixtures = harness();
  const app = await createWorkspace(
    "#test",
    () => {},
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    await app.select("neptune");
    assert.equal(
      fixtures
        .trails()
        .filter((t) => t.id === "neptune")
        .at(-1)!.closed,
      true,
    );
    await app.select("mercury");
    const trail = fixtures
      .trails()
      .filter((t) => t.id === "mercury")
      .at(-1)!;
    assert.ok(trail.count > 128 && trail.count <= 256);
    assert.ok(trail.epochs.includes(fixtures.core().epoch()));
    assert.equal(trail.closed, true);
    assert.equal(fixtures.focused(), "mercury");
  } finally {
    await app.dispose();
  }
});

test("extended catalog selection binds actual spacecraft and irregular-moon model assets", async () => {
  const fixtures = harness();
  const app = await createWorkspace(
    "#test",
    () => {},
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    for (const id of ["phobos", "sc_iss", "sc_juno", "sc_cluster_ii_fm5"]) {
      await app.select(id);
      const visual = fixtures
        .visuals()
        .filter((v) => v.id === id)
        .at(-1)!;
      assert.equal(visual.spec.kind, "model");
      assert.equal(visual.spec.assetId, `eyes:${id}:model`);
      assert.equal(visual.spec.scaleKmPerUnit, 1);
      if (id === "sc_cluster_ii_fm5")
        assert.equal(visual.spec.framingRadiusKm, 0.00435);
      if (id === "sc_iss") assert.equal(visual.spec.framingRadiusKm, 0.072);
      if (id === "phobos")
        assert.equal(Object.hasOwn(visual.spec, "framingRadiusKm"), false);
      assert.equal(fixtures.focused(), id);
    }
  } finally {
    await app.dispose();
  }
});

test("returning to overview invalidates a pending seek before it can change time or resume playback", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  let began!: () => void, release!: () => void;
  const ready = new Promise<void>((done) => {
      began = done;
    }),
    gate = new Promise<void>((done) => {
      release = done;
    });
  const app = await createWorkspace(
    "#test",
    (value) => states.push(value),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("epoch=10000000000")) {
          began();
          await gate;
        }
        return new Response(
          sample(
            url.includes("type=ori"),
            url.includes("epoch=10000000000") ? 2e10 : 4e9,
          ),
        );
      },
    },
  );
  try {
    const before = fixtures.core().epoch();
    // Force a request outside the initial loaded coverage.
    const seeking = app.seek(1e10);
    await ready;
    app.overview();
    release();
    await seeking;
    assert.equal(fixtures.core().epoch(), before);
    assert.equal(states.at(-1)!.busy, false);
    assert.equal(states.at(-1)!.selected, "");
    assert.match(states.at(-1)!.phase, /总览/);
  } finally {
    release();
    await app.dispose();
  }
});

test("a superseded available-time request cannot refocus the old selection", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (value) => states.push(value),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    assert.equal(states.at(-1)!.error, "");
    await app.select("moon");
    const before = fixtures.focusCalls().length;
    const paused = fixtures.waitForPause();
    const old = app.observeAvailable();
    await paused;
    const next = app.select("earth");
    await Promise.all([old, next]);
    assert.deepEqual(fixtures.focusCalls().slice(before), ["earth"]);
    assert.equal(fixtures.focused(), "earth");
  } finally {
    await app.dispose();
  }
});

test("complete host flow uses real Rust WASM for selection, time, layers and release", async () => {
  const fixtures = harness();
  const signal = new AbortController();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    signal.signal,
    {
      ...fixtures,
      fetch: async (input) =>
        String(input).includes("/mars?")
          ? new Response("Unsupported source", {
              status: 502,
              headers: { "x-dyn-error": "sample times must increase" },
            })
          : new Response(sample(String(input).includes("type=ori"))),
    },
  );
  assert.equal(states.at(-1)!.active, true);
  await app.seek(0);
  await app.select("earth");
  assert.equal(fixtures.focused(), "earth");
  await assert.rejects(app.select("mars"), /sample times must increase/);
  assert.equal(fixtures.focused(), undefined);
  assert.match(states.at(-1)!.phase, /总览/);
  assert.match(states.at(-1)!.dataStatus, /^unsupported/);
  await Promise.all([app.select("earth"), app.select("moon")]);
  assert.equal(states.at(-1)!.selected, "moon");
  const earth = JSON.parse(fixtures.core().state_at("earth", 0));
  const moon = JSON.parse(fixtures.core().state_at("moon", 0));
  assert.deepEqual(
    moon.positionKm,
    earth.positionKm.map((value: number) => value * 2),
  );
  app.view("top");
  await app.follow();
  assert.equal(states.at(-1)!.view, "orbit");
  app.layers(false, false);
  assert.equal(states.at(-1)!.labels, false);
  app.play(true, 60);
  fixtures.step(0);
  fixtures.step(1000);
  assert.equal(fixtures.core().epoch(), 60);
  app.play(false, 60);
  app.view("side");
  app.overview();
  assert.equal(states.at(-1)!.selected, "");
  assert.equal(states.at(-1)!.view, "orbit");
  await app.seekUtc("2000-01-01T12:00");
  assert.ok(Math.abs(fixtures.core().epoch() - 64.184) < 0.002);
  app.play(true, 60);
  const paused = fixtures.waitForPause();
  const firstSeek = app.seek(100);
  await paused;
  const secondSeek = app.seek(200);
  await Promise.all([firstSeek, secondSeek]);
  assert.equal(fixtures.core().epoch(), 200);
  assert.equal(fixtures.core().playing(), true);
  await assert.rejects(app.seek(1e10), /覆盖/);
  assert.equal(fixtures.core().epoch(), 200);
  assert.equal(fixtures.core().playing(), false);
  await Promise.all([app.dispose(), app.dispose()]);
  assert.equal(fixtures.freed(), 1);
  assert.equal(states.at(-1)!.active, false);
  assert.throws(() => app.play(true, 1), /关闭/);
  await assert.rejects(app.seek(0), /关闭/);
});

test(
  "leaving during source loading aborts requests and cannot start a late renderer",
  { timeout: 10000 },
  async () => {
    const fixtures = harness();
    const controller = new AbortController();
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const states: SolarSnapshot[] = [];
    const opening = createWorkspace(
      "#test",
      (state) => states.push(state),
      controller.signal,
      {
        ...fixtures,
        fetch: async (_input, options) => {
          began();
          return new Promise<Response>((_resolve, reject) => {
            options!.signal!.addEventListener(
              "abort",
              () => reject(options!.signal!.reason),
              { once: true },
            );
          });
        },
      },
    );
    await started;
    controller.abort();
    await assert.rejects(opening);
    assert.equal(fixtures.freed(), 1);
    assert.equal(
      states.some((state) => state.active),
      false,
    );
  },
);

for (const partial of [false, true]) {
  test(
    `automatic coverage transition rolls back or clears unavailable focus: partial=${partial}`,
    { timeout: 10000 },
    async () => {
      const fixtures = harness();
      let settled: ((state: SolarSnapshot) => void) | undefined;
      const app = await createWorkspace(
        "#test",
        (state) => {
          if (!state.busy && state.active) settled?.(state);
        },
        new AbortController().signal,
        {
          ...fixtures,
          fetch: async (input) => {
            const url = new URL(String(input), "http://localhost");
            const short = !partial || url.pathname.endsWith("/moon");
            if (short && Number(url.searchParams.get("epoch")) > 1e9)
              return new Response("unavailable", { status: 503 });
            return new Response(
              sample(url.searchParams.get("type") === "ori", short ? 1e9 : 4e9),
            );
          },
        },
      );
      try {
        await app.seek(1e9 - 1);
        await app.select("moon");
        app.play(true, 1);
        fixtures.step(0);
        const done = new Promise<SolarSnapshot>((resolve) => {
          settled = resolve;
        });
        fixtures.step(2000);
        const state = await done;
        assert.equal(state.playing, false);
        if (partial) {
          assert.match(state.phase, /总览/);
          assert.doesNotThrow(() => fixtures.core().state_at("earth", 1e9 + 1));
        } else {
          assert.equal(fixtures.core().epoch(), 1e9 - 1);
          assert.doesNotThrow(() => fixtures.core().state_at("moon", 1e9 - 1));
        }
      } finally {
        await app.dispose();
      }
    },
  );
}

test("startup retains eight detailed planets and selection does not recreate their resources", async () => {
  const fixtures = harness();
  const requested: string[] = [];
  const app = await createWorkspace(
    "#test",
    () => {},
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(sample(String(input).includes("type=ori")));
      },
    },
  );
  try {
    const planets = [
      "mercury",
      "venus",
      "earth",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptune",
    ];
    const detailed = () =>
      fixtures.visuals().filter(({ spec }) => spec.faceAssets);
    assert.deepEqual(
      detailed().map(({ id }) => id),
      planets,
    );
    assert.equal(
      detailed().find(({ id }) => id === "saturn")!.spec.ringAssets.length,
      2,
    );
    const orientationIds = () =>
      requested
        .filter((url) => url.includes("type=ori"))
        .map((url) => url.split("/").at(-1)?.split("?")[0]);
    for (const id of planets)
      assert.ok(orientationIds().includes(id), `${id} orientation preloaded`);
    const planetRequests = () =>
      requested.filter((url) =>
        planets.some((id) => url.includes(`/solar-dyn/${id}?`)),
      );
    const before = planetRequests();
    assert.ok(
      before.length >= planets.length,
      "track real planet DYN requests",
    );
    for (const id of planets) await app.select(id);
    app.overview();
    await app.seek(0);
    app.layers(false, false);
    assert.equal(detailed().length, 8);
    assert.equal(
      fixtures
        .visuals()
        .some(({ id, spec }) => id === "moon" && spec.faceAssets),
      false,
    );
    assert.equal(
      fixtures.visuals().some(({ spec }) => spec.kind === "model"),
      false,
    );
    assert.deepEqual(planetRequests(), before);
  } finally {
    await app.dispose();
  }
});

test("a successful valid-time reload clears the previous unavailable-target error", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) => {
        const url = new URL(String(input), "http://localhost");
        if (
          url.pathname.endsWith("/sc_cassini") &&
          Number(url.searchParams.get("epoch")) >= 0
        )
          return new Response("outside mission coverage", { status: 503 });
        return new Response(sample(url.searchParams.get("type") === "ori"));
      },
    },
  );
  try {
    await assert.rejects(app.select("sc_cassini"));
    assert.notEqual(states.at(-1)!.error, "");
    await app.observeAvailable();
    assert.equal(states.at(-1)!.selected, "sc_cassini");
    assert.equal(states.at(-1)!.error, "");
    assert.equal(fixtures.focused(), "sc_cassini");
  } finally {
    await app.dispose();
  }
});

test("cancelled module loading does not initialize WASM or start a renderer", async () => {
  const controller = new AbortController();
  let init = 0;
  const phases: string[] = [];
  await assert.rejects(
    createWorkspace("#test", () => {}, controller.signal, {
      ...harness(),
      onStartup: (phase) => phases.push(phase),
      loadCore: async () => {
        controller.abort();
        return {
          default: async () => {
            init++;
          },
          WasmCore: class {} as unknown as new () => HostCore,
        };
      },
    }),
  );
  assert.equal(init, 0);
  assert.deepEqual(phases, ["加载三维核心模块"]);
});

test("solar configuration is published on startup and survives selection, overview and visual upgrades", async () => {
  for (const custom of [
    undefined,
    {
      ...solarWorkspaceSettings(),
      surfaceGain: 0.8,
      temperatureMK: 2,
      observationStyle: 0,
    },
  ]) {
    const fixtures = harness();
    const app = await createWorkspace(
      "#test",
      () => {},
      new AbortController().signal,
      {
        ...fixtures,
        stellarSettings: custom,
        fetch: async (input) =>
          new Response(sample(String(input).includes("type=ori"))),
      },
    );
    try {
      const expected = solarWorkspaceSettings(custom);
      assert.ok(
        fixtures.solar().length > 0,
        "startup must publish solar settings before selection",
      );
      assert.deepEqual(fixtures.solar().at(-1), expected);
      await app.select("sun");
      app.overview();
      await app.select("earth");
      await app.select("sun");
      for (const settings of fixtures.solar())
        assert.deepEqual(settings, expected);
      assert.ok(
        fixtures
          .visuals()
          .filter((v) => v.id === "sun")
          .every((v) => !v.spec.faceAssets),
        "Sun never switches to NASA photograph faces",
      );
    } finally {
      await app.dispose();
    }
  }
});

test("shared stellar LOD keeps updating while galaxy is disabled", async () => {
  const original = StarfieldSource.prototype.setLod;
  const levels: number[] = [];
  StarfieldSource.prototype.setLod = function (level: number) {
    levels.push(level);
    return original.call(this, level);
  };
  const fixtures = harness();
  let latest: SolarSnapshot | undefined;
  const app = await createWorkspace(
    "#test",
    (state) => {
      latest = state;
    },
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    fixtures.setDesiredLod(6);
    fixtures.step(1000);
    assert.ok(levels.includes(6));
    assert.equal(latest?.galaxy.enabled, false);
  } finally {
    await app.dispose();
    StarfieldSource.prototype.setLod = original;
  }
});

test("galaxy enable requests manifest and disabling aborts without old preview assets", async () => {
  const fixtures = harness();
  const requests: string[] = [];
  let manifestSignal: AbortSignal | undefined;
  const app = await createWorkspace(
    "#test",
    () => {},
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input, options) => {
        const path = String(input);
        requests.push(path);
        if (path === "/api/galaxy-manifest") {
          manifestSignal = options?.signal as AbortSignal;
          return new Promise<Response>((_resolve, reject) =>
            manifestSignal!.addEventListener(
              "abort",
              () => reject(Error("cancelled")),
              { once: true },
            ),
          );
        }
        return new Response(sample(path.includes("type=ori")));
      },
    },
  );
  try {
    app.galaxy(true);
    assert.ok(requests.includes("/api/galaxy-manifest"));
    assert.equal(manifestSignal?.aborted, false);
    app.galaxy(false);
    assert.equal(manifestSignal?.aborted, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(requests.every((path) => !path.includes("milkyway-preview")));
  } finally {
    await app.dispose();
  }
});

test("observation FOV SDK updates real WASM and rejects invalid values", async () => {
  const fixtures = harness();
  let latest: SolarSnapshot | undefined;
  const app = await createWorkspace(
    "#test",
    (state) => {
      latest = state;
    },
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    app.fieldOfView(22);
    assert.equal(latest?.fovDegrees, 22);
    assert.equal(
      (
        fixtures.core() as HostCore & { camera_fov_degrees(): number }
      ).camera_fov_degrees(),
      22,
    );
    for (const value of [NaN, Infinity, 9, 101])
      assert.throws(() => app.fieldOfView(value));
    assert.equal(
      (
        fixtures.core() as HostCore & { camera_fov_degrees(): number }
      ).camera_fov_degrees(),
      22,
    );
  } finally {
    await app.dispose();
  }
});

test("null environment status before first frame does not prevent workspace startup", async () => {
  const fixtures = harness(true);
  let latest: SolarSnapshot | undefined;
  const app = await createWorkspace(
    "#test",
    (state) => {
      latest = state;
    },
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    assert.equal(latest?.error, "");
    assert.equal(latest?.active, true);
    fixtures.setDesiredLod(4);
    fixtures.step(1000);
    assert.equal(latest?.galaxy.desiredLod, 4);
    assert.equal(latest?.error, "");
  } finally {
    await app.dispose();
  }
});

test("overview preserves playback and trail visibility is independent", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (v) => states.push(v),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    app.play(true, 60);
    app.overview();
    assert.equal(states.at(-1)!.playing, true);
    assert.equal(states.at(-1)!.trails, true);
    app.trails(false);
    assert.equal(states.at(-1)!.trails, false);
    assert.equal(states.at(-1)!.trajectories, true);
  } finally {
    await app.dispose();
  }
});

test("natural satellites use orbits and artificial satellites use timed trails", async () => {
  const fixtures = harness();
  const app = await createWorkspace(
    "#test",
    () => {},
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    await app.select("moon");
    const moon = fixtures
      .trails()
      .filter((t) => t.id === "moon" && t.count > 0)
      .at(-1)!;
    assert.equal(moon.kind, "orbit");
    assert.equal(moon.duration, undefined);
    assert.ok(moon.conic, 'Moon must forward analytic orbit independent of point count');
    assert.ok(moon.epochs.length > 2);
    await app.select("sc_juno");
    const craft = fixtures
      .trails()
      .filter((t) => t.id === "sc_juno" && t.count > 0)
      .at(-1)!;
    assert.equal(craft.kind, "trail");
    assert.equal(craft.conic, undefined);
    assert.ok(craft.duration! > 0);
  } finally {
    await app.dispose();
  }
});

test("observation retains selection, reference dependencies, and parent surface", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (value) => states.push(value),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    await app.select("sc_iss");
    assert.ok(
      fixtures.visuals().some((v) => v.id === "earth" && v.spec.faceAssets),
    );
    await app.observation("system");
    assert.equal(states.at(-1)!.selected, "sc_iss");
    await app.follow("earth");
    assert.equal(states.at(-1)!.selected, "sc_iss");
    assert.equal(states.at(-1)!.followId, "earth");
    await app.seek(states.at(-1)!.epoch + 1);
    assert.equal(states.at(-1)!.observationMode, "follow");
    await assert.rejects(app.follow("sc_iss"));
  } finally {
    await app.dispose();
  }
});

test("latest observation intent wins for the same target and focus cancels pending observation", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    await app.select("earth");
    const first = app.observation("follow", "moon");
    const second = app.observation("system");
    await Promise.all([first, second]);
    assert.equal(states.at(-1)!.observationMode, "system");
    assert.equal(states.at(-1)!.followId, undefined);
    const pending = app.observation("follow", "moon");
    app.focus();
    await pending;
    assert.equal(states.at(-1)!.observationMode, "nearby");
    assert.equal(states.at(-1)!.followId, undefined);
  } finally {
    await app.dispose();
  }
});

test("unavailable follow reference restores nearby without changing selection or time", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        String(input).includes("sc_iss")
          ? new Response("unavailable", { status: 503 })
          : new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    await app.select("earth");
    await app.follow("moon");
    const epoch = states.at(-1)!.epoch;
    await assert.rejects(app.follow("sc_iss"));
    assert.equal(states.at(-1)!.selected, "earth");
    assert.equal(states.at(-1)!.epoch, epoch);
    assert.equal(states.at(-1)!.observationMode, "nearby");
    assert.equal(states.at(-1)!.followId, undefined);
    assert.match(states.at(-1)!.error, /近景/);
  } finally {
    await app.dispose();
  }
});

test("follow reference dependencies stop at the solar scene root", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const requests: string[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) => {
        requests.push(String(input));
        return new Response(sample(String(input).includes("type=ori")));
      },
    },
  );
  try {
    await app.select("earth");
    await app.follow("moon");
    assert.equal(states.at(-1)!.followId, "moon");
    assert.doesNotMatch(states.at(-1)!.error, /Observable Universe|Milky Way/);
    assert.ok(requests.every((url) => !/universe|milky|galaxy/i.test(url)));
  } finally {
    await app.dispose();
  }
});

test("LIVE distinguishes wall time, history, pause and reverse now semantics", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (value) => states.push(value),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    app.play(true, 1);
    await app.now();
    assert.equal(states.at(-1)!.live, true);
    await app.seek(0);
    assert.equal(states.at(-1)!.live, false);
    app.play(false, 1);
    await app.now();
    assert.equal(states.at(-1)!.live, false);
    assert.equal(states.at(-1)!.playing, false);
    app.play(true, -60);
    await app.now();
    assert.equal(states.at(-1)!.live, false);
    assert.equal(states.at(-1)!.rate, -60);
    assert.equal(states.at(-1)!.playing, true);
  } finally {
    await app.dispose();
  }
  assert.equal(states.at(-1)!.live, false);
});

test("now catches up after loading only inside ready coverage", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const originalNow = Date.now;
  let clock = originalNow();
  let loading = false;
  Date.now = () => clock;
  let app: Awaited<ReturnType<typeof createWorkspace>> | undefined;
  try {
    app = await createWorkspace(
      "#test",
      (value) => states.push(value),
      new AbortController().signal,
      {
        ...fixtures,
        fetch: async (input) => {
          if (loading) clock += 2000;
          return new Response(sample(String(input).includes("type=ori")));
        },
      },
    );
    app.play(true, 1);
    loading = true;
    await app.now();
    assert.equal(states.at(-1)!.live, true);
    assert.ok(
      Math.abs(
        fixtures.core().tdb_to_utc(states.at(-1)!.epoch) * 1000 - clock,
      ) < 1,
    );
  } finally {
    Date.now = originalNow;
    await app?.dispose();
  }
});

test("workspace starts at real rate with LIVE when current coverage is available", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    assert.equal(states.at(-1)!.playing, true);
    assert.equal(states.at(-1)!.rate, 1);
    assert.equal(states.at(-1)!.live, true);
  } finally {
    await app.dispose();
  }
});

test("host lighting publishes validated mode and resets snapshot on disposal", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    assert.equal(states.at(-1)!.lighting, "shadow");
    app.lighting("shadow");
    assert.equal(states.at(-1)!.lighting, "shadow");
    app.lighting("flood");
    assert.equal(states.at(-1)!.lighting, "flood");
    assert.throws(() => app.lighting("bad" as "natural"));
    assert.equal(states.at(-1)!.lighting, "flood");
  } finally {
    await app.dispose();
  }
  assert.equal(states.at(-1)!.lighting, "natural");
  assert.throws(() => app.lighting("natural"));
});

test("scene cache diagnostics stay bounded across scene changes and failed time rollback", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"), 1e9)),
    },
  );
  try {
    app.play(false, 1);
    await app.seek(100);
    await app.select("earth");
    await app.select("jupiter");
    const before = states.at(-1)!.dataCache;
    assert.ok(before.records > 0 && before.records <= before.maxRecords);
    assert.ok(before.positionEntries > 0 && before.positionEntries <= 256);
    await assert.rejects(app.seek(2e9));
    assert.equal(states.at(-1)!.epoch, 100);
    assert.ok(states.at(-1)!.dataCache.records <= before.maxRecords);
  } finally {
    await app.dispose();
  }
  assert.equal(states.at(-1)!.dataCache.records, 0);
});

test("missing dynamic orientation keeps position ready and reports attitude unavailable", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        String(input).includes("type=ori")
          ? new Response("missing orientation", { status: 503 })
          : new Response(sample()),
    },
  );
  try {
    await app.select("earth");
    assert.match(states.at(-1)!.dataStatus, /^ready/);
    assert.match(states.at(-1)!.attitude, /姿态不可用/);
    assert.match(states.at(-1)!.attitude, /不作真实姿态声明/);
  } finally {
    await app.dispose();
  }
});

test("overview warnings describe retained scene failures only", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        /sc_iss|mars/.test(String(input))
          ? new Response("unavailable", { status: 503 })
          : new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    await assert.rejects(app.select("sc_iss"));
    app.overview();
    assert.doesNotMatch(
      states.at(-1)!.error,
      /ISS|International Space Station|国际空间站/i,
    );
    assert.match(states.at(-1)!.error, /火星|Mars/);
  } finally {
    await app.dispose();
  }
});

test("restore scene applies one epoch and follow state and newer selection wins", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  const link: SceneLinkState = {
    targetId: "earth",
    epoch: 100,
    rate: -60,
    playing: false,
    mode: "follow",
    followId: "moon",
    view: "top",
    lighting: "shadow",
    fovDegrees: 60,
    labels: false,
    trajectories: false,
    trails: false,
    moons: true,
    spacecraft: false,
  };
  try {
    await app.restoreScene(link);
    assert.equal(states.at(-1)!.epoch, 100);
    assert.equal(states.at(-1)!.selected, "earth");
    assert.equal(states.at(-1)!.followId, "moon");
    assert.equal(states.at(-1)!.observationMode, "follow");
    assert.equal(states.at(-1)!.rate, -60);
    await assert.rejects(app.restoreScene({ ...link, targetId: "unknown" }));
    const pending = app.restoreScene(link);
    const selecting = app.select("mars");
    await Promise.all([pending, selecting]);
    assert.equal(states.at(-1)!.selected, "mars");
  } finally {
    await app.dispose();
  }
  await assert.rejects(app.restoreScene(link));
});

test("new seek and invalid restore supersede pending scene restore", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (state) => states.push(state),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  const link: SceneLinkState = {
    targetId: "earth",
    epoch: 100,
    rate: -60,
    playing: true,
    mode: "nearby",
    view: "top",
    lighting: "shadow",
    fovDegrees: 60,
    labels: false,
    trajectories: false,
    trails: false,
    moons: true,
    spacecraft: false,
  };
  try {
    app.play(false, 1);
    const pending = app.restoreScene(link);
    const seek = app.seek(200);
    await Promise.all([pending, seek]);
    assert.equal(states.at(-1)!.epoch, 200);
    assert.notEqual(states.at(-1)!.rate, -60);
    const before = states.at(-1)!.epoch;
    const older = app.restoreScene(link);
    await assert.rejects(app.restoreScene({ ...link, targetId: "invalid" }));
    await older;
    assert.equal(states.at(-1)!.epoch, before);
    assert.notEqual(states.at(-1)!.rate, -60);
    assert.equal(states.at(-1)!.busy, false);
  } finally {
    await app.dispose();
  }
});

test("invalid navigation cancels pending target without changing completed focus", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (v) => states.push(v),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  const link: SceneLinkState = {
    targetId: "sc_iss",
    epoch: 100,
    rate: 1,
    playing: false,
    mode: "nearby",
    view: "orbit",
    lighting: "natural",
    fovDegrees: 45,
    labels: true,
    trajectories: true,
    trails: true,
    moons: true,
    spacecraft: true,
  };
  try {
    await app.select("earth");
    const pending = app.restoreScene(link);
    await assert.rejects(app.restoreScene({ ...link, targetId: "invalid" }));
    await pending;
    assert.equal(states.at(-1)!.selected, "earth");
    assert.equal(fixtures.focused(), "earth");
  } finally {
    await app.dispose();
  }
});

test("selected object recovering coverage restores focus and survives next frame", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  let unavailable = true;
  const app = await createWorkspace(
    "#test",
    (s) => states.push(s),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        unavailable && String(input).includes("sc_iss")
          ? new Response("outside source coverage", { status: 503 })
          : new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    await assert.rejects(app.select("sc_iss"));
    assert.equal(fixtures.focused(), undefined);
    unavailable = false;
    await app.now();
    fixtures.step(1000);
    assert.equal(states.at(-1)!.selected, "sc_iss");
    assert.equal(fixtures.focused(), "sc_iss");
  } finally {
    await app.dispose();
  }
});

test("entity align source is explicit and landed InSight retains parent orientation", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const requests: string[] = [];
  const app = await createWorkspace(
    "#test",
    (s) => states.push(s),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("sc_cluster_ii_fm5") && url.includes("type=ori"))
          return new Response("No orientation track", { status: 503 });
        return new Response(sample(url.includes("type=ori")));
      },
    },
  );
  try {
    await app.select("sc_cluster_ii_fm5");
    assert.match(states.at(-1)!.attitude, /控制器推导姿态/);
    assert.match(states.at(-1)!.attitude, /非实测/);
    assert.ok(
      !requests.some(
        (url) => url.includes("sc_cluster_ii_fm5") && url.includes("type=ori"),
      ),
    );
    await app.select("sc_insight");
    assert.match(states.at(-1)!.dataStatus, /^ready/);
    assert.equal(states.at(-1)!.parentId, "mars");
    assert.match(states.at(-1)!.source, /固定控制器位置/);
    assert.match(states.at(-1)!.coverage, /平台求值范围，非观测覆盖终点/);
    assert.ok(
      JSON.parse(fixtures.core().state_at("mars", states.at(-1)!.epoch))
        .orientationWxyz,
    );
  } finally {
    await app.dispose();
  }
});

test("actual L1 align reference frame is resolved without a fabricated display body", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (s) => states.push(s),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    await app.select("sc_solar_1");
    assert.equal(fixtures.focused(), "sc_solar_1");
    assert.doesNotMatch(states.at(-1)!.error, /Invalid retained scene/);
    assert.ok(!fixtures.visuals().some((v) => v.id === "j2000_ecliptic"));
  } finally {
    await app.dispose();
  }
});

test("first ISS selection loads Earth orientation before upgrading parent surface", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const requests: string[] = [];
  const app = await createWorkspace(
    "#test",
    (s) => states.push(s),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) => {
        const url = String(input);
        requests.push(url);
        return new Response(sample(url.includes("type=ori")));
      },
    },
  );
  try {
    await app.select("sc_iss");
    assert.ok(
      requests.some(
        (url) => url.includes("/earth?") && url.includes("type=ori"),
      ),
    );
    assert.ok(
      JSON.parse(fixtures.core().state_at("earth", states.at(-1)!.epoch))
        .orientationWxyz,
    );
    assert.match(states.at(-1)!.attitude, /推导姿态|DYN 姿态/);
  } finally {
    await app.dispose();
  }
});

test("unselected coverage gaps are informational while HTTP failures and selected gaps remain errors", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  let broken = false;
  let coveragePublished!: () => void;
  const coverageReady = new Promise<void>((resolve) => { coveragePublished = resolve; });
  const app = await createWorkspace(
    "#test",
    (s) => {
      states.push(s);
      if (/项当前时间无覆盖/.test(s.phase)) coveragePublished();
    },
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("sc_juno") && broken)
          return new Response("server unavailable", { status: 503 });
        return new Response(
          sample(
            url.includes("type=ori"),
            url.includes("sc_cluster_ii_fm5") ? 100 : 4e9,
          ),
        );
      },
    },
  );
  try {
    await app.select("earth");
    await coverageReady;
    assert.doesNotMatch(states.at(-1)!.error, /Rumba/);
    assert.match(states.at(-1)!.phase, /项当前时间无覆盖/);
    await assert.rejects(app.select("sc_cluster_ii_fm5"));
    assert.ok(states.at(-1)!.error);
    broken = true;
    await assert.rejects(app.select("sc_juno"));
    assert.ok(states.at(-1)!.error);
  } finally {
    await app.dispose();
  }
});

test("InSight landing clears a previously dynamic trajectory without a static-orbit error", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace(
    "#test",
    (s) => states.push(s),
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    await app.seek(590000000);
    await app.select("sc_insight");
    assert.ok(
      fixtures.trails().some((t) => t.id === "sc_insight" && t.count > 0),
    );
    await app.seek(600000000);
    assert.equal(
      fixtures
        .trails()
        .filter((t) => t.id === "sc_insight")
        .at(-1)!.count,
      0,
    );
    assert.doesNotMatch(states.at(-1)!.error, /Orbit unavailable|轨道不可用/);
    assert.match(states.at(-1)!.dataStatus, /^ready/);
  } finally {
    await app.dispose();
  }
});

test("pause during high-rate coverage reload is honored when loading finishes", async () => {
  const fixtures = harness();
  const app = await createWorkspace(
    "#test",
    () => {},
    new AbortController().signal,
    {
      ...fixtures,
      fetch: async (input) =>
        new Response(sample(String(input).includes("type=ori"))),
    },
  );
  try {
    app.play(true, 57600);
    const paused = fixtures.waitForPause();
    const reload = app.seek(200);
    await paused;
    app.play(false, 57600);
    await reload;
    assert.equal(fixtures.core().playing(), false);
    assert.equal(fixtures.core().epoch(), 200);
  } finally {
    await app.dispose();
  }
});


test("selection focuses before supplementary spacecraft data completes", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let blocked = false;
  let backgroundPublished: (() => void) | undefined;
  const app = await createWorkspace("#test", (value) => {
    states.push(value);
    backgroundPublished?.();
  }, new AbortController().signal, {
    ...fixtures,
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("sc_")) { blocked = true; await gate; }
      return new Response(sample(url.includes("type=ori")));
    },
  });
  try {
    await app.select("earth");
    assert.equal(fixtures.focused(), "earth");
    assert.equal(states.at(-1)!.busy, false);
    // Supplementary work is still scheduled while the selected target is usable.
    assert.equal(blocked, true);
    app.play(true, 60);
    fixtures.step(0);
    fixtures.step(1000);
    const advanced = fixtures.core().epoch();
    const published = new Promise<void>((resolve) => { backgroundPublished = resolve; });
    release();
    await published;
    backgroundPublished = undefined;
    assert.equal(fixtures.core().epoch(), advanced);
    assert.equal(JSON.parse(fixtures.core().state_at("earth", advanced)).epochTdbSeconds, advanced);
    assert.equal(fixtures.focused(), "earth");
    await app.select("mercury");
    assert.equal(fixtures.focused(), "mercury");
  } finally {
    release();
    await app.dispose();
  }
});


test("superseded supplementary load cannot restore the previous selection", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let blocked = false;
  let drained!: () => void;
  const completed = new Promise<void>((resolve) => { drained = resolve; });
  const app = await createWorkspace("#test", (value) => states.push(value), new AbortController().signal, {
    ...fixtures,
    fetch: async (input, options) => {
      const url = String(input);
      if (url.includes("sc_")) {
        blocked = true;
        await Promise.race([
          gate,
          new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true })),
        ]);
        drained();
      }
      return new Response(sample(url.includes("type=ori")));
    },
  });
  try {
    await app.select("earth");
    assert.equal(blocked, true);
    await app.select("mars");
    assert.equal(fixtures.focused(), "mars");
    release();
    await completed;
    // Flush completion callbacks without advancing the simulation clock.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(fixtures.focused(), "mars");
    assert.equal(states.at(-1)!.selected, "mars");
    assert.equal(states.at(-1)!.busy, false);
  } finally {
    release();
    await app.dispose();
  }
});
test("expired orbit maintenance publishes at most one path per animation frame", async () => {
  const fixtures = harness();
  const app = await createWorkspace("#test", () => {}, new AbortController().signal, {
    ...fixtures,
    fetch: async (input) => new Response(sample(String(input).includes("type=ori"))),
  });
  try {
    const before = fixtures.trails().length;
    // Advance authoritative time independently of cosmetic trajectory cache windows.
    fixtures.seekEpoch(2e9);
    fixtures.step(200);
    assert.ok(fixtures.trails().length - before <= 1,
      `one frame rebuilt ${fixtures.trails().length - before} paths`);
    assert.equal(fixtures.core().epoch(), 2e9);
    for (let frame = 1; frame < 12; frame++) {
      const count = fixtures.trails().length;
      fixtures.step(200 + frame * 16);
      assert.ok(fixtures.trails().length - count <= 1);
    }
    const refreshed = fixtures.trails().slice(before).map((trail) => trail.id);
    assert.ok(new Set(refreshed).size > 1, "maintenance must progress through background objects");
    assert.ok(Math.abs(fixtures.core().epoch() - (2e9 + 0.176)) < 0.00001, "cosmetic maintenance preserves elapsed simulation time");
  } finally {
    await app.dispose();
  }
});

 test("selected ISS uses bounded trail geometry while covered 480x time keeps advancing", async () => {
  const fixtures = harness();
  const app = await createWorkspace("#test", () => {}, new AbortController().signal, {
    ...fixtures,
    fetch: async (input) => new Response(sample(String(input).includes("type=ori"))),
  });
  try {
    await app.select("sc_iss");
    const selected = fixtures.trails().filter((trail) => trail.id === "sc_iss");
    assert.ok(selected.some((trail) => trail.count > 0));
    assert.ok(selected.every((trail) => trail.count <= 256));
    app.play(true, 480);
    fixtures.step(0);
    const start = fixtures.core().epoch();
    for (let index = 1; index <= 60; index++) {
      fixtures.step(index * 16);
      assert.equal(fixtures.core().playing(), true);
    }
    assert.ok(Math.abs(fixtures.core().epoch() - start - 460.8) < 0.001);
    assert.ok(fixtures.trails().filter((trail) => trail.id === "sc_iss").every((trail) => trail.count <= 256));
  } finally { await app.dispose(); }
});
test("unrelated expired Moon coverage loads in background without pausing covered ISS", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  let armed = false;
  let release: (() => void) | undefined;
  const app = await createWorkspace("#test", (state) => states.push(state), new AbortController().signal, {
    ...fixtures,
    fetch: async (input) => {
      const url = new URL(String(input), "http://localhost");
      const moon = url.pathname.endsWith("/moon");
      if (armed && moon && Number(url.searchParams.get("epoch")) > 846686628)
        await new Promise<void>((resolve) => { release = resolve; });
      return new Response(sample(url.searchParams.get("type") === "ori", moon ? 846686628 : 4e9));
    },
  });
  try {
    await app.seek(846686628 - 1);
    await app.select("sc_iss");
    armed = true;
    app.play(true, 480);
    fixtures.step(0);
    fixtures.step(16);
    fixtures.step(32);
    assert.equal(fixtures.core().playing(), true, JSON.stringify(states.at(-1)));
    assert.ok(Math.abs(fixtures.core().epoch() - (846686628 - 1 + 15.36)) < 0.001);
    assert.equal(states.at(-1)!.busy, false);
    release?.();
    await Promise.resolve();
    await Promise.resolve();
    fixtures.step(48);
    assert.equal(fixtures.core().playing(), true, JSON.stringify(states.at(-1)));
    assert.ok(fixtures.core().epoch() > 846686628 + 20);
  } finally {
    release?.();
    await app.dispose();
  }
});
for (const failed of [false, true]) {
  test(`overview expired secondary retry is bounded without stopping time: failed=${failed}`, async () => {
    const fixtures = harness();
    let armed = false;
    let retries = 0;
    const app = await createWorkspace("#test", () => {}, new AbortController().signal, {
      ...fixtures,
      fetch: async (input) => {
        const url = new URL(String(input), "http://localhost");
        const moon = url.pathname.endsWith("/moon");
        if (armed && moon) {
          retries++;
          if (failed) return new Response("unavailable", {status: 503});
        }
        return new Response(sample(url.searchParams.get("type") === "ori", moon ? 846686628 : 4e9));
      },
    });
    try {
      await app.seek(846686627);
      armed = true;
      app.play(true, 480);
      fixtures.step(0);
      for (let index = 1; index <= 60; index++) {
        fixtures.step(index * 16);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(fixtures.core().playing(), true);
      }
      assert.ok(retries > 0 && retries <= 1, `secondary fetches within 960ms: ${retries}`);
      assert.ok(Math.abs(fixtures.core().epoch() - (846686627 + 460.8)) < 0.001);
    } finally { await app.dispose(); }
  });
}
test("selected ISS coverage reload resumes before supplementary objects finish", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  let armed = false;
  let blocked = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const app = await createWorkspace("#test", (state) => states.push(state), new AbortController().signal, {
    ...fixtures,
    fetch: async (input) => {
      const url = new URL(String(input), "http://localhost");
      const epoch = Number(url.searchParams.get("epoch"));
      const iss = url.pathname.endsWith("/sc_iss");
      const secondary = !iss && !url.pathname.endsWith("/earth") && !url.pathname.endsWith("/sun");
      if (armed && secondary) { blocked = true; await gate; }
      return new Response(sample(url.searchParams.get("type") === "ori", !armed && iss ? 846686628 : 4e9));
    },
  });
  try {
    await app.seek(846686627);
    await app.select("sc_iss");
    armed = true;
    app.play(true, 480);
    fixtures.step(0);
    fixtures.step(16);
    for (let attempt = 0; attempt < 100 && (states.at(-1)!.busy || !blocked); attempt++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(blocked, true, "supplementary source is still pending");
    assert.equal(states.at(-1)!.busy, false);
    assert.equal(fixtures.core().playing(), true);
    assert.equal(fixtures.focused(), "sc_iss");
    const epoch = fixtures.core().epoch();
    fixtures.step(32);
    fixtures.step(48);
    assert.ok(fixtures.core().epoch() > epoch);
  } finally { release(); await app.dispose(); }
});

test("follow Moon coverage reload preserves reference before supplementary objects finish", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  let armed = false;
  let blocked = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const app = await createWorkspace("#test", (state) => states.push(state), new AbortController().signal, {
    ...fixtures,
    fetch: async (input) => {
      const url = new URL(String(input), "http://localhost");
      const epoch = Number(url.searchParams.get("epoch"));
      const iss = url.pathname.endsWith("/sc_iss");
      const moon = url.pathname.endsWith("/moon");
      const secondary = !moon && !iss && !url.pathname.endsWith("/earth") && !url.pathname.endsWith("/sun");
      if (armed && secondary) { blocked = true; await gate; }
      return new Response(sample(url.searchParams.get("type") === "ori", !armed && (moon || secondary) ? 846686628 : 4e9));
    },
  });
  try {
    await app.seek(846686627);
    await app.select("sc_iss");
    await app.follow("moon");
    armed = true;
    app.play(true, 480);
    fixtures.step(0);
    fixtures.step(16);
    for (let attempt = 0; attempt < 100 && (states.at(-1)!.busy || !blocked); attempt++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(blocked, true, JSON.stringify(states.at(-1)));
    assert.equal(states.at(-1)!.busy, false);
    assert.equal(fixtures.core().playing(), true);
    assert.equal(fixtures.focused(), "sc_iss");
    assert.equal(states.at(-1)!.observationMode, "follow");
    assert.equal(states.at(-1)!.followId, "moon");
    const epoch = fixtures.core().epoch();
    fixtures.step(32);
    fixtures.step(48);
    assert.ok(fixtures.core().epoch() > epoch);
  } finally { release(); await app.dispose(); }
});
test("background coverage recovery restores only the removed object's visual", async () => {
  const fixtures = harness();
  let armed = false;
  const app = await createWorkspace("#test", () => {}, new AbortController().signal, {
    ...fixtures,
    fetch: async (input) => {
      const url = new URL(String(input), "http://localhost");
      const moon = url.pathname.endsWith("/moon");
      return new Response(sample(url.searchParams.get("type") === "ori", moon && !armed ? 846686628 : 4e9));
    },
  });
  try {
    await app.seek(846686627);
    const before = fixtures.visuals().length;
    armed = true;
    app.play(true, 480);
    fixtures.step(0);
    fixtures.step(16);
    for (let frame = 2; frame < 20 && fixtures.visuals().length === before; frame++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      fixtures.step(frame * 16);
    }
    const restored = fixtures.visuals().slice(before);
    assert.deepEqual(restored.map((entry) => entry.id), ["moon"]);
    assert.equal(fixtures.core().playing(), true);
  } finally { await app.dispose(); }
});

test("dense Earth scene keeps resolved long spacecraft histories without starving the point pool", {timeout: 5000}, async () => {
  const fixtures = harness();
  let completed!: () => void;
  const ready = new Promise<void>(resolve => { completed = resolve; });
  const app = await createWorkspace("#test", (value) => {
    if (value.selected === "earth" && value.dataCache.positionEntries > 40) completed();
  }, new AbortController().signal, {
    ...fixtures, fetch: async input => new Response(sample(String(input).includes("type=ori"))),
  });
  try {
    await app.select("earth");
    await ready;
    for (let frame = 0; frame < 150; frame++) {
      const before = fixtures.trails().length;
      fixtures.step(frame * 16);
      assert.ok(fixtures.trails().length - before <= 1, "initial trails also share the per-frame limit");
    }
    const trails = fixtures.trails().filter(t => t.id.startsWith("sc_") && t.kind === "trail");
    assert.ok(trails.length > 40, `exercise a dense real catalog system: ${trails.length} trails ${JSON.stringify(trails.slice(0,3))}`);
    assert.ok(trails.every(t => t.count >= 2 && t.count <= 256));
    const latest = new Map(fixtures.trails().map(t => [t.id, t]));
    assert.ok([...latest.values()].reduce((sum,t) => sum + t.count, 0) <= 16384);
    await app.select("sc_iss");
    assert.equal(fixtures.focused(), "sc_iss");
  } finally { await app.dispose(); }
});

test("selecting a moon-bearing planet frames its ready primary satellite family", async () => {
  const fixtures = harness();
  const states: SolarSnapshot[] = [];
  const app = await createWorkspace("#test", value => states.push(value), new AbortController().signal, {
    ...fixtures, fetch: async input => new Response(sample(String(input).includes("type=ori"))),
  });
  try {
    for (const [planet, moons] of [["mars",["phobos","deimos"]],["jupiter",["io","europa","ganymede","callisto"]],["saturn",["titan","mimas"]],["uranus",["ariel","titania"]],["neptune",["triton"]]] as const) {
      await app.select(planet);
      assert.equal(states.at(-1)!.observationMode, "system");
      const view = JSON.parse(fixtures.core().camera_observation!());
      assert.equal(view.mode, "system");
      for (const id of [planet,...moons]) assert.ok(view.members.includes(id), `${planet} family contains ${id}`);
      app.focus();
      assert.equal(states.at(-1)!.observationMode, "nearby");
    }
    await app.select("mercury");
    assert.equal(states.at(-1)!.observationMode, "nearby");
    await app.groups(false, false);
    await app.select("jupiter");
    assert.equal(states.at(-1)!.observationMode, "nearby");
  } finally { await app.dispose(); }
});

test("satellite system context survives independent orbit and trail switches", async () => {
  const fixtures = harness();
  const app = await createWorkspace("#test", () => {}, new AbortController().signal, {
    ...fixtures, fetch: async input => new Response(sample(String(input).includes("type=ori"))),
  });
  try {
    await app.select("sc_iss");
    assert.equal(JSON.parse(fixtures.core().camera_observation!()).systemId, "earth");
    app.trails(false);
    assert.equal(JSON.parse(fixtures.core().camera_observation!()).systemId, "earth");
    await app.select("moon");
    app.layers(true, false);
    assert.equal(JSON.parse(fixtures.core().camera_observation!()).systemId, "earth");
    app.trails(true);
    assert.equal(JSON.parse(fixtures.core().camera_observation!()).systemId, "earth");
    app.layers(true, true);
    await app.select("io");
    assert.equal(JSON.parse(fixtures.core().camera_observation!()).systemId, "jupiter");
  } finally { await app.dispose(); }
});

test("focused mission refreshes its system across parent stages with its trail disabled", async () => {
  const fixtures = harness();
  const app = await createWorkspace("#test", () => {}, new AbortController().signal, {
    ...fixtures, fetch: async input => new Response(sample(String(input).includes("type=ori"))),
  });
  try {
    await app.seek(-11800000);
    await app.select("sc_cassini");
    app.trails(false);
    assert.equal(JSON.parse(fixtures.core().camera_observation!()).systemId, "earth");
    await app.seek(-11500000);
    assert.equal(JSON.parse(fixtures.core().camera_observation!()).systemId, undefined);
    await app.seek(139220000);
    assert.equal(JSON.parse(fixtures.core().camera_observation!()).systemId, "saturn");
    assert.equal(fixtures.focused(), "sc_cassini");
  } finally { await app.dispose(); }
});
