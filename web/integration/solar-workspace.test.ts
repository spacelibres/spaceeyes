import type { SceneLinkState } from "../lib/scene-link.ts";
import { StarfieldSource } from "../../platform/starfield-source.ts";
import { solarWorkspaceSettings } from "../lib/solar-settings.ts";
import {eyesModelPhase} from "../../platform/eyes-model-phases.ts";
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
  const registeredAssets=new Set<string>();
  const labelCalls:{id:string;text:string}[]=[];
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
  let measuredWorkMs=0;
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
          if(property==="register_asset") return (...args:any[])=>{
            const result=Reflect.apply(value,target,args);
            registeredAssets.add(args[0]);return result;
          };
          if (property === "label") return (...args:any[]) => {
            labelCalls.push({id:args[2],text:args[3]});
            return Reflect.apply(value,target,args);
          };
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
    workClock:()=>{measuredWorkMs+=.001;return measuredWorkMs;},
    requestFrame: (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    },
    cancelFrame: () => {
      callback = undefined;
    },
    step: (time: number) => {measuredWorkMs=Math.max(measuredWorkMs,time);callback?.(time);},
    visuals: () => visuals,
    registeredAssets: () => registeredAssets,
    labelCalls: () => labelCalls,
    solar: () => solar,
    focusCalls: () => focusCalls,
    trails: () => trails,
    setPick: (id: string | undefined) => {
      picked = id;
    },
    freed: () => freed,
    core: () => core!,
    seekEpoch: (epoch: number) => core.seek(...timeSession, epoch),
    clearCoreFocus: () => core.camera_view!(...timeSession, "overview"),
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

test("coverage names update at scene entry, direct seek and reverse ticks without repeated label writes",async()=>{
 const fixtures=harness();
 const app=await createWorkspace("#test",()=>{},new AbortController().signal,{
   ...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori"))),
 });
 const last=(id:string)=>fixtures.labelCalls().filter(c=>c.id===id).at(-1)?.text;
 try {
   app.play(false,1);
   const boundary=264427265;
   await app.seek(boundary-1);await app.select("sc_themis_b");
   assert.equal(last("sc_themis_b"),"THEMIS B");
   await app.seek(boundary+1);
   assert.equal(last("sc_themis_b"),"ARTEMIS P1");
   fixtures.seekEpoch(boundary);fixtures.step(0);
   assert.equal(last("sc_themis_b"),"THEMIS B");
   await app.seek(boundary); // Settle the controller-boundary reload before checking idle writes.
   const count=fixtures.labelCalls().filter(c=>c.id==="sc_themis_b").length;
   fixtures.step(100);fixtures.step(200);
   assert.equal(fixtures.labelCalls().filter(c=>c.id==="sc_themis_b").length,count,"stable phase does not rewrite labels each frame");
   await app.seek(748838792);await app.select("sc_osiris_rex");
   assert.equal(last("sc_osiris_rex"),"OSIRIS-REX");
   await app.seek(748838793);
   assert.equal(last("sc_osiris_rex"),"OSIRIS-APEX");
   await app.seek(748838792);
   assert.equal(last("sc_osiris_rex"),"OSIRIS-REX");
 }finally{await app.dispose();}
});

