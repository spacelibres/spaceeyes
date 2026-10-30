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
    number(1);
    number(2);
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

function harness() {
  const visuals: { id: string; spec: Record<string, any> }[] = [];
  let core: HostCore;
  let freed = 0;
  let callback: FrameRequestCallback | undefined;
  let pauseSignal: (() => void) | undefined;
  class TestCore {
    constructor() {
      const actual = new WasmCore();
      core = new Proxy(actual, {
        get(target, property) {
          if (property === "start_renderer" || property === "stop_renderer")
            return () => {};
          if (property === "free")
            return () => {
              freed++;
              actual.free();
            };
          const value = Reflect.get(target, property);
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
