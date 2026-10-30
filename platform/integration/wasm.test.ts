import { buildStellarTuning, stellarDefaults } from "../stellar-tuning.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PluginHost, type PluginContext } from "../plugin-host.ts";
import { WasmCorePort } from "../wasm-core-port.ts";

// Intentionally requires a freshly built real Rust WASM artifact, with no stub fallback.
const { WasmCore } = createRequire(import.meta.url)(
  "../../core/pkg/spaceeyes_core.js",
);

test("real WASM validates environment ownership and clears it with the session", async () => {
  const core = new WasmCore();
  const host = new PluginHost(new WasmCorePort(core));
  let sdk!: PluginContext;
  try {
    core.register_asset("sky", "deep-space/milkyway.webp", "texture");
    host.register(
      {
        id: "integration.galaxy",
        apiVersion: 1,
        capabilities: ["scene.visual"],
      },
      (ctx) => {
        sdk = ctx;
      },
    );
    await host.enable("integration.galaxy", ["scene.visual"]);
    sdk.visual.environment({ assetId: "sky", frame: "ICRF", intensity: 1 });
    assert.equal(JSON.parse(core.environment_status()).phase, "pending");
    assert.throws(() =>
      core.set_environment(
        "spoof",
        "unknown",
        JSON.stringify({ assetId: "sky", frame: "ICRF", intensity: 1 }),
      ),
    );
    await host.shutdown();
    assert.equal(JSON.parse(core.environment_status()).phase, "disabled");
  } finally {
    await host.shutdown();
    core.free();
  }
});

test("starfield SDK publishes independent layers to real WASM and revokes all on disposal", async () => {
  const core = new WasmCore();
  const host = new PluginHost(new WasmCorePort(core));
  let sdk!: PluginContext;
  try {
    host.register(
      {
        id: "integration.stars",
        apiVersion: 1,
        capabilities: ["scene.visual"],
      },
      (ctx) => {
        sdk = ctx;
      },
    );
    await host.enable("integration.stars", ["scene.visual"]);
    const spec = {
      frame: "ICRF" as const,
      source: "synthetic sky",
      positionsKm: [1e15, 0, 0],
      colorsRgb: [1, 0.5, 0.25],
      magnitudes: [2],
      absoluteMagnitudes: [1],
    };
    sdk.visual.starfield("stars:0", spec);
    sdk.visual.starfield("stars:1", spec);
    assert.equal(core.starfield_count(), 2);
    sdk.visual.starfield("stars:0", null);
    assert.equal(core.starfield_count(), 1);
    assert.throws(() =>
      core.set_starfield(
        "spoof",
        "integration.stars:1",
        "stars",
        JSON.stringify(spec),
      ),
    );
    await host.shutdown();
    assert.equal(core.starfield_count(), 0);
    assert.throws(() => sdk.visual.starfield("stars:1", spec), /inactive/);
  } finally {
    await host.shutdown();
    core.free();
  }
});

test("host pick query validates normalized input and empty headless frames never select", () => {
  const core = new WasmCore();
  try {
    assert.equal(core.pick_object(0.5, 0.5), undefined);
    assert.throws(() => core.pick_object(NaN, 0.5), /InvalidViewportPoint/);
    assert.throws(() => core.pick_object(1.01, 0.5), /InvalidViewportPoint/);
  } finally {
    core.free();
  }
});

test("TS plugin drives real Rust WASM state, clock, focus and session cleanup", async () => {
  const core = new WasmCore();
  const host = new PluginHost(new WasmCorePort(core));
  let sdk!: PluginContext;
  try {
    host.register(
      {
        id: "integration.source",
        apiVersion: 1,
        capabilities: ["camera.control", "data.publish", "time.control"],
      },
      (context) => {
        sdk = context;
      },
    );
    await host.enable("integration.source", [
      "camera.control",
      "data.publish",
      "time.control",
    ]);
    sdk.data.publish("body:test", {
      positionKm: [1e12, 2, 3],
      radiusKm: 1,
      epochTdbSeconds: 0,
      coverageTdbSeconds: [0, 10],
      frame: "ICRF",
      source: "synthetic integration fixture",
    });
    assert.equal(JSON.parse(core.state_at("body:test", 0)).positionKm[0], 1e12);
    sdk.camera.focus("body:test");
    assert.equal(core.focused_object(), "body:test");
    sdk.time.setPlayback(true, 2);
    core.tick(1);
    assert.equal(core.epoch(), 2);
    assert.throws(() => core.state_at("body:test", 2), /StaleState/);
    await host.shutdown();
    assert.equal(core.focused_object(), undefined);
    assert.equal(core.playing(), false);
    assert.throws(() => core.state_at("body:test", 0), /UnknownObject/);
    assert.throws(() => sdk.camera.focus("body:test"), /inactive/);
  } finally {
    core.free();
  }
});

