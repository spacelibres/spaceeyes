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
  }[] = [];
  let core: HostCore;
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
              trails.push({
                id: args[2],
                epochs: payload.epochs,
                count: payload.points.length,
                closed:
                  JSON.stringify(payload.points[0]) ===
                  JSON.stringify(payload.points.at(-1)),
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
      ["earth"],
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
    assert.ok(trail.count > 1024 && trail.count <= 2048);
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
    for (const id of ["phobos", "sc_iss", "sc_juno"]) {
      await app.select(id);
      const visual = fixtures
        .visuals()
        .filter((v) => v.id === id)
        .at(-1)!;
      assert.equal(visual.spec.kind, "model");
      assert.equal(visual.spec.assetId, `eyes:${id}:model`);
      assert.equal(visual.spec.scaleKmPerUnit, 1);
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
  app.follow();
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

test("overview leaves surfaces external and selection requests only that body's resources once", async () => {
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
    assert.equal(
      fixtures.visuals().some(({ spec }) => spec.faceAssets || spec.ringAssets),
      false,
    );
    assert.equal(
      requested.some((url) => url.includes("type=ori")),
      false,
    );
    await app.select("earth");
    assert.deepEqual(
      fixtures
        .visuals()
        .filter(({ spec }) => spec.faceAssets)
        .map(({ id }) => id),
      ["earth"],
    );
    await app.select("saturn");
    assert.deepEqual(
      requested
        .filter((url) => url.includes("type=ori"))
        .map((url) => url.split("/").at(-1)?.split("?")[0]),
      ["earth", "saturn"],
    );
    const detailed = fixtures.visuals().filter(({ spec }) => spec.faceAssets);
    assert.deepEqual(
      detailed.map(({ id }) => id),
      ["earth", "saturn"],
    );
    assert.equal(detailed[1].spec.ringAssets.length, 2);
    await app.select("earth");
    app.overview();
    await app.seek(0);
    app.layers(false, false);
    assert.equal(
      fixtures.visuals().filter(({ spec }) => spec.faceAssets).length,
      2,
    );
    assert.equal(
      fixtures
        .visuals()
        .some(({ id, spec }) => id === "moon" && spec.faceAssets),
      false,
    );
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
