// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import {
  CoreClient,
  CoreRemoteError,
  UnsupportedCapabilityError,
  wasmTransport,
  create,
  fromBinary,
  toBinary,
  ResponseEnvelopeSchema,
  ResponseStatus,
  ErrorCode,
  CoreEventKind,
  EngineLifecycle,
  ObjectLifecycle,
  TextureColorSpace,
  ResourceUploadFormat,
  SamplingFilter,
  SamplingAddress,
  TimeScale,
  type ByteTransport,
  type WasmByteEngine,
  type CommandPayload,
  type ResponseEnvelope,
} from "../src/index.js";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const initialSeconds = -9007199254740993n;
const session = "interop-session";
const wasm = createRequire(import.meta.url)(
  join(root, "target/sdk-wasm-node/spaceeyes_wasm.js"),
) as {
  WasmEngine: new (
    session: string,
    scale: string,
    epoch: string,
    seconds: bigint,
    nanos: number,
  ) => WasmByteEngine & { free(): void };
};
class NativeTransport implements ByteTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private pending: {
    resolve: (bytes: Uint8Array) => void;
    reject: (error: Error) => void;
  }[] = [];
  private readonly exited: Promise<void>;
  constructor() {
    this.child = spawn(join(root, "target/debug/examples/wire_host"), [], {
      stdio: "pipe",
    });
    let stderr = "";
    this.child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 4) {
        const size = this.buffer.readUInt32LE();
        if (size > 1048576) {
          this.fail(new Error("oversized host response"));
          this.child.kill();
          return;
        }
        if (this.buffer.length < size + 4) return;
        const waiter = this.pending.shift();
        if (!waiter) {
          this.fail(new Error("unsolicited host response"));
          this.child.kill();
          return;
        }
        const bytes = Uint8Array.from(this.buffer.subarray(4, size + 4));
        this.buffer = this.buffer.subarray(size + 4);
        waiter.resolve(bytes);
      }
    });
    this.child.on("error", (error) => this.fail(error));
    this.exited = new Promise((resolve) =>
      this.child.on("close", (code) => {
        this.fail(new Error(`Host closed (${code}): ${stderr}`));
        resolve();
      }),
    );
  }
  private fail(error: Error): void {
    for (const pending of this.pending.splice(0)) pending.reject(error);
  }
  private exchange(route: number, bytes: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      const header = Buffer.alloc(5);
      header[0] = route;
      header.writeUInt32LE(bytes.length, 1);
      this.child.stdin.write(Buffer.concat([header, bytes]), (error) => {
        if (error) this.fail(error);
      });
    });
  }
  submit(bytes: Uint8Array): Promise<Uint8Array> {
    return this.exchange(0, bytes);
  }
  query(bytes: Uint8Array): Promise<Uint8Array> {
    return this.exchange(1, bytes);
  }
  async close(): Promise<void> {
    this.child.stdin.end();
    await this.exited;
  }
}
type Host = { transport: ByteTransport; close: () => void | Promise<void> };
function host(backend: "native" | "wasm"): Host {
  if (backend === "native") {
    const transport = new NativeTransport();
    return { transport, close: () => transport.close() };
  }
  const engine = new wasm.WasmEngine(
    session,
    "TT",
    "prototype",
    initialSeconds,
    0,
  );
  return {
    transport: wasmTransport(engine, "authenticated-host"),
    close: () => engine.free(),
  };
}
function state(response: ResponseEnvelope) {
  assert.equal(response.payload.case, "session");
  if (response.payload.case !== "session") throw new Error("expected session");
  return response.payload.value;
}
test("Native and WASM expose the same read-only pick rejection contract", async () => {
  for (const backend of ["native", "wasm"] as const) {
    const h = host(backend);
    try {
      const client = new CoreClient(h.transport, session);
      await client.connect(["query.pick_presented"]);
      const before = state(
        await client.query(
          { case: "sessionStatus", value: {} },
          { requestId: "before-pick" },
        ),
      );
      for (const [x, code] of [
        [0, ErrorCode.SNAPSHOT_EXPIRED],
        [2, ErrorCode.INVALID_ARGUMENT],
        [NaN, ErrorCode.INVALID_ARGUMENT],
      ] as const) {
        await assert.rejects(
          client.query(
            {
              case: "pickPresented",
              value: { frameSequence: before.frameSequence, x, y: 0 },
            },
            { requestId: "pick" },
          ),
          (error: unknown) =>
            error instanceof CoreRemoteError && error.code === code,
        );
      }
      assert.deepEqual(
        state(
          await client.query(
            { case: "sessionStatus", value: {} },
            { requestId: "after-pick" },
          ),
        ),
        before,
      );
    } finally {
      await h.close();
    }
  }
});
async function exercise(backend: "native" | "wasm"): Promise<Uint8Array[]> {
  const h = host(backend);
  const client = new CoreClient(h.transport, session);
  const transcript: Uint8Array[] = [];
  const record = (r: ResponseEnvelope) => {
    transcript.push(toBinary(ResponseEnvelopeSchema, r));
    return r;
  };
  let revision = 0n;
  const command = async (payload: CommandPayload, id: string) => {
    const response = record(
      await client.command(payload, {
        requestId: id,
        expectedSceneRevision: revision,
      }),
    );
    revision = response.committedSceneRevision;
    return response;
  };
  const status = async () =>
    state(
      record(
        await client.query(
          { case: "sessionStatus", value: {} },
          { requestId: "read" },
        ),
      ),
    );
  try {
    const caps = await client.connect([
      "scene.transaction",
      "resources.register_texture",
      "query.resolve_frame",
    ]);
    assert.equal(caps.operations.length, 43);
    assert.equal(caps.limits?.commandHistoryCapacity, 4096n);
    assert.equal(caps.limits?.maxTextureDimension, 2048);
    assert(!client.supports("time.live"));
    assert(!client.supports("rendering.canvas"));
    const initial = await status();
    assert.equal(initial.clock?.instant?.seconds, initialSeconds);
    const instant = {
      timeScale: TimeScale.TT,
      epochId: "prototype",
      seconds: initialSeconds,
      nanos: 0,
    };
    await command(
      {
        case: "spatial",
        value: {
          expectedRevision: 0n,
          action: {
            case: "registerRoot",
            value: { frameId: { value: "root" } },
          },
        },
      },
      "root",
    );
    const events = record(
      await client.query(
        { case: "events", value: { afterSequence: 0n, maxEvents: 16 } },
        { requestId: "events" },
      ),
    );
    assert.equal(events.payload.case, "events");
    if (events.payload.case !== "events") throw new Error("events payload");
    assert.equal(events.payload.value.events.length, 1);
    assert.equal(events.payload.value.events[0]?.sessionId, session);
    assert.equal(
      events.payload.value.events[0]?.kind,
      CoreEventKind.FRAME_INVALIDATED,
    );
    assert.equal(events.payload.value.nextSequence, 1n);
    await command(
      {
        case: "spatial",
        value: {
          expectedRevision: 1n,
          action: {
            case: "registerChildSample",
            value: {
              frameId: { value: "body-frame" },
              parentId: { value: "root" },
              instant,
              toParent: {
                translationM: { x: 0, y: 0, z: -6 },
                rotation: { w: 2, x: 0, y: 0, z: 0 },
              },
            },
          },
        },
      },
      "child",
    );
    await command(
      {
        case: "spatial",
        value: {
          expectedRevision: 2n,
          action: {
            case: "registerProviderFrame",
            value: {
              frameId: { value: "provider-frame" },
              parentId: { value: "root" },
              provider: {
                providerId: "spaceeyes.nasa.dynamo",
                providerVersion: "0.0.1",
              },
            },
          },
        },
      },
      "provider-frame",
    );
    await command(
      {
        case: "spatial",
        value: {
          expectedRevision: 3n,
          action: {
            case: "updateProviderFrameSample",
            value: {
              frameId: { value: "provider-frame" },
              instant,
              toParent: {
                translationM: { x: 1, y: 2, z: 3 },
                rotation: { w: 1, x: 0, y: 0, z: 0 },
              },
            },
          },
        },
      },
      "provider-sample",
    );
    await command(
      {
        case: "resource",
        value: {
          action: {
            case: "registerTexture",
            value: {
              resourceId: { value: "texture" },
              texture: {
                width: 2,
                height: 1,
                rgba8: new Uint8Array([255, 40, 20, 255, 20, 40, 255, 255]),
                colorSpace: TextureColorSpace.SRGB,
              },
            },
          },
        },
      },
      "texture",
    );
    const mesh = {
      vertices: [
        {
          positionM: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 0, z: 1 },
          uv: { x: 0, y: 0 },
        },
        {
          positionM: { x: 1, y: 0, z: 0 },
          normal: { x: 0, y: 0, z: 1 },
          uv: { x: 1, y: 0 },
        },
        {
          positionM: { x: 0, y: 1, z: 0 },
          normal: { x: 0, y: 0, z: 1 },
          uv: { x: 0, y: 1 },
        },
      ],
      indices: [0, 1, 2],
    };
    await command(
      {
        case: "resource",
        value: {
          action: {
            case: "registerMesh",
            value: { resourceId: { value: "mesh" }, mesh },
          },
        },
      },
      "mesh",
    );
    const material = {
      baseColor: { r: 1, g: 1, b: 1 },
      texture: { value: "texture" },
      filter: SamplingFilter.NEAREST,
      address: SamplingAddress.CLAMP,
    };
    const camera = {
      positionM: { x: 0, y: 0, z: 0 },
      orientation: { w: 1, x: 0, y: 0, z: 0 },
      projection: {
        kind: {
          case: "perspective" as const,
          value: { verticalFovRadians: Math.PI / 2, nearM: 0.1, farM: 100 },
        },
      },
    };
    const sphere = { radiusM: 1, material };
    const meshInstance = { geometry: { value: "mesh" }, material };
    await command(
      {
        case: "sceneTransaction",
        value: {
          expectedRevision: revision,
          commands: [
            {
              action: {
                case: "create",
                value: {
                  object: {
                    objectId: { value: "camera" },
                    frameId: { value: "root" },
                    visible: true,
                    lifecycle: ObjectLifecycle.ACTIVE,
                    camera,
                  },
                },
              },
            },
            {
              action: {
                case: "create",
                value: {
                  object: {
                    objectId: { value: "body" },
                    frameId: { value: "body-frame" },
                    visible: true,
                    lifecycle: ObjectLifecycle.ACTIVE,
                    sphere,
                  },
                },
              },
            },
            {
              action: {
                case: "create",
                value: {
                  object: {
                    objectId: { value: "mesh-object" },
                    frameId: { value: "body-frame" },
                    visible: true,
                    lifecycle: ObjectLifecycle.ACTIVE,
                    mesh: meshInstance,
                  },
                },
              },
            },
          ],
        },
      },
      "scene",
    );
    assert.equal((await status()).resourceUsedBytes, 188n);
    const stats = record(
      await client.query(
        { case: "resourceStats", value: {} },
        { requestId: "resource-stats" },
      ),
    );
    assert.equal(stats.payload.case, "resourceStats");
    if (stats.payload.case === "resourceStats") {
      assert.equal(stats.payload.value.totalUsedBytes, 188n);
      assert.equal(stats.payload.value.cpuUsedBytes, 188n);
      assert.equal(stats.payload.value.gpuUsedBytes, 0n);
      assert.equal(stats.payload.value.stagingUsedBytes, 0n);
      assert.equal(stats.payload.value.totalLimitBytes, 256n * 1024n * 1024n);
      assert.equal(stats.payload.value.cpuLimitBytes, 128n * 1024n * 1024n);
      assert.equal(stats.payload.value.gpuLimitBytes, 128n * 1024n * 1024n);
      assert.equal(stats.payload.value.stagingLimitBytes, 32n * 1024n * 1024n);
      assert.equal(
        caps.limits!.maxResourceCpuBytes,
        stats.payload.value.cpuLimitBytes,
      );
    }
    const focusPayload = {
      case: "camera" as const,
      value: {
        action: {
          case: "focus" as const,
          value: {
            camera: { value: "camera" },
            target: { value: "mesh-object" },
            distanceM: 6,
            follow: true,
          },
        },
      },
    };
    const options = {
      requestId: "focus-mesh",
      expectedSceneRevision: revision,
      timeGeneration: 0n,
    };
    const focused = record(await client.command(focusPayload, options));
    revision = focused.committedSceneRevision;
    assert.deepEqual(await client.command(focusPayload, options), focused);
    const cameraInfo = record(
      await client.query(
        { case: "cameraState", value: { camera: { value: "camera" } } },
        { requestId: "camera-read" },
      ),
    );
    assert.equal(cameraInfo.payload.case, "camera");
    if (cameraInfo.payload.case === "camera") {
      assert.equal(
        cameraInfo.payload.value.state?.tracking?.target?.value,
        "mesh-object",
      );
      assert.equal(cameraInfo.payload.value.state?.positionM?.x, 0.5);
      assert.equal(cameraInfo.payload.value.state?.positionM?.y, 0.5);
      assert.equal(cameraInfo.payload.value.state?.positionM?.z, 0);
    }
    await assert.rejects(
      client.command(focusPayload, {
        ...options,
        requestId: "focus-stale",
        timeGeneration: 99n,
      }),
      (e: unknown) =>
        e instanceof CoreRemoteError && e.code === ErrorCode.STALE_GENERATION,
    );
    await assert.rejects(
      client.command(focusPayload, { ...options, requestId: "focus-conflict" }),
      (e: unknown) =>
        e instanceof CoreRemoteError && e.code === ErrorCode.REVISION_CONFLICT,
    );
    await command(
      {
        case: "scene",
        value: {
          action: {
            case: "setCamera",
            value: { objectId: { value: "camera" }, camera },
          },
        },
      },
      "reset-follow",
    );
    await command(
      {
        case: "scene",
        value: {
          action: {
            case: "create",
            value: {
              object: {
                objectId: { value: "spare" },
                visible: false,
                lifecycle: ObjectLifecycle.ACTIVE,
              },
            },
          },
        },
      },
      "create-spare",
    );
    await command(
      {
        case: "scene",
        value: {
          action: {
            case: "setParent",
            value: {
              objectId: { value: "mesh-object" },
              parentId: { value: "body" },
            },
          },
        },
      },
      "parent",
    );
    await command(
      {
        case: "scene",
        value: {
          action: {
            case: "setFrame",
            value: {
              objectId: { value: "mesh-object" },
              frameId: { value: "root" },
            },
          },
        },
      },
      "frame",
    );
    await command(
      {
        case: "scene",
        value: {
          action: {
            case: "setVisibility",
            value: { objectId: { value: "body" }, visible: false },
          },
        },
      },
      "visibility",
    );
    await command(
      {
        case: "scene",
        value: {
          action: {
            case: "setResources",
            value: {
              objectId: { value: "camera" },
              resources: [{ value: "texture" }],
            },
          },
        },
      },
      "resource-refs",
    );
    await command(
      {
        case: "scene",
        value: {
          action: {
            case: "setCamera",
            value: { objectId: { value: "camera" }, camera },
          },
        },
      },
      "camera",
    );
    await command(
      {
        case: "scene",
        value: {
          action: {
            case: "setSphere",
            value: {
              objectId: { value: "body" },
              sphere: { ...sphere, radiusM: 2 },
            },
          },
        },
      },
      "sphere",
    );
    await command(
      {
        case: "scene",
        value: {
          action: {
            case: "setMesh",
            value: { objectId: { value: "mesh-object" }, mesh: meshInstance },
          },
        },
      },
      "mesh-instance",
    );
    await command(
      {
        case: "scene",
        value: {
          action: { case: "remove", value: { objectId: { value: "spare" } } },
        },
      },
      "remove",
    );
    await command(
      { case: "lifecycle", value: { action: { case: "start", value: {} } } },
      "start",
    );
    for (const action of ["play", "pause"] as const)
      await command(
        { case: "time", value: { action: { case: action, value: {} } } },
        action,
      );
    await command(
      {
        case: "time",
        value: { action: { case: "setRate", value: { rate: -0.25 } } },
      },
      "rate",
    );
    const delta = 9007199254740995n;
    await command(
      {
        case: "time",
        value: { action: { case: "step", value: { deltaNanos: delta } } },
      },
      "step",
    );
    const stepped = (await status()).clock!;
    assert.equal(
      stepped.instant!.seconds * 1000000000n + BigInt(stepped.instant!.nanos),
      initialSeconds * 1000000000n + delta,
    );
    assert.equal(stepped.rateNumerator, -1);
    assert.equal(stepped.rateDenominator, 4);
    await assert.rejects(
      client.query(
        {
          case: "resolveFrame",
          value: { source: { value: "body-frame" }, target: { value: "root" } },
        },
        { requestId: "uncovered" },
      ),
      (error: unknown) =>
        error instanceof CoreRemoteError &&
        error.code === ErrorCode.TIME_NOT_COVERED,
    );
    const seek = {
      case: "time" as const,
      value: { action: { case: "seek" as const, value: { instant } } },
    };
    const receipt = await command(seek, "seek");
    assert.deepEqual(
      record(
        await client.command(seek, {
          requestId: "seek",
          expectedSceneRevision: revision,
        }),
      ),
      receipt,
    );
    const pose = record(
      await client.query(
        {
          case: "resolveFrame",
          value: { source: { value: "body-frame" }, target: { value: "root" } },
        },
        { requestId: "pose" },
      ),
    );
    assert.equal(pose.payload.case, "frame");
    if (pose.payload.case === "frame") {
      assert.equal(pose.payload.value.transform?.translationM?.z, -6);
      assert.equal(pose.payload.value.instant?.seconds, initialSeconds);
    }
    const liveCaps = record(
      await client.query(
        { case: "capabilities", value: {} },
        { requestId: "caps-live" },
      ),
    );
    assert.equal(liveCaps.payload.case, "capabilities");
    if (liveCaps.payload.case === "capabilities")
      assert(liveCaps.payload.value.limits!.commandHistoryRemaining < 4096n);
    await command(
      { case: "lifecycle", value: { action: { case: "stop", value: {} } } },
      "stop",
    );
    const stopped = await status();
    assert.equal(stopped.lifecycle, EngineLifecycle.STOPPED);
    assert.equal(stopped.resourceUsedBytes, 0n);
    return transcript;
  } finally {
    await h.close();
  }
}
test(
  "same generated TS client exercises every advertised command on Native and actual WASM",
  { timeout: 30000 },
  async () => {
    const native = await exercise("native");
    const wasm = await exercise("wasm");
    assert.deepEqual(
      wasm,
      native,
      "public byte responses must match across compilation targets",
    );
  },
);
for (const backend of ["native", "wasm"] as const) {
  test(
    `${backend}: structured conflicts, stale generations and atomic failure preserve authority`,
    { timeout: 30000 },
    async () => {
      const h = host(backend);
      const client = new CoreClient(h.transport, session);
      try {
        await client.connect();
        const get = async () =>
          state(
            await client.query(
              { case: "sessionStatus", value: {} },
              { requestId: "same-query" },
            ),
          );
        const before = await get();
        const object = {
          objectId: { value: "one" },
          visible: true,
          lifecycle: ObjectLifecycle.ACTIVE,
        };
        const createOne: CommandPayload = {
          case: "scene",
          value: { action: { case: "create", value: { object } } },
        };
        const receipt = await client.command(createOne, {
          requestId: "one",
          expectedSceneRevision: 0n,
        });
        assert.deepEqual(
          await client.command(createOne, {
            requestId: "one",
            expectedSceneRevision: 0n,
          }),
          receipt,
        );
        await assert.rejects(
          client.command(createOne, {
            requestId: "one",
            expectedSceneRevision: 1n,
          }),
          (e: unknown) =>
            e instanceof CoreRemoteError &&
            e.code === ErrorCode.IDEMPOTENCY_CONFLICT,
        );
        await assert.rejects(
          client.command(
            {
              case: "sceneTransaction",
              value: {
                expectedRevision: 1n,
                commands: [
                  {
                    action: {
                      case: "create",
                      value: {
                        object: { ...object, objectId: { value: "two" } },
                      },
                    },
                  },
                  {
                    action: {
                      case: "setParent",
                      value: {
                        objectId: { value: "two" },
                        parentId: { value: "missing" },
                      },
                    },
                  },
                ],
              },
            },
            { requestId: "bad-batch", expectedSceneRevision: 1n },
          ),
          CoreRemoteError,
        );
        assert.equal((await get()).objectCount, 1n);
        await assert.rejects(
          client.command(createOne, {
            requestId: "large-revision",
            expectedSceneRevision: 9007199254740993n,
          }),
          (e: unknown) =>
            e instanceof CoreRemoteError &&
            e.code === ErrorCode.REVISION_CONFLICT,
        );
        await assert.rejects(
          client.query(
            { case: "sessionStatus", value: {} },
            {
              requestId: "stale",
              timeGeneration: before.clock!.generation + 1n,
            },
          ),
          (e: unknown) =>
            e instanceof CoreRemoteError &&
            e.code === ErrorCode.STALE_GENERATION,
        );
        assert.equal((await get()).sceneRevision, 1n);
      } finally {
        await h.close();
      }
    },
  );
}
test("negotiation rejects missing capabilities and incompatible versions before writes", async () => {
  const h = host("wasm");
  let writes = 0;
  const transport: ByteTransport = {
    submit: (b) => {
      writes++;
      return h.transport.submit(b);
    },
    query: (b) => h.transport.query(b),
  };
  try {
    const client = new CoreClient(transport, session);
    await assert.rejects(
      client.command(
        { case: "lifecycle", value: { action: { case: "start", value: {} } } },
        { requestId: "before-connect" },
      ),
      /negotiate/,
    );
    await assert.rejects(
      client.connect(["rendering.canvas"]),
      UnsupportedCapabilityError,
    );
    await client.connect();
    await assert.rejects(
      client.command(
        { case: "time", value: { action: { case: "live", value: {} } } },
        { requestId: "unsupported" },
      ),
      UnsupportedCapabilityError,
    );
    const incompatible = new CoreClient(
      {
        ...transport,
        query: async (b) => {
          const response = fromBinary(
            ResponseEnvelopeSchema,
            await transport.query(b),
          );
          if (response.payload.case === "capabilities")
            response.payload.value.protocolVersion!.major = 99;
          return toBinary(ResponseEnvelopeSchema, response);
        },
      },
      session,
    );
    await assert.rejects(incompatible.connect(), /Incompatible/);
    assert.equal(writes, 0);
  } finally {
    await h.close();
  }
});
test("SDK rejects unsafe numbers, oversized bytes and malformed response correlation", async () => {
  const h = host("wasm");
  let writes = 0;
  const transport: ByteTransport = {
    submit: (b) => {
      writes++;
      return h.transport.submit(b);
    },
    query: (b) => h.transport.query(b),
  };
  try {
    const client = new CoreClient(transport, session);
    await client.connect();
    await assert.rejects(
      client.command(
        {
          case: "time",
          value: {
            action: {
              case: "step",
              value: { deltaNanos: 9007199254740993 as unknown as bigint },
            },
          },
        },
        { requestId: "unsafe" },
      ),
      /bigint/,
    );
    await assert.rejects(
      client.command(
        {
          case: "time",
          value: { action: { case: "step", value: { deltaNanos: 1n } } },
        },
        {
          requestId: "unsafe-context",
          expectedSceneRevision: 1 as unknown as bigint,
        },
      ),
      /bigint/,
    );
    await assert.rejects(
      client.command(
        {
          case: "resource",
          value: {
            action: {
              case: "registerTexture",
              value: {
                resourceId: { value: "huge" },
                texture: { rgba8: new Uint8Array(1048576) },
              },
            },
          },
        },
        { requestId: "oversized" },
      ),
      RangeError,
    );
    assert.equal(writes, 0);
    const bad = new CoreClient(
      {
        ...transport,
        query: async (b) => {
          const response = fromBinary(
            ResponseEnvelopeSchema,
            await transport.query(b),
          );
          response.requestId = "wrong";
          return toBinary(ResponseEnvelopeSchema, response);
        },
      },
      session,
    );
    await assert.rejects(bad.connect(), /request ID mismatch/);
    const pending = new CoreClient(
      {
        ...transport,
        query: async (b) => {
          const response = fromBinary(
            ResponseEnvelopeSchema,
            await transport.query(b),
          );
          response.status = ResponseStatus.ACCEPTED;
          return toBinary(ResponseEnvelopeSchema, response);
        },
      },
      session,
    );
    await assert.rejects(pending.connect(), /Unexpected response/);
  } finally {
    await h.close();
  }
});
test("transport failures are surfaced once without implicit retry", async () => {
  const h = host("wasm");
  let attempts = 0;
  try {
    const client = new CoreClient(
      {
        query: (b) => h.transport.query(b),
        submit: () => {
          attempts++;
          throw new Error("transport disconnected");
        },
      },
      session,
    );
    await client.connect();
    await assert.rejects(
      client.command(
        { case: "lifecycle", value: { action: { case: "start", value: {} } } },
        { requestId: "retry-owned-by-caller" },
      ),
      /disconnected/,
    );
    assert.equal(attempts, 1);
  } finally {
    await h.close();
  }
});
test("independent WASM sessions do not share scene authority", async () => {
  const first = host("wasm");
  const second = host("wasm");
  try {
    const a = new CoreClient(first.transport, session);
    const b = new CoreClient(second.transport, session);
    await a.connect();
    await b.connect();
    await a.command(
      {
        case: "scene",
        value: {
          action: {
            case: "create",
            value: {
              object: {
                objectId: { value: "only-a" },
                visible: true,
                lifecycle: ObjectLifecycle.ACTIVE,
              },
            },
          },
        },
      },
      { requestId: "create", expectedSceneRevision: 0n },
    );
    assert.equal(
      state(
        await b.query(
          { case: "sessionStatus", value: {} },
          { requestId: "check" },
        ),
      ).objectCount,
      0n,
    );
  } finally {
    await first.close();
    await second.close();
  }
});