test("actual WASM boundary independently rejects spoofed identity and invalid JSON", () => {
  const core = new WasmCore();
  try {
    core.open_session("session-a", "one.plugin", true, true, false);
    assert.throws(
      () =>
        core.publish_object(
          "session-a",
          "one.plugin",
          "body:test",
          "{bad json",
        ),
      /InvalidState/,
    );
    const sample = JSON.stringify({
      positionKm: [1, 2, 3],
      radiusKm: 1,
      epochTdbSeconds: 0,
      coverageTdbSeconds: [0, 1],
      frame: "ICRF",
      source: "test",
    });
    assert.throws(
      () =>
        core.publish_object("session-a", "spoofed.plugin", "body:test", sample),
      /WrongOwner/,
    );
    core.release_session("session-a");
    assert.throws(
      () => core.focus("session-a", "one.plugin", "body:test"),
      /InactiveSession/,
    );
  } finally {
    core.free();
  }
});

test("real WASM visual API enforces registered resources, ownership and revisions", async () => {
  const core = new WasmCore();
  const host = new PluginHost(new WasmCorePort(core));
  let sdk!: PluginContext;
  try {
    core.register_asset("model:juno", "models/juno/Juno.gltf", "model");
    host.register(
      {
        id: "integration.visual",
        apiVersion: 1,
        capabilities: ["data.publish", "scene.visual"],
      },
      (context) => {
        sdk = context;
      },
    );
    await host.enable("integration.visual", ["data.publish", "scene.visual"]);
    sdk.data.publish("object:test", {
      positionKm: [0, 0, 0],
      radiusKm: 0.02,
      epochTdbSeconds: 0,
      coverageTdbSeconds: [0, 1],
      frame: "ICRF",
      source: "test",
    });
    sdk.visual.set("object:test", {
      kind: "model",
      assetId: "model:juno",
      scene: 0,
      scaleKmPerUnit: 0.001,
    });
    const first = sdk.visual.status("object:test");
    assert.equal(first?.phase, "pending");
    assert.equal(typeof first?.revision, "string");
    assert.throws(
      () =>
        sdk.visual.set("object:test", {
          kind: "model",
          assetId: "model:unknown",
          scene: 0,
          scaleKmPerUnit: 1,
        }),
      /UnknownAsset/,
    );
    assert.equal(sdk.visual.status("object:test")?.revision, first?.revision);
    core.open_session("another", "another.plugin", false, false, false, true);
    assert.throws(
      () => core.set_visual("another", "another.plugin", "object:test", "null"),
      /WrongOwner/,
    );
    assert.throws(
      () =>
        core.owned_visual_status("another", "another.plugin", "object:test"),
      /WrongOwner/,
    );
    sdk.visual.clear("object:test");
    assert.equal(sdk.visual.status("object:test"), null);
    await host.shutdown();
    assert.throws(() => core.visual_status("object:test"), /UnknownObject/);
  } finally {
    core.free();
  }
});

test("clock epochs survive 1000 JSON publications without stale state", () => {
  const core = new WasmCore();
  try {
    core.open_session("roundtrip", "roundtrip.plugin", true, true, true, false);
    core.set_playback("roundtrip", "roundtrip.plugin", true, 1);
    for (let i = 0; i < 1000; i++) {
      core.tick(1 / 60);
      const epoch = core.epoch();
      core.publish_object(
        "roundtrip",
        "roundtrip.plugin",
        "body:roundtrip",
        JSON.stringify({
          positionKm: [0, 0, 0],
          radiusKm: 1,
          epochTdbSeconds: epoch,
          coverageTdbSeconds: [0, 10000],
          frame: "ICRF",
          source: "roundtrip fixture",
        }),
      );
      assert.equal(
        JSON.parse(core.state_at("body:roundtrip", epoch)).epochTdbSeconds,
        epoch,
      );
    }
  } finally {
    core.free();
  }
});