test("model phase resources switch on seek and playback without replacing unchanged visual revisions",async()=>{
 const fixtures=harness();
 const states:SolarSnapshot[]=[];
 const app=await createWorkspace("#test",s=>states.push(s),new AbortController().signal,{
   ...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori"))),
 });
 const modelCalls=(id:string)=>fixtures.visuals().filter(v=>v.id===id&&v.spec.kind==="model");
 const expected=(id:string,t:number)=>`eyes:${id}:model:${eyesModelPhase(id,t)!.key}`;
 try {
   app.play(false,1);
   const boundary=694937889.184;
   await app.seek(boundary);await app.select("sc_jwst");
   assert.equal(modelCalls("sc_jwst").at(-1)?.spec.assetId,expected("sc_jwst",boundary));
   assert.ok(!states.at(-1)?.error);
   fixtures.seekEpoch(boundary+1);fixtures.step(0);
   assert.equal(modelCalls("sc_jwst").at(-1)?.spec.assetId,expected("sc_jwst",boundary+1));
   const count=modelCalls("sc_jwst").length;
   fixtures.step(100);fixtures.step(200);
   assert.equal(modelCalls("sc_jwst").length,count,"stable phase must not reset model loading each frame");
   await app.seek(boundary-1);
   assert.equal(modelCalls("sc_jwst").at(-1)?.spec.assetId,expected("sc_jwst",boundary-1));
   await app.seek(157212063);await app.select("sc_cassini");
   const before=modelCalls("sc_cassini").at(-1)!.spec.assetId;
   await app.seek(157212064.184);
   assert.notEqual(modelCalls("sc_cassini").at(-1)!.spec.assetId,before,"Huygens separation switches to the hidden-probe variant");
   await app.seek(157212063);
   assert.equal(modelCalls("sc_cassini").at(-1)!.spec.assetId,before);
 }finally{await app.dispose();}
});

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
        if (url.includes("epoch=1400000000")) {
          began();
          await gate;
        }
        return new Response(
          sample(
            url.includes("type=ori"),
            url.includes("epoch=1400000000") ? 2e9 : 1e9,
          ),
        );
      },
    },
  );
  try {
    const before = fixtures.core().epoch();
    // Force a request outside the initial loaded coverage.
    const seeking = app.seek(1.4e9);
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
  assert.match(states.at(-1)!.dataStatus, /^failed/);
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
    app.play(false, 1);
    for (let frame = 0; frame < 1000 && !fixtures.trails().some(t => t.id === "sc_juno" && t.count > 0); frame++) fixtures.step(frame * 16);
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
    await assert.rejects(app.seek(1.4e9));
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
    app.play(false, 1);
    for (let frame = 0; frame < 1000 && !fixtures.trails().some(t => t.id === "sc_insight" && t.count > 0); frame++) fixtures.step(frame * 16);
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
    fixtures.seekEpoch(1.4e9);
    fixtures.step(200);
    assert.ok(fixtures.trails().length - before <= 1,
      `one frame rebuilt ${fixtures.trails().length - before} paths`);
    assert.equal(fixtures.core().epoch(), 1.4e9);
    for (let frame = 1; frame < 12; frame++) {
      const count = fixtures.trails().length;
      fixtures.step(200 + frame * 20);
      assert.ok(fixtures.trails().length - count <= 1);
    }
    const refreshed = fixtures.trails().slice(before).map((trail) => trail.id);
    assert.ok(new Set(refreshed).size > 1, "maintenance must progress through background objects");
    assert.ok(Math.abs(fixtures.core().epoch() - (1.4e9 + 0.22)) < 0.00001, "cosmetic maintenance preserves elapsed simulation time");
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
    app.play(false, 1);
    for (let frame = 0; frame < 1000 && !fixtures.trails().some(t => t.id === "sc_iss" && t.count > 0); frame++) fixtures.step(frame * 20);
    const selected = fixtures.trails().filter((trail) => trail.id === "sc_iss");
    assert.ok(selected.some((trail) => trail.count > 0));
    assert.ok(selected.every((trail) => trail.count <= 256));
    app.play(true, 480);
    fixtures.step(0);
    const start = fixtures.core().epoch();
    for (let index = 1; index <= 60; index++) {
      fixtures.step(index * 20);
      assert.equal(fixtures.core().playing(), true);
    }
    assert.ok(Math.abs(fixtures.core().epoch() - start - 576) < 0.001);
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
    fixtures.step(20);
    fixtures.step(40);
    assert.equal(fixtures.core().playing(), true, JSON.stringify(states.at(-1)));
    assert.ok(Math.abs(fixtures.core().epoch() - (846686628 - 1 + 19.2)) < 0.001);
    assert.equal(states.at(-1)!.busy, false);
    release?.();
    await Promise.resolve();
    await Promise.resolve();
    fixtures.step(60);
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
    let prefetches = 0;
    const app = await createWorkspace("#test", () => {}, new AbortController().signal, {
      ...fixtures,
      fetch: async (input) => {
        const url = new URL(String(input), "http://localhost");
        const moon = url.pathname.endsWith("/moon");
        if (armed && moon) {
          if (Number(url.searchParams.get("epoch")) === 846686629) prefetches++;
          else retries++;
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
        fixtures.step(index * 20);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(fixtures.core().playing(), true);
      }
      assert.ok(retries > 0 && retries <= 1, `secondary fetches within 960ms: ${retries}`);
      assert.ok(prefetches <= 1, `adjacent source prefetch is independently bounded: ${prefetches}`);
      assert.ok(Math.abs(fixtures.core().epoch() - (846686627 + 576)) < 0.001);
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
    fixtures.step(20);
    for (let attempt = 0; attempt < 100 && (states.at(-1)!.busy || !blocked); attempt++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(blocked, true, "supplementary source is still pending");
    assert.equal(states.at(-1)!.busy, false);
    assert.equal(fixtures.core().playing(), true);
    assert.equal(fixtures.focused(), "sc_iss");
    const epoch = fixtures.core().epoch();
    fixtures.step(40);
    fixtures.step(60);
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
    fixtures.step(20);
    for (let attempt = 0; attempt < 100 && (states.at(-1)!.busy || !blocked); attempt++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(blocked, true, JSON.stringify(states.at(-1)));
    assert.equal(states.at(-1)!.busy, false);
    assert.equal(fixtures.core().playing(), true);
    assert.equal(fixtures.focused(), "sc_iss");
    assert.equal(states.at(-1)!.observationMode, "follow");
    assert.equal(states.at(-1)!.followId, "moon");
    const epoch = fixtures.core().epoch();
    fixtures.step(40);
    fixtures.step(60);
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
    const existing = new Set(fixtures.visuals().map(entry => entry.id));
    armed = true;
    app.play(true, 480);
    fixtures.step(0);
    fixtures.step(20);
    for (let frame = 2; frame < 20 && fixtures.visuals().length === before; frame++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      fixtures.step(frame * 20);
    }
    const restored = fixtures.visuals().slice(before);
    assert.deepEqual(restored.filter(entry => existing.has(entry.id)).map(entry => entry.id), ["moon"]);
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
    for (let frame = 0; frame < 1500; frame++) {
      const before = fixtures.trails().length;
      fixtures.step(frame * 16);
      const changed = fixtures.trails().slice(before);
      assert.equal(new Set(changed.map(t => t.id)).size, changed.length, "one object must not publish duplicate geometry in a frame");
    }
    const trails = fixtures.trails().filter(t => t.id.startsWith("sc_") && t.kind === "trail");
    assert.ok(trails.length > 40, `exercise a dense real catalog system: ${trails.length} trails ${JSON.stringify(trails.slice(0,3))}`);
    assert.ok(trails.every(t => t.count >= 2 && t.count <= 3*256));
    const latest = new Map(fixtures.trails().map(t => [t.id, t]));
    assert.ok([...latest.values()].reduce((sum,t) => sum + t.count, 0) <= 49152);
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

test("reference hosts register their real models without eagerly selecting every model",async()=>{
 const fixtures=harness();
 const app=await createWorkspace("#test",()=>{},new AbortController().signal,{
  ...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori"))),
 });
 try {
  for(const id of ["243_ida","433_eros","65803_didymos","136108_haumea"])
   assert.ok(fixtures.registeredAssets().has(`eyes:${id}:model`),`${id} model registered`);
  assert.ok(!fixtures.visuals().some(v=>v.id==="433_eros"&&v.spec.kind==="model"),"reference models remain lazy");
  await app.select("dactyl");
  assert.equal(fixtures.visuals().filter(v=>v.id==="243_ida").at(-1)?.spec.assetId,"eyes:243_ida:model");
  assert.ok(fixtures.visuals().filter(v=>v.id==="243_ida").at(-1)?.spec.framingRadiusKm>29.9,"frame the actual model before its asynchronous load");
  await app.seek(35279033);await app.select("sc_near_shoemaker");
  assert.equal(fixtures.visuals().filter(v=>v.id==="433_eros").at(-1)?.spec.assetId,"eyes:433_eros:model");
  assert.equal(fixtures.visuals().filter(v=>v.id==="433_eros").at(-1)?.spec.meshCollision,true);
  assert.equal(fixtures.visuals().filter(v=>v.id==="243_ida").at(-1)?.spec.meshCollision,undefined);
 } finally {await app.dispose();}
});

test("satellite system fit includes its host while the selected satellite remains selected", async () => {
 const fixtures=harness();
 const app=await createWorkspace("#test",()=>{},new AbortController().signal,{
  ...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori"))),
 });
 try {
  app.play(false,1);
  await app.select("moon"); await app.observation("system");
  let observation=JSON.parse(fixtures.core().camera_observation!());
  assert.equal(observation.targetId,"moon");assert.equal(observation.systemId,"earth");
  assert.ok(observation.members.includes("earth"));assert.ok(observation.members.includes("moon"));
  await app.select("dactyl"); await app.observation("system");
  observation=JSON.parse(fixtures.core().camera_observation!());
  assert.equal(observation.targetId,"dactyl");assert.equal(observation.systemId,"243_ida");
  assert.ok(observation.members.includes("243_ida"));assert.ok(observation.members.includes("dactyl"));
 } finally {await app.dispose();}
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

test("Moon selection includes its own orbiters as well as Earth-system siblings", { timeout: 5000 }, async () => {
  const fixtures = harness();
  let loaded!: () => void;
  const complete = new Promise<void>(resolve => { loaded = resolve; });
  const app = await createWorkspace("#test", state => {
    if (state.selected === "moon" && !state.busy) try {
      fixtures.core().state_at("sc_lunar_reconnaissance_orbiter", fixtures.core().epoch());
      fixtures.core().state_at("sc_themis_b", fixtures.core().epoch());
      fixtures.core().state_at("sc_iss", fixtures.core().epoch());
      loaded();
    } catch {}
  }, new AbortController().signal, {
    ...fixtures, fetch: async input => new Response(sample(String(input).includes("type=ori"))),
  });
  try {
    await app.seek(846724000);
    await app.select("moon");
    await complete;
    assert.doesNotThrow(() => fixtures.core().state_at("sc_lunar_reconnaissance_orbiter", fixtures.core().epoch()));
    assert.doesNotThrow(() => fixtures.core().state_at("sc_themis_b", fixtures.core().epoch()));
    assert.doesNotThrow(() => fixtures.core().state_at("sc_iss", fixtures.core().epoch()));
    await app.groups(true, false);
    assert.throws(() => fixtures.core().state_at("sc_lunar_reconnaissance_orbiter", fixtures.core().epoch()));
  } finally { await app.dispose(); }
});

test("solar overview retains heliocentric spacecraft after returning from a local family", {timeout:5000}, async () => {
 const fixtures=harness();
 let notify:(()=>void)|undefined;
 const app=await createWorkspace("#test",state=>{
   if (!state.selected && !state.busy) try {
     fixtures.core().state_at("sc_psyche",fixtures.core().epoch()); notify?.();
   } catch {}
 },new AbortController().signal,{...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori")))});
 try {
   await app.seek(846724000);
   await app.select("moon");
   const ready=new Promise<void>(resolve=>{notify=resolve;});
   app.overview();
   await ready;
   assert.doesNotThrow(()=>fixtures.core().state_at("sc_psyche",fixtures.core().epoch()));
   assert.doesNotThrow(()=>fixtures.core().state_at("sc_voyager_1",fixtures.core().epoch()));
   assert.throws(()=>fixtures.core().state_at("sc_lunar_reconnaissance_orbiter",fixtures.core().epoch()));
   await app.groups(true,false);
   assert.throws(()=>fixtures.core().state_at("sc_psyche",fixtures.core().epoch()));
 } finally {await app.dispose();}
});

test("solar spacecraft populate startup and survive automatic zoom-out without pausing time", {timeout:5000}, async () => {
 const fixtures=harness();
 let moonReady!:()=>void;
 const familyReady=new Promise<void>(resolve=>{moonReady=resolve;});
 let notify!:()=>void;
 let completed=new Promise<void>(resolve=>{notify=resolve;});
 let selection="";
 const app=await createWorkspace("#test",state=>{
   selection=state.selected;
   if(!selection && !state.busy) try {fixtures.core().state_at("sc_voyager_1",fixtures.core().epoch());notify();}catch{}
   if(selection==="moon" && !state.busy) try {fixtures.core().state_at("sc_lunar_reconnaissance_orbiter",fixtures.core().epoch());moonReady();}catch{}
 },new AbortController().signal,{...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori")))});
 try {
   await completed;
   await app.select("moon");
   await familyReady;
   assert.doesNotThrow(()=>fixtures.core().state_at("sc_lunar_reconnaissance_orbiter",fixtures.core().epoch()));
   completed=new Promise<void>(resolve=>{notify=resolve;});
   app.play(true,1);
   fixtures.clearCoreFocus();
   fixtures.step(0);
   await completed;
   assert.equal(selection,"");
   assert.equal(fixtures.core().playing(),true);
   assert.doesNotThrow(()=>fixtures.core().state_at("sc_voyager_1",fixtures.core().epoch()));
   assert.doesNotThrow(()=>fixtures.core().state_at("sc_lunar_reconnaissance_orbiter",fixtures.core().epoch()),"automatic dolly handoff must retain the previous local family");
 } finally {await app.dispose();}
});

test("continuous playback rate changes never discard every animation interval", async () => {
 const fixtures=harness();
 const app=await createWorkspace("#test",()=>{},new AbortController().signal,{...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori")))});
 try {
   app.play(true,1);fixtures.step(0);const start=fixtures.core().epoch();
   const rates=[1,2,3,5,10,20,60];let expected=0;
   for(let i=0;i<rates.length;i++){app.play(true,rates[i]);fixtures.step((i+1)*20);expected+=rates[i]*.020;}
   assert.ok(Math.abs(fixtures.core().epoch()-start-expected)<1e-6,"continuous slider changes must retain frame time");
   app.play(false,60);fixtures.step(10000);const paused=fixtures.core().epoch();
   app.play(true,2);fixtures.step(20000);fixtures.step(20020);
   assert.ok(Math.abs(fixtures.core().epoch()-paused-.040)<1e-6,"resume must exclude paused wall time");
 } finally {await app.dispose();}
});

test("selection initializes sky surveys and host-observation missions with independent framing", async () => {
 const fixtures=harness();
 const app=await createWorkspace("#test",()=>{},new AbortController().signal,{...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori")))});
 try {
  await app.seek(846724000);
  for(const [id,kind,referenceId] of [
    ["sc_lunar_reconnaissance_orbiter","target","moon"],
    ["sc_mars_reconnaissance_orbiter","target","mars"],
    ["sc_chandra","sky","earth"],
    ["sc_hubble_space_telescope","sky","earth"],
    ["sc_sdo","target","sun"],
  ]) {
    await app.select(id);
    assert.deepEqual(JSON.parse(fixtures.core().camera_observation!()).initialLook,{kind,referenceId},id);
  }
  await app.select("sc_psyche");
  assert.equal(JSON.parse(fixtures.core().camera_observation!()).initialLook,undefined,"cruise is not future asteroid observation");
 } finally {await app.dispose();}
});

test("first LRO selection upgrades the observed Moon surface without visiting Moon first", async () => {
 const fixtures=harness();
 const app=await createWorkspace("#test",()=>{},new AbortController().signal,{...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori")))});
 try {
   await app.seek(846724000);
   await app.select("sc_lunar_reconnaissance_orbiter");
   assert.ok(fixtures.visuals().some(({id,spec})=>id==="moon" && Array.isArray(spec.faceAssets) && spec.faceAssets.length===6));
 } finally {await app.dispose();}
});

test("cooperative pending spacecraft work cannot revive after trails are disabled", async () => {
 const fixtures = harness();
 const app = await createWorkspace("#test",()=>{},new AbortController().signal,{...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori")))});
 try {
 await app.select("sc_iss");
 app.trails(false);
 const count=fixtures.trails().length;
 const epoch=fixtures.core().epoch();
 for(let i=0;i<100;i++)fixtures.step(i*16);
 assert.ok(fixtures.trails().slice(count).every(t=>t.id!=="sc_iss" || t.count===0));
 assert.ok(fixtures.core().epoch()>=epoch);
 }finally{await app.dispose();}
});


test("spacecraft sampling errors preserve playback and other jobs", async () => {
 const {SolarSystemData}=await import('../../platform/solar-system.ts');
 const original=SolarSystemData.prototype.trailSampleSteps;
 SolarSystemData.prototype.trailSampleSteps=function*(...args:Parameters<typeof original>){if(args[0]==='sc_iss')throw Error('injected local trail gap');return yield* original.apply(this,args);};
 const fixtures=harness();const snapshots:SolarSnapshot[]=[];
 const app=await createWorkspace('#test',s=>snapshots.push(s),new AbortController().signal,{...fixtures,fetch:async input=>new Response(sample(String(input).includes('type=ori')))});
 try{await app.select('sc_iss');app.play(true,1);fixtures.step(0);const epoch=fixtures.core().epoch();for(let i=1;i<20;i++)fixtures.step(i*20);assert.equal(fixtures.core().playing(),true);assert.ok(fixtures.core().epoch()>epoch);assert.match(snapshots.at(-1)!.error,/local trail gap/);}finally{SolarSystemData.prototype.trailSampleSteps=original;await app.dispose();}
});

test('Huygens closed landing endpoint retains its reviewed Titan reference',async()=>{
 const fixtures=harness();const snapshots:SolarSnapshot[]=[];
 const app=await createWorkspace('#test',s=>snapshots.push(s),new AbortController().signal,{...fixtures,fetch:async input=>new Response(sample(String(input).includes('type=ori')))});
 try {await app.seek(158974766.184);await app.select('sc_huygens');
 assert.equal(snapshots.at(-1)!.parentId,'titan');
 const titan=JSON.parse(fixtures.core().state_at('titan',158974766.184));
 assert.ok(titan.positionKm.every(Number.isFinite));
 }finally{await app.dispose();}
});


test("high-speed forward and reverse playback stop inside NASA default century limits", async () => {
 const fixture=harness();const states:SolarSnapshot[]=[];
 const app=await createWorkspace("#test",s=>states.push(s),new AbortController().signal,{
  ...fixture,fetch:async input=>new Response(sample(String(input).includes("type=ori"))),
 });
 try {
  const min=fixture.core().utc_to_tdb(Date.parse("1949-12-31T00:00:00Z")/1000);
  const max=fixture.core().utc_to_tdb(Date.parse("2049-12-31T00:00:00Z")/1000);
  for(const target of ["", "earth"]) for(const [edge,rate] of [[max,36000],[min,-86400]] as const) {
   app.play(false,1);await app.seek(edge-Math.sign(rate)*1);
   if(target)await app.select(target);else app.overview();
   app.play(true,rate);fixture.step(0);fixture.step(100);
   assert.equal(fixture.core().playing(),false,"crossing the global boundary pauses instead of running beyond NASA's domain");
   assert.ok(Math.abs(fixture.core().epoch()-(edge-Math.sign(rate)*.001))<1e-5);
   assert.equal(states.at(-1)!.selected,target);
  }
  await assert.rejects(app.seek(max+86400),/时间覆盖范围/);
  await assert.rejects(app.seekUtc("1949-12-30T00:00"),/时间覆盖范围/);
 } finally {await app.dispose();}
});


test("startup progress follows actual async boundaries and completes only after renderer startup", async () => {
  const phases:number[]=[];
  const fixtures=harness();
  const app=await createWorkspace("#test",()=>{},new AbortController().signal,{
    ...fixtures,
    onStartup: (_phase, progress) => phases.push(progress?.completedStages ?? -1),
  });
  try { assert.deepEqual(phases,[0,1,2,3,4,5]); } finally { await app.dispose(); }
});


test("failed WASM initialization never reports later startup completion", async () => {
  const phases:number[]=[];
  const fixtures=harness();
  await assert.rejects(createWorkspace("#test",()=>{},new AbortController().signal,{
    ...fixtures,
    onStartup: (_phase, progress) => phases.push(progress.completedStages),
    loadCore: async () => ({ ...(await fixtures.loadCore()), default: async () => { throw Error("WASM download unavailable"); } }),
  }), /WASM download unavailable/);
  assert.deepEqual(phases,[0,1]);
});


test("pending spacecraft jobs rebuild their guards on rate and direction changes without clearing displayed geometry",async()=>{
 const {SolarSystemData}=await import("../../platform/solar-system.ts");
 const fixtures=harness();
 const original=SolarSystemData.prototype.trailSampleSteps;
 const guards:number[]=[];
 SolarSystemData.prototype.trailSampleSteps=function*(...args:Parameters<typeof original>){
  if(args[0]==='sc_iss'){guards.push(args[5]??0);for(let work=0;work<1000000;work++)yield;}
  return yield* original.apply(this,args);
 };
 const app=await createWorkspace("#test",()=>{},new AbortController().signal,{...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori")))});
 try {
  await app.select('sc_iss');app.play(true,20);fixtures.step(0);fixtures.step(34);
  assert.ok(guards.includes(40),'the initial active owner captures the low-rate guard');
  const before=fixtures.trails().length;
  app.play(true,3600);fixtures.step(68);
  assert.ok(guards.includes(7200),'acceleration replaces an already active owner');
  const positiveBuilds=guards.length;
  app.play(true,-3600);fixtures.step(102);
  assert.ok(guards.length>positiveBuilds,'a direction reversal replaces the pending owner even at equal absolute rate');
  assert.equal(fixtures.core().playing(),true);
  assert.equal(fixtures.trails().slice(before).some(trail=>trail.id==='sc_iss'&&trail.count===0),false,'rate changes keep displayed trajectory ownership');
 } finally {SolarSystemData.prototype.trailSampleSteps=original;await app.dispose();}
});


test("late forward-prefetch completion cannot restore cooldowns after a high-rate reversal",async()=>{
 const {SolarSystemData}=await import("../../platform/solar-system.ts");
 const fixtures=harness(),original=SolarSystemData.prototype.prefetchPosition;
 const calls:{id:string;requested:number;signal:AbortSignal|undefined;finish:(value:boolean)=>void}[]=[];
 SolarSystemData.prototype.prefetchPosition=function(id,requested,_epoch,_retain,signal){return new Promise<boolean>(finish=>calls.push({id,requested,signal,finish}));};
 const app=await createWorkspace("#test",()=>{},new AbortController().signal,{...fixtures,fetch:async input=>{
  const text=String(input),isOrientation=text.includes("type=ori");
  if(!isOrientation&&text.includes("/sc_iss?")) {
   const epoch=Number(new URL(text,"http://fixture").searchParams.get("epoch"));
   const bytes=sample(false,epoch+1000);new DataView(bytes.buffer).setFloat64(28,epoch-100000,true);return new Response(bytes);
  }
  return new Response(sample(isOrientation));
 }});
 try {
  await app.select("sc_iss");app.play(true,3600);fixtures.step(0);fixtures.step(34);
  assert.equal(calls.length,1);const old=calls[0];assert.equal(old.signal?.aborted,false);
  app.play(true,-86400);assert.equal(old.signal?.aborted,true,"only the optional prefetch ownership is aborted immediately");
  fixtures.step(68);assert.equal(calls.length,1,"old in-flight ownership remains until its own finally callback");
  old.finish(false);for(let turn=0;turn<4;turn++)await Promise.resolve();
  fixtures.step(102);assert.equal(calls.length,2,"late failure cannot reapply an obsolete one/five-second cooldown");
  assert.ok(calls[1].requested<old.requested);assert.equal(calls[1].signal?.aborted,false);assert.equal(fixtures.core().playing(),true);
 } finally {for(const call of calls)call.finish(false);SolarSystemData.prototype.prefetchPosition=original;await app.dispose();}
});


test("a previously displayed secondary trail recovers a transient chunk failure without retrying never-available sources",async()=>{
 const {SolarSystemData}=await import("../../platform/solar-system.ts");
 const fixtures=harness(),originalPrefetch=SolarSystemData.prototype.prefetchPosition;
 SolarSystemData.prototype.prefetchPosition=async()=>false;
 let cutoff:number|undefined,armed=false,recoveryRequests=0,neverAvailableRequests=0,done!:()=>void;
 const ready=new Promise<void>(resolve=>{done=resolve;});
 const app=await createWorkspace("#test",snapshot=>{if(snapshot.selected==="earth"&&snapshot.dataCache.positionEntries>40)done();},new AbortController().signal,{...fixtures,fetch:async input=>{
  const url=new URL(String(input),"http://fixture"),orientation=url.searchParams.get("type")==="ori";
  if(!orientation&&url.pathname.endsWith("/sc_prefire_2")){neverAvailableRequests++;return new Response("unavailable",{status:502});}
  if(!orientation&&url.pathname.endsWith("/sc_noaa_21")) {
   cutoff??=Number(url.searchParams.get("epoch"))+100;
   if(armed){recoveryRequests++;if(recoveryRequests===1)return new Response("transient chunk error",{status:502});return new Response(sample(false));}
   return new Response(sample(false,cutoff));
  }
  return new Response(sample(orientation));
 }});
 try {
  await app.select("earth");await ready;
  for(let frame=0;frame<200;frame++)fixtures.step(frame*16);
  const before=fixtures.trails().filter(trail=>trail.id==="sc_noaa_21"&&trail.count>0).length;
  assert.ok(before>0,"recovery is restricted to a genuinely displayed trail");
  armed=true;app.play(true,3600);fixtures.step(4000);
  for(let turn=0;turn<20;turn++)await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(recoveryRequests,1);
  fixtures.step(4100);assert.equal(recoveryRequests,1,"existing one-second retry backoff remains bounded");
  fixtures.step(5100);for(let turn=0;turn<20;turn++)await new Promise<void>(resolve=>setImmediate(resolve));
  for(let frame=1;frame<=40;frame++)fixtures.step(5100+frame*34);
  assert.ok(recoveryRequests>=2,"failed status without coverage metadata does not permanently suppress recovery");
  assert.ok(fixtures.trails().filter(trail=>trail.id==="sc_noaa_21"&&trail.count>0).length>before);
  assert.equal(neverAvailableRequests,1,"never-available sources do not acquire new retries");
  assert.equal(fixtures.core().playing(),true);
 } finally {SolarSystemData.prototype.prefetchPosition=originalPrefetch;await app.dispose();}
});


test("secondary chunk requests capture the live epoch only when one of four admission slots opens",async()=>{
 const {SolarSystemData}=await import("../../platform/solar-system.ts");
 const fixtures=harness(),originalPrefetch=SolarSystemData.prototype.prefetchPosition,originalLoad=SolarSystemData.prototype.load;
 SolarSystemData.prototype.prefetchPosition=async()=>false;
 const ids=new Set(["sc_acs3","sc_aqua","sc_aura","sc_cygnss_1","sc_cygnss_2","sc_cygnss_3"]);
 let armed=false,cutoff:number|undefined,complete!:()=>void;const ready=new Promise<void>(resolve=>{complete=resolve;});
 const calls:{id:string;epoch:number;finish:()=>void}[]=[];
 const loads:Promise<void>[]=[];
 SolarSystemData.prototype.load=function(...args){const result=originalLoad.apply(this,args);if(armed&&args[0]?.some(id=>ids.has(id)))loads.push(result);return result;};
 const app=await createWorkspace("#test",snapshot=>{if(snapshot.selected==="earth"&&snapshot.dataCache.positionEntries>40)complete();},new AbortController().signal,{...fixtures,fetch:async input=>{
  const url=new URL(String(input),"http://fixture"),id=url.pathname.split("/").at(-1)!,orientation=url.searchParams.get("type")==="ori",requested=Number(url.searchParams.get("epoch"));
  if(!orientation&&ids.has(id)) {
   cutoff??=requested+100;
   if(armed&&requested>=cutoff) {await new Promise<void>(finish=>calls.push({id,epoch:requested,finish}));return new Response(sample(false));}
   return new Response(sample(false,cutoff));
  }
  return new Response(sample(orientation));
 }});
 const settle=async()=>{for(let turn=0;turn<20;turn++)await new Promise<void>(resolve=>setImmediate(resolve));};
 try {
  await app.select("earth");await ready;armed=true;app.play(true,3600);fixtures.step(0);fixtures.step(4000);await settle();
  assert.equal(calls.length,4,"only four actual source owners enter the network path");
  fixtures.step(4034);fixtures.step(4068);assert.equal(calls.length,4);
  calls[0].finish();await loads[0];await settle();
  assert.equal(calls.length,4,"unstarted sources have no stale URLs queued behind the network semaphore");
  fixtures.step(4102);const admittedEpoch=fixtures.core().epoch();await settle();
  assert.equal(calls.length,5);assert.ok(Math.abs(calls[4].epoch-admittedEpoch)<1e-6,"the fifth request uses its admission epoch after time advanced");
  for(const call of calls)call.finish();await Promise.all(loads);await settle();
  fixtures.step(4136);await settle();assert.equal(calls.length,6,"admission bounds concurrency without capping the object count");
  calls[5].finish();await Promise.all(loads);await settle();fixtures.step(4170);
  for(const id of ids)assert.doesNotThrow(()=>fixtures.core().state_at(id,fixtures.core().epoch()));
  assert.equal(fixtures.core().playing(),true);
 } finally {for(const call of calls)call.finish();SolarSystemData.prototype.prefetchPosition=originalPrefetch;SolarSystemData.prototype.load=originalLoad;await app.dispose();}
});


test("a known trail's desired intent survives an unready-to-ready source transition without visual restoration",async()=>{
 const {SolarSystemData}=await import("../../platform/solar-system.ts");
 const fixtures=harness(),originalStatus=SolarSystemData.prototype.status;
 type Status=ReturnType<typeof originalStatus>[number];
 let unready=false,complete!:()=>void;const ready=new Promise<void>(resolve=>{complete=resolve;});
 SolarSystemData.prototype.status=(function(this:InstanceType<typeof SolarSystemData>,id?:string){
  const value=Reflect.apply(originalStatus,this,id===undefined?[]:[id]) as Status|Status[]|undefined;
  const changed=(item:Status)=>unready&&item.id==="sc_noaa_21"?{...item,status:"loading" as const}:item;
  return Array.isArray(value)?value.map(changed):value?changed(value):undefined;
 }) as typeof originalStatus;
 const app=await createWorkspace("#test",snapshot=>{if(snapshot.selected==="earth"&&snapshot.dataCache.positionEntries>40)complete();},new AbortController().signal,{...fixtures,fetch:async input=>new Response(sample(String(input).includes("type=ori")))});
 try {
  await app.select("earth");await ready;for(let frame=0;frame<200;frame++)fixtures.step(frame*16);
  const published=fixtures.trails().filter(trail=>trail.id==="sc_noaa_21"&&trail.count>0).length;
  assert.ok(published>0);
  const visualSets=fixtures.visuals().filter(value=>value.id==="sc_noaa_21").length;
  unready=true;for(let frame=0;frame<5;frame++)fixtures.step(3200+frame*34);
  unready=false;for(let frame=0;frame<40;frame++)fixtures.step(3400+frame*34);
  assert.ok(fixtures.trails().filter(trail=>trail.id==="sc_noaa_21"&&trail.count>0).length>published,"ready science republishes through retained intent without configureBody recovery");
  assert.equal(fixtures.visuals().filter(value=>value.id==="sc_noaa_21").length,visualSets,"the source recovery does not depend on recreating a visual");
  assert.equal(fixtures.core().playing(),true);
 } finally {SolarSystemData.prototype.status=originalStatus;await app.dispose();}
});


test("continuous secondary visual restorations cannot starve an active scientific geometry owner",async()=>{
 const {SolarSystemData}=await import("../../platform/solar-system.ts");
 const fixtures=harness(),original=SolarSystemData.prototype.trailSampleSteps,originalPrefetch=SolarSystemData.prototype.prefetchPosition;
 const restoring=new Set(["sc_noaa_21","sc_cygnss_1","sc_cygnss_2","sc_cygnss_3"]);
 let steps=0,armed=false,cutoff:number|undefined,complete!:()=>void;const ready=new Promise<void>(resolve=>{complete=resolve;});
 SolarSystemData.prototype.prefetchPosition=async()=>false;
 SolarSystemData.prototype.trailSampleSteps=function*(...args:Parameters<typeof original>){
  if(args[0]==="sc_iss")for(let step=0;step<1000000;step++){steps++;yield;}
  return yield* original.apply(this,args);
 };
 const app=await createWorkspace("#test",snapshot=>{if(snapshot.selected==="sc_iss"&&snapshot.dataCache.positionEntries>40)complete();},new AbortController().signal,{...fixtures,fetch:async input=>{
  const url=new URL(String(input),"http://fixture"),id=url.pathname.split("/").at(-1)!,orientation=url.searchParams.get("type")==="ori";
  if(!orientation&&restoring.has(id)){cutoff??=Number(url.searchParams.get("epoch"))+100;return new Response(sample(false,armed?4e9:cutoff));}
  return new Response(sample(orientation));
 }});
 try {
  await app.select("sc_iss");await ready;fixtures.step(0);fixtures.step(34);assert.ok(steps>0);
  armed=true;app.play(true,3600);fixtures.step(4000);
  for(let turn=0;turn<20;turn++)await new Promise<void>(resolve=>setImmediate(resolve));
  let restoreFrames=0;
  for(let frame=1;frame<=6;frame++) {
   const beforeSteps=steps,beforeVisuals=fixtures.visuals().length;fixtures.step(4000+frame*34);
   if(fixtures.visuals().slice(beforeVisuals).some(visual=>restoring.has(visual.id))){restoreFrames++;assert.ok(steps>beforeSteps,"remaining frame budget still advances scientific work after restoration");}
  }
  assert.ok(restoreFrames>=4,"exercise consecutive successful source-restoration frames");
  assert.equal(fixtures.core().playing(),true);
 } finally {SolarSystemData.prototype.trailSampleSteps=original;SolarSystemData.prototype.prefetchPosition=originalPrefetch;await app.dispose();}
});


test("previously valid JWST recovers a rejected unknown malformed chunk while initially invalid sources stay bounded",async()=>{
 const {SolarSystemData}=await import("../../platform/solar-system.ts");
 const fixtures=harness(),originalPrefetch=SolarSystemData.prototype.prefetchPosition,originalLoad=SolarSystemData.prototype.load;
 const {readFile}=await import('node:fs/promises');
 const malformed=new Uint8Array(await readFile(new URL('../lib/fixtures/sc_jwst__earth__orb__81_05-payload.dyn',import.meta.url)));malformed[malformed.length-1]^=1;
 let failureState:{status:string;error?:string}|undefined;
 const ownedLoads:Promise<void>[]=[];
 SolarSystemData.prototype.load=function(...args){
  const task=originalLoad.apply(this,args);
  void task.then(()=>{const status=this.status('sc_jwst');if(status?.status==='failed')failureState=status;},()=>{});
  if(armed&&args[0]?.includes('sc_jwst'))ownedLoads.push(task);
  return task;
 };
 SolarSystemData.prototype.prefetchPosition=async()=>false;
 let cutoff:number|undefined,armed=false,recoveryRequests=0,neverAvailableRequests=0,done!:()=>void;
 const ready=new Promise<void>(resolve=>{done=resolve;});
 const app=await createWorkspace("#test",snapshot=>{if(snapshot.selected==="earth"&&snapshot.dataCache.positionEntries>40)done();},new AbortController().signal,{...fixtures,fetch:async input=>{
  const url=new URL(String(input),"http://fixture"),orientation=url.searchParams.get("type")==="ori";
  if(!orientation&&url.pathname.endsWith("/sc_prefire_2")){neverAvailableRequests++;return new Response(malformed);}
  if(!orientation&&url.pathname.endsWith("/sc_jwst")) {
   cutoff??=Number(url.searchParams.get("epoch"))+100;
   if(armed){recoveryRequests++;if(recoveryRequests===1)return new Response(malformed);return new Response(sample(false));}
   return new Response(sample(false,cutoff));
  }
  return new Response(sample(orientation));
 }});
 try {
  await app.select("earth");await ready;
  for(let frame=0;frame<200;frame++)fixtures.step(frame*16);
  const before=fixtures.trails().filter(trail=>trail.id==="sc_jwst"&&trail.count>0).length;
  assert.ok(before>0,"recovery is restricted to a genuinely displayed trail");
  armed=true;app.play(true,3600);fixtures.step(4000);
  assert.equal(ownedLoads.length,1);await ownedLoads[0];
  // The source has finished (including digest/decode); drain its host cleanup chain.
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(recoveryRequests,1);
  assert.equal(failureState?.status,'failed');assert.match(failureState?.error??'',/sample times must increase/);
  fixtures.step(4100);assert.equal(recoveryRequests,1,"existing one-second retry backoff remains bounded");
  fixtures.step(5100);assert.equal(ownedLoads.length,2);await ownedLoads[1];
  await new Promise<void>(resolve=>setImmediate(resolve));
  for(let frame=1;frame<=40;frame++)fixtures.step(5100+frame*34);
  assert.ok(recoveryRequests>=2,"failed status without coverage metadata does not permanently suppress recovery");
  assert.ok(fixtures.trails().filter(trail=>trail.id==="sc_jwst"&&trail.count>0).length>before);
  assert.ok(JSON.parse(fixtures.core().state_at('sc_jwst',fixtures.core().epoch())).positionKm,'recovered geometry has valid real WASM object ownership');
  assert.equal(neverAvailableRequests,1,"never-available sources do not acquire new retries");
  assert.equal(fixtures.core().playing(),true);
 } finally {SolarSystemData.prototype.prefetchPosition=originalPrefetch;SolarSystemData.prototype.load=originalLoad;await app.dispose();}
});