test("synthetic u64/i64 boundaries roundtrip from generated TS through Rust and back exactly", () => {
  const max = (1n << 64n) - 1n;
  const large = 9007199254740993n;
  const message = create(ResponseEnvelopeSchema, {
    requestId: "wire-boundaries",
    status: ResponseStatus.COMPLETED,
    commandSequence: max,
    committedSceneRevision: large,
    frameSequence: max,
    payload: {
      case: "session",
      value: {
        lifecycle: EngineLifecycle.READY,
        clock: {
          instant: {
            timeScale: TimeScale.TT,
            epochId: "synthetic-wire-vector",
            seconds: -(1n << 63n),
            nanos: 999999999,
          },
          mode: 1,
          rate: -0.25,
          generation: max,
          revision: max,
          rateNumerator: -1,
          rateDenominator: 4,
        },
        sceneRevision: large,
        frameGraphRevision: max,
        resourceRevision: max,
        frameSequence: max,
        objectCount: 0n,
        resourceUsedBytes: 0n,
      },
    },
  });
  const encoded = toBinary(ResponseEnvelopeSchema, message);
  const result = spawnSync(
    join(root, "target/debug/examples/wire_vector"),
    [],
    { input: encoded, maxBuffer: 1048576 },
  );
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(fromBinary(ResponseEnvelopeSchema, result.stdout), message);
  // Protobuf allows different field ordering between encoders. Compare decoded values
  // and TS canonical re-encoding; Rust already compared every received field.
  assert.deepEqual(
    toBinary(
      ResponseEnvelopeSchema,
      fromBinary(ResponseEnvelopeSchema, result.stdout),
    ),
    encoded,
  );
});