test("real WASM stellar tuning is owned, bounded, revocable and does not reload visual revision", async () => {
  const core = new WasmCore();
  const host = new PluginHost(new WasmCorePort(core));
  let sdk!: PluginContext;
  try {
    host.register(
      {
        id: "integration.solar-tuning",
        apiVersion: 1,
        capabilities: ["data.publish", "scene.visual"],
      },
      (ctx) => {
        sdk = ctx;
      },
    );
    await host.enable("integration.solar-tuning", [
      "data.publish",
      "scene.visual",
    ]);
    sdk.data.publish("sun", {
      positionKm: [0, 0, 0],
      radiusKm: 695500,
      epochTdbSeconds: 0,
      coverageTdbSeconds: [0, 1],
      frame: "ICRF",
      source: "fixture",
    });
    sdk.visual.set("sun", {
      kind: "sphere",
      stellar: { coronaIntensity: 1, flowSpeed: 0.15 },
    });
    const revision = sdk.visual.status("sun")!.revision;
    const tuning = buildStellarTuning({
      ...stellarDefaults(),
      windGain: 0,
      temperatureMK: 2,
    });
    sdk.visual.stellar("sun", tuning);
    assert.equal(sdk.visual.status("sun")!.revision, revision);
    assert.throws(() =>
      core.tune_stellar(
        "unknown",
        "spoof.plugin",
        "sun",
        JSON.stringify(tuning),
      ),
    );
    // Independently bypass TS validation to prove the Rust boundary rejects bad payloads.
    core.open_session("rust-solar", "rust.solar", false, true, false, true);
    core.publish_object(
      "rust-solar",
      "rust.solar",
      "fixture",
      JSON.stringify({
        positionKm: [0, 0, 0],
        radiusKm: 1,
        epochTdbSeconds: 0,
        coverageTdbSeconds: [0, 1],
        frame: "ICRF",
        source: "fixture",
      }),
    );
    core.set_visual(
      "rust-solar",
      "rust.solar",
      "fixture",
      JSON.stringify({
        kind: "sphere",
        stellar: { coronaIntensity: 1, flowSpeed: 0.15 },
      }),
    );
    core.tune_stellar(
      "rust-solar",
      "rust.solar",
      "fixture",
      JSON.stringify(tuning),
    );
    const legacySettings = Object.fromEntries(
      Object.entries(tuning.settings).filter(
        ([key]) =>
          ![
            "surfaceContrast",
            "surfaceDetail",
            "surfaceSpeed",
            "activeRegionGain",
            "activeRegionSize",
            "limbGlowGain",
            "prominenceHeightKm",
            "prominenceWidthKm",
            "prominenceLengthKm",
            "prominenceFlowKmS",
            "prominenceTau",
            "prominenceSource",
            "prominenceTimeScale",
            "coronaExtent",
            "observationStyle",
            "coronaGain",
          ].includes(key),
      ),
    );
    assert.equal(Object.keys(legacySettings).length, 58);
    core.tune_stellar(
      "rust-solar",
      "rust.solar",
      "fixture",
      JSON.stringify({ ...tuning, settings: legacySettings }),
    );
    assert.throws(
      () =>
        core.tune_stellar(
          "rust-solar",
          "rust.solar",
          "fixture",
          JSON.stringify({
            ...tuning,
            settings: { ...legacySettings, injected: 1 },
          }),
        ),
      /InvalidVisual/,
    );
    assert.throws(
      () =>
        core.tune_stellar(
          "rust-solar",
          "rust.solar",
          "fixture",
          JSON.stringify({
            ...tuning,
            settings: { ...tuning.settings, prominenceWidthKm: 451 },
          }),
        ),
      /InvalidVisual/,
    );

    assert.throws(
      () =>
        core.tune_stellar(
          "rust-solar",
          "rust.solar",
          "sun",
          JSON.stringify(tuning),
        ),
      /WrongOwner/,
    );
    assert.throws(
      () =>
        core.tune_stellar(
          "rust-solar",
          "rust.solar",
          "fixture",
          JSON.stringify({
            ...tuning,
            settings: { ...tuning.settings, sampleCount: 25 },
          }),
        ),
      /InvalidVisual/,
    );
    assert.throws(
      () =>
        core.tune_stellar(
          "rust-solar",
          "rust.solar",
          "fixture",
          JSON.stringify({
            ...tuning,
            settings: {
              ...tuning.settings,
              enterDistance: 12,
              exitDistance: 10,
            },
          }),
        ),
      /InvalidVisual/,
    );
    core.release_session("rust-solar");
    assert.throws(
      () =>
        core.tune_stellar(
          "rust-solar",
          "rust.solar",
          "fixture",
          JSON.stringify(tuning),
        ),
      /InactiveSession/,
    );
    await host.shutdown();
    assert.throws(() => sdk.visual.stellar("sun", tuning), /inactive/);
  } finally {
    await host.shutdown();
    core.free();
  }
});

test("trail SDK reaches real WASM with strict metadata and ordinary orbit compatibility", async () => {
  const core = new WasmCore();
  const host = new PluginHost(new WasmCorePort(core));
  let sdk!: PluginContext;
  host.register(
    {
      id: "integration.trail",
      apiVersion: 1,
      capabilities: ["data.publish", "scene.visual"],
    },
    (ctx) => {
      sdk = ctx;
    },
  );
  try {
    await host.enable("integration.trail", ["data.publish", "scene.visual"]);
    for (const id of ["earth", "moon"])
      sdk.data.publish(id, {
        positionKm: [1, 0, 0],
        radiusKm: 1,
        epochTdbSeconds: 0,
        coverageTdbSeconds: [0, 10],
        frame: "ICRF",
        source: "synthetic trail integration",
      });
    sdk.visual.trajectory(
      "moon",
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      [0, 1, 2],
      {
        kind: "trail",
        trailDurationSeconds: 60,
        breakIndices: [2],
        originId: "earth",
      },
    );
    sdk.visual.trajectory(
      "earth",
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      [0, 1],
      { colorRgba: [1, 1, 1, 1] },
    );
    sdk.visual.trajectory("moon", [], []);
    await host.shutdown();
  } finally {
    core.free();
  }
});