test("bounded uploads move a texture larger than one message through Native and WASM with the same semantics", async () => {
  const outcomes: unknown[] = [];
  const rgba = new Uint8Array(1024 * 512 * 4).fill(255);
  const sha256 = new Uint8Array(createHash("sha256").update(rgba).digest());
  for (const backend of ["native", "wasm"] as const) {
    const h = host(backend);
    try {
      const client = new CoreClient(h.transport, session);
      const caps = await client.connect([
        "resources.begin_upload",
        "resources.append_upload",
        "resources.finish_upload",
        "resources.cancel_upload",
        "query.upload",
      ]);
      assert.equal(caps.limits!.maxMessageBytes, 1048576);
      assert.equal(caps.limits!.maxUploadBytes, 16n * 1024n * 1024n);
      assert.equal(caps.limits!.maxUploadChunkBytes, 262144);
      assert.equal(caps.limits!.maxActiveUploads, 4);
      assert.equal(caps.limits!.maxEncodedImageBytes, 8n * 1024n * 1024n);
      const beginPayload: CommandPayload = {
        case: "resource",
        value: {
          action: {
            case: "beginUpload",
            value: {
              resourceId: { value: "large-texture" },
              totalBytes: BigInt(rgba.length),
              source: {
                sourceId: "self-generated:opaque-white",
                sourceVersion: "v1",
                sha256,
              },
              format: ResourceUploadFormat.RGBA8,
              width: 1024,
              height: 512,
              colorSpace: TextureColorSpace.SRGB,
            },
          },
        },
      };
      const begun = await client.command(beginPayload, {
        requestId: "begin-large",
      });
      assert.deepEqual(
        await client.command(beginPayload, { requestId: "begin-large" }),
        begun,
      );
      assert.equal(begun.payload.case, "upload");
      if (begun.payload.case !== "upload") throw new Error("expected upload");
      const uploadId = begun.payload.value.uploadId;
      const stats = async () => {
        const r = await client.query(
          { case: "resourceStats", value: {} },
          { requestId: "stats" },
        );
        if (r.payload.case !== "resourceStats")
          throw new Error("expected stats");
        return r.payload.value;
      };
      let usage = await stats();
      assert.equal(usage.cpuUsedBytes, BigInt(rgba.length));
      assert.equal(usage.stagingUsedBytes, BigInt(rgba.length));
      for (let offset = 0; offset < rgba.length; offset += 262144) {
        const payload: CommandPayload = {
          case: "resource",
          value: {
            action: {
              case: "appendUpload",
              value: {
                uploadId,
                offset: BigInt(offset),
                data: rgba.slice(offset, offset + 262144),
              },
            },
          },
        };
        const r = await client.command(payload, {
          requestId: `chunk:${offset}`,
        });
        assert.deepEqual(
          await client.command(payload, { requestId: `chunk:${offset}` }),
          r,
        );
        assert.equal(r.payload.case, "upload");
        if (r.payload.case === "upload")
          assert.equal(r.payload.value.receivedBytes, BigInt(offset + 262144));
      }
      const status = await client.query(
        { case: "upload", value: { uploadId } },
        { requestId: "progress" },
      );
      if (status.payload.case !== "upload") throw new Error("expected upload");
      assert.equal(status.payload.value.receivedBytes, BigInt(rgba.length));
      const finish: CommandPayload = {
        case: "resource",
        value: { action: { case: "finishUpload", value: { uploadId } } },
      };
      const done = await client.command(finish, { requestId: "finish" });
      assert.deepEqual(
        await client.command(finish, { requestId: "finish" }),
        done,
      );
      usage = await stats();
      assert.equal(usage.cpuUsedBytes, BigInt(rgba.length));
      assert.equal(usage.stagingUsedBytes, 0n);
      assert.equal(usage.totalUsedBytes, BigInt(rgba.length));
      await assert.rejects(
        client.query(
          { case: "upload", value: { uploadId } },
          { requestId: "late" },
        ),
        CoreRemoteError,
      );
      // Encoded images are decoded by the core and charged as decoded RGBA bytes.
      const png = Uint8Array.from([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
        2, 0, 0, 0, 1, 8, 6, 0, 0, 0, 244, 34, 127, 138, 0, 0, 0, 17, 73, 68,
        65, 84, 120, 218, 99, 224, 18, 145, 251, 175, 97, 100, 243, 31, 0, 9,
        65, 2, 209, 105, 103, 96, 84, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96,
        130,
      ]);
      const imageBegin: CommandPayload = {
        case: "resource",
        value: {
          action: {
            case: "beginUpload",
            value: {
              resourceId: { value: "encoded-png" },
              totalBytes: BigInt(png.length),
              source: {
                sourceId: "self-generated:png",
                sourceVersion: "v1",
                sha256: new Uint8Array(
                  createHash("sha256").update(png).digest(),
                ),
              },
              format: ResourceUploadFormat.PNG,
              colorSpace: TextureColorSpace.SRGB,
            },
          },
        },
      };
      const image = await client.command(imageBegin, {
        requestId: "begin-png",
      });
      if (image.payload.case !== "upload") throw new Error("expected upload");
      await client.command(
        {
          case: "resource",
          value: {
            action: {
              case: "appendUpload",
              value: {
                uploadId: image.payload.value.uploadId,
                offset: 0n,
                data: png,
              },
            },
          },
        },
        { requestId: "png-chunk" },
      );
      await client.command(
        {
          case: "resource",
          value: {
            action: {
              case: "finishUpload",
              value: { uploadId: image.payload.value.uploadId },
            },
          },
        },
        { requestId: "png-finish" },
      );
      usage = await stats();
      assert.equal(usage.cpuUsedBytes, BigInt(rgba.length + 8));
      assert.equal(usage.stagingUsedBytes, 0n);
      assert.equal(usage.totalUsedBytes, BigInt(rgba.length + 8));
      const again = await client.command(
        {
          case: "resource",
          value: {
            action: {
              case: "beginUpload",
              value: {
                resourceId: { value: "stop-inflight" },
                totalBytes: BigInt(rgba.length),
                source: {
                  sourceId: "self-generated:opaque-white",
                  sourceVersion: "v1",
                  sha256,
                },
                format: ResourceUploadFormat.RGBA8,
                width: 1024,
                height: 512,
                colorSpace: TextureColorSpace.SRGB,
              },
            },
          },
        },
        { requestId: "begin-stop" },
      );
      assert.equal(again.payload.case, "upload");
      if (again.payload.case !== "upload") throw new Error("expected upload");
      const cancelPayload: CommandPayload = {
        case: "resource",
        value: {
          action: {
            case: "cancelUpload",
            value: { uploadId: again.payload.value.uploadId },
          },
        },
      };
      const cancelled = await client.command(cancelPayload, {
        requestId: "cancel",
      });
      assert.deepEqual(
        await client.command(cancelPayload, { requestId: "cancel" }),
        cancelled,
      );
      usage = await stats();
      assert.equal(usage.cpuUsedBytes, BigInt(rgba.length + 8));
      assert.equal(usage.stagingUsedBytes, 0n);
      await client.command(
        {
          case: "resource",
          value: {
            action: {
              case: "beginUpload",
              value: {
                resourceId: { value: "stop-final" },
                totalBytes: BigInt(rgba.length),
                source: {
                  sourceId: "self-generated:opaque-white",
                  sourceVersion: "v1",
                  sha256,
                },
                format: ResourceUploadFormat.RGBA8,
                width: 1024,
                height: 512,
                colorSpace: TextureColorSpace.SRGB,
              },
            },
          },
        },
        { requestId: "stop-final-begin" },
      );
      await client.command(
        { case: "lifecycle", value: { action: { case: "stop", value: {} } } },
        { requestId: "stop" },
      );
      usage = await stats();
      assert.equal(usage.totalUsedBytes, 0n);
      outcomes.push({ completed: done.payload, afterStop: usage });
    } finally {
      await h.close();
    }
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});
