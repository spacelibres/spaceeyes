// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import {
  CoreClient,
  wasmTransport,
  create,
  toBinary,
  fromBinary,
  HostFrameEnvelopeSchema,
  ResponseEnvelopeSchema,
  ResponseStatus,
  ProjectSnapshotSchema,
  PlaybackMode,
  ObjectLifecycle,
  TextureColorSpace,
  SamplingFilter,
  SamplingAddress,
  CoreRemoteError,
  ErrorCode,
  type SessionStatus,
  type CommandPayload,
  type CameraState,
  type ResponseEnvelope,
} from "@spaceeyes/core-sdk";
import type { DynamoSegmentLoader } from "@spaceeyes/nasa-dynamo";
import type { SolarState } from "./solar-system";
import {
  createSolarLoader,
  displayPosition,
  orbitMesh,
  solarState,
  solarSeconds,
  SOLAR_BODIES,
  SOLAR_CAMERA,
  SOLAR_NAMES,
  SUN,
} from "./solar-system";
import type { WasmEngine } from "../public/wasm/spaceeyes_wasm.js";
import { formatSimulationTime, parseSimulationSeconds } from "./time";
export type ViewStatus = {
  phase: "初始化" | "运行中" | "已停止" | "错误";
  frameCount: number;
  objectCount: number;
  clockNs: string;
  clockText: string;
  playing: boolean;
  resourceBytes: string;
  width: number;
  height: number;
  selectionText: string;
  cameraMode: string;
  playbackRate: string;
  cameraTarget?: string;
  actionError?: string;
  selected?: { id: string; kind: string; reference: string; sequence: string };
  selectedEphemeris?: string;
  error?: string;
};
export const initialStatus: ViewStatus = {
  phase: "初始化",
  frameCount: 0,
  objectCount: 0,
  clockNs: "0",
  clockText: "0.000000000",
  playing: false,
  resourceBytes: "0",
  width: 0,
  height: 0,
  selectionText: "点击画面选择对象",
  cameraMode: "自由视角",
  playbackRate: "1",
};
const sessionId = "browser-session";
const principal = "trusted-browser-host";
type BrowserBindings = typeof import("../public/wasm/spaceeyes_wasm.js");
let runtime: Promise<BrowserBindings> | undefined;
function loadRuntime(): Promise<BrowserBindings> {
  if (!runtime) {
    const url = "/wasm/spaceeyes_wasm.js";
    runtime = (async () => {
      const bindings = (await import(
        /* webpackIgnore:true */ url
      )) as BrowserBindings;
      await bindings.default({
        module_or_path: "/wasm/spaceeyes_wasm_bg.wasm",
      });
      return bindings;
    })().catch((error) => {
      runtime = undefined;
      throw error;
    });
  }
  return runtime;
}
/** Detect the DYN-backed scene from persisted provider labels. */
function projectUsesDynamo(bytes: Uint8Array): boolean {
  try {
    const snapshot = fromBinary(ProjectSnapshotSchema, bytes);
    return snapshot.frames.some(
      (frame) => frame.provider?.providerId === "spaceeyes.nasa.dynamo",
    );
  } catch {
    return false;
  }
}
export class BrowserSession {
  private engine: WasmEngine | undefined;
  private client: CoreClient | undefined;
  private state: SessionStatus | undefined;
  private disposed = false;
  private tail: Promise<void> = Promise.resolve();
  private disposal: Promise<ViewStatus> | undefined;
  private raf: number | undefined;
  private previousTime: number | undefined;
  private request = 0;
  private frames = 0;
  private yaw = 0;
  private width = 0;
  private height = 0;
  private lastNotify = 0;
  private maxDimension = 2048;
  private presentedSequence: bigint | undefined;
  private selectionText = "点击画面选择对象";
  private selected: ViewStatus["selected"];
  private selectionRevision: bigint | undefined;
  private cameraCreated = false;
  private cameraState: CameraState | undefined;
  private actionError: string | undefined;
  private solarMode = false;
  private solarLoader: DynamoSegmentLoader | undefined;
  private readonly solarStates = new Map<string, SolarState>();
  private solarInstant: string | undefined;
  private solarTimeEt: number | undefined;
  private solarIndex = 0;
  private readonly onClick = (event: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || this.presentedSequence === undefined)
      return;
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    void this.enqueue(async () => {
      try {
        // Consume the latest completed presentation inside the serialized host queue.
        // A presentation may have been in flight when the pointer event arrived.
        const sequence = this.presentedSequence;
        const currentRect = this.canvas.getBoundingClientRect();
        if (
          sequence === undefined ||
          currentRect.width !== rect.width ||
          currentRect.height !== rect.height
        ) {
          this.selected = undefined;
          this.selectionText = "画布已变化，请重新选择";
          if (!this.disposed) this.notify(this.summary("运行中"));
          return;
        }
        const response = await this.client!.query(
          { case: "pickPresented", value: { frameSequence: sequence, x, y } },
          { requestId: `web:pick:${++this.request}` },
        );
        if (response.payload.case !== "selection")
          throw new Error("缺少选择结果");
        const result = response.payload.value;
        const object = result.object;
        this.selectionRevision = object ? result.sceneRevision : undefined;
        this.selected = object
          ? {
              id: object.objectId!.value,
              kind: object.sphere ? "球体" : object.mesh ? "三角网格" : "标记",
              reference: object.frameId?.value ?? "无参考系",
              sequence: result.frameSequence.toString(),
            }
          : undefined;
        this.selectionText = object ? "已选择对象" : "未命中对象";
      } catch (error) {
        if (
          !(error instanceof CoreRemoteError) ||
          error.code !== ErrorCode.SNAPSHOT_EXPIRED
        )
          throw error;
        this.selected = undefined;
        this.selectionText = "画面已更新，请重新选择";
      }
      if (!this.disposed) this.notify(this.summary("运行中"));
    }).catch((error) => this.fail(error));
  };
  constructor(
    private canvas: HTMLCanvasElement,
    private notify: (status: ViewStatus) => void,
    private readonly projectBytes?: Uint8Array,
  ) {
    this.solarMode = this.projectBytes
      ? projectUsesDynamo(this.projectBytes)
      : typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("scene") === "solar";
    this.canvas.addEventListener("click", this.onClick);
    void this.enqueue(() => this.initialize())
      .then(() => this.schedule())
      .catch((error) => this.fail(error));
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => {
      if (this.disposed) throw new Error("session disposed");
      return operation();
    });
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private async initialize(): Promise<void> {
    if (!("gpu" in navigator) || !navigator.gpu)
      throw new Error("此浏览器不支持 WebGPU，无法启动三维场景。");
    const bindings = await loadRuntime();
    if (this.disposed) return;
    this.engine = this.projectBytes
      ? bindings.WasmEngine.from_project(sessionId, this.projectBytes)
      : new bindings.WasmEngine(
          sessionId,
          "TT",
          "PROTOTYPE_EXPLICIT_EPOCH",
          0n,
          0,
        );
    this.client = new CoreClient(
      wasmTransport(this.engine, principal),
      sessionId,
    );
    const capabilities = await this.client.connect([
      "scene.transaction",
      "lifecycle.start",
      "query.session_status",
      "query.pick_presented",
      "camera.focus",
      "query.camera_state",
      "time.set_rate",
      "time.step",
      "time.seek",
      "query.project_export",
      ...(this.solarMode
        ? [
            "spatial.register_provider_frame",
            "spatial.update_provider_frame_sample",
          ]
        : []),
    ]);
    if (!capabilities.browserSurface)
      throw new Error("当前核心未提供浏览器画布能力。");
    this.maxDimension = capabilities.limits!.maxCanvasDimension;
    if (this.disposed) return;
    await this.engine.attach_canvas(this.canvas);
    if (this.disposed) return;
    if (this.projectBytes) {
      this.cameraCreated = true;
      this.solarLoader = this.solarMode ? createSolarLoader() : undefined;
      await this.refresh();
      await this.command({
        case: "lifecycle",
        value: { action: { case: "start", value: {} } },
      });
      await this.refresh();
      return;
    }
    const rootResponse = await this.command({
      case: "spatial",
      value: {
        expectedRevision: 0n,
        action: {
          case: "registerRoot",
          value: { frameId: { value: "demo:root" } },
        },
      },
    });
    if (this.solarMode) {
      if (rootResponse.payload.case !== "spatial")
        throw new Error("缺少参考系修订");
      let revision = rootResponse.payload.value.frameGraphRevision;
      for (const body of SOLAR_BODIES) {
        const response = await this.command({
          case: "spatial",
          value: {
            expectedRevision: revision,
            action: {
              case: "registerProviderFrame",
              value: {
                frameId: { value: body.frame },
                parentId: { value: body.parentFrame },
                provider: {
                  providerId: "spaceeyes.nasa.dynamo",
                  providerVersion: "0.0.1",
                },
              },
            },
          },
        });
        if (response.payload.case !== "spatial")
          throw new Error("缺少参考系修订");
        revision = response.payload.value.frameGraphRevision;
      }
      this.solarLoader = createSolarLoader();
    }
    const pixels = new Uint8Array(
      Array.from({ length: 16 }, (_, i) =>
        (Math.floor(i / 4) + (i % 4)) % 2 === 0
          ? [242, 167, 45, 255]
          : [35, 90, 210, 255],
      ).flat(),
    );
    await this.command({
      case: "resource",
      value: {
        action: {
          case: "registerTexture",
          value: {
            resourceId: { value: "demo:texture" },
            texture: {
              width: 4,
              height: 4,
              rgba8: pixels,
              colorSpace: TextureColorSpace.SRGB,
            },
          },
        },
      },
    });
    const vertices = [
      [-0.7, -0.7, -0.5],
      [0.7, -0.7, -0.5],
      [0, 0.7, 0],
    ].map(([x, y, z], i) => ({
      positionM: { x: x + 2, y, z },
      normal: { x: 0, y: 0, z: 1 },
      uv: { x: i === 1 ? 1 : 0, y: i === 2 ? 0 : 1 },
    }));
    await this.command({
      case: "resource",
      value: {
        action: {
          case: "registerMesh",
          value: {
            resourceId: { value: "demo:mesh" },
            mesh: { vertices, indices: [0, 1, 2] },
          },
        },
      },
    });
    const material = {
      baseColor: { r: 1, g: 1, b: 1 },
      texture: { value: "demo:texture" },
      filter: SamplingFilter.NEAREST,
      address: SamplingAddress.CLAMP,
    };
    await this.refresh();
    const orbitCommands = [];
    if (this.solarMode && this.solarLoader) {
      for (const body of SOLAR_BODIES) {
        try {
          const loaded = await this.solarLoader.load(body.path, 0);
          const mesh = orbitMesh(loaded, 0);
          if (mesh === null) continue;
          const resource = `solar:orbit:${body.frame}`;
          await this.command({
            case: "resource",
            value: {
              action: {
                case: "registerMesh",
                value: {
                  resourceId: { value: resource },
                  mesh: {
                    vertices: [...mesh.vertices],
                    indices: [...mesh.indices],
                  },
                },
              },
            },
          });
          orbitCommands.push({
            action: {
              case: "create" as const,
              value: {
                object: {
                  objectId: { value: resource },
                  frameId: { value: body.parentFrame },
                  visible: true,
                  lifecycle: ObjectLifecycle.ACTIVE,
                  mesh: {
                    geometry: { value: resource },
                    material: {
                      baseColor: body.color,
                      filter: SamplingFilter.NEAREST,
                      address: SamplingAddress.CLAMP,
                      unlit: true,
                    },
                  },
                },
              },
            },
          });
        } catch {
          // Keep the body usable even when its orbit window is unavailable.
          this.actionError = "轨道线加载失败，星体位置仍可用";
        }
      }
    }
    const solarCommands = this.solarMode
      ? [
          ...SOLAR_BODIES.map((body) => ({
            action: {
              case: "create" as const,
              value: {
                object: {
                  objectId: { value: body.id },
                  frameId: { value: body.frame },
                  visible: true,
                  lifecycle: ObjectLifecycle.ACTIVE,
                  sphere: {
                    radiusM: body.radiusM,
                    material: {
                      baseColor: body.color,
                      filter: SamplingFilter.NEAREST,
                      address: SamplingAddress.CLAMP,
                    },
                  },
                },
              },
            },
          })),
          {
            action: {
              case: "create" as const,
              value: {
                object: {
                  objectId: { value: SUN.id },
                  frameId: { value: SUN.frame },
                  visible: true,
                  lifecycle: ObjectLifecycle.ACTIVE,
                  sphere: {
                    radiusM: SUN.radiusM,
                    material: {
                      baseColor: SUN.color,
                      filter: SamplingFilter.NEAREST,
                      address: SamplingAddress.CLAMP,
                    },
                  },
                },
              },
            },
          },
          {
            action: {
              case: "create" as const,
              value: {
                object: {
                  objectId: { value: "demo:camera" },
                  frameId: { value: "demo:root" },
                  visible: true,
                  lifecycle: ObjectLifecycle.ACTIVE,
                  camera: this.camera(0),
                },
              },
            },
          },
          ...orbitCommands,
        ]
      : [
          {
            action: {
              case: "create" as const,
              value: {
                object: {
                  objectId: { value: "demo:body" },
                  frameId: { value: "demo:root" },
                  visible: true,
                  lifecycle: ObjectLifecycle.ACTIVE,
                  sphere: { radiusM: 1.2, material },
                },
              },
            },
          },
          {
            action: {
              case: "create" as const,
              value: {
                object: {
                  objectId: { value: "demo:mesh-object" },
                  frameId: { value: "demo:root" },
                  visible: true,
                  lifecycle: ObjectLifecycle.ACTIVE,
                  mesh: { geometry: { value: "demo:mesh" }, material },
                },
              },
            },
          },
          {
            action: {
              case: "create" as const,
              value: {
                object: {
                  objectId: { value: "demo:camera" },
                  frameId: { value: "demo:root" },
                  visible: true,
                  lifecycle: ObjectLifecycle.ACTIVE,
                  camera: this.camera(0),
                },
              },
            },
          },
        ];
    await this.command({
      case: "sceneTransaction",
      value: {
        expectedRevision: this.state!.sceneRevision,
        commands: solarCommands,
      },
    });
    await this.command({
      case: "lifecycle",
      value: { action: { case: "start", value: {} } },
    });
    this.cameraCreated = true;
    await this.refresh();
  }
  private camera(yaw: number) {
    const half = (yaw * Math.PI) / 360;
    const positionM = this.solarMode
      ? SOLAR_CAMERA.positionM
      : { x: 0, y: 0, z: 6 };
    return {
      positionM,
      orientation: { w: Math.cos(half), x: 0, y: Math.sin(half), z: 0 },
      projection: {
        kind: {
          case: "perspective" as const,
          value: {
            verticalFovRadians: Math.PI / 3,
            nearM: this.solarMode ? SOLAR_CAMERA.nearM : 0.1,
            farM: this.solarMode ? SOLAR_CAMERA.farM : 100,
          },
        },
      },
    };
  }
  private async command(payload: CommandPayload): Promise<ResponseEnvelope> {
    return this.client!.command(payload, {
      requestId: `web:command:${++this.request}`,
      ...(this.state
        ? {
            expectedSceneRevision: this.state.sceneRevision,
            timeGeneration: this.state.clock!.generation,
          }
        : {}),
    });
  }
  private async refresh(): Promise<void> {
    const response = await this.client!.query(
      { case: "sessionStatus", value: {} },
      { requestId: "web:status" },
    );
    if (response.payload.case !== "session") throw new Error("缺少会话状态");
    this.state = response.payload.value;
    if (this.cameraCreated) {
      const camera = await this.client!.query(
        { case: "cameraState", value: { camera: { value: "demo:camera" } } },
        { requestId: "web:camera-state" },
      );
      if (camera.payload.case !== "camera") throw new Error("缺少相机状态");
      this.cameraState = camera.payload.value.state;
    }
  }
  private summary(phase: ViewStatus["phase"]): ViewStatus {
    const time = this.state?.clock?.instant;
    const seconds = time?.seconds ?? 0n;
    const nanos = time?.nanos ?? 0;
    const separated = this.selected
      ? this.solarStates.get(this.selected.id)
      : undefined;
    const selectedEphemeris = separated
      ? `${SOLAR_NAMES[this.selected!.id] ?? this.selected!.id} · 距父级 ${Math.hypot(
          separated.position.x,
          separated.position.y,
          separated.position.z,
        ).toFixed(0)} km · 速度 ${Math.hypot(
          separated.velocity.x,
          separated.velocity.y,
          separated.velocity.z,
        ).toFixed(2)} km/s`
      : undefined;
    return {
      phase,
      frameCount: this.frames,
      objectCount: Number(this.state?.objectCount ?? 0n),
      clockNs: (seconds * 1000000000n + BigInt(nanos)).toString(),
      clockText: formatSimulationTime(seconds, nanos),
      playbackRate: String(
        (this.state?.clock?.rateNumerator ?? 1) /
          (this.state?.clock?.rateDenominator || 1),
      ),
      playing: this.state?.clock?.mode === PlaybackMode.PLAYING,
      resourceBytes: (this.state?.resourceUsedBytes ?? 0n).toString(),
      width: this.width,
      height: this.height,
      selectionText: this.selectionText,
      selected: this.selected,
      selectedEphemeris,
      cameraMode: this.cameraState?.tracking ? "跟随目标" : "自由视角",
      cameraTarget: this.cameraState?.tracking?.target?.value,
      actionError: this.actionError,
    };
  }
  private schedule(): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((timestamp) => {
      this.raf = undefined;
      void this.enqueue(() => this.frame(timestamp))
        .then(() => this.schedule())
        .catch((error) => this.fail(error));
    });
  }
  private async frame(timestamp: number): Promise<void> {
    if (!this.engine || !this.state) return;
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(
      devicePixelRatio || 1,
      this.maxDimension / Math.max(1, rect.width),
      this.maxDimension / Math.max(1, rect.height),
    );
    this.width = Math.max(1, Math.round(rect.width * scale));
    this.height = Math.max(1, Math.round(rect.height * scale));
    if (this.canvas.width !== this.width) this.canvas.width = this.width;
    if (this.canvas.height !== this.height) this.canvas.height = this.height;
    const elapsed =
      this.previousTime === undefined
        ? 0
        : Math.min(250, Math.max(0, timestamp - this.previousTime));
    this.previousTime = timestamp;
    await this.presentFrame(BigInt(Math.round(elapsed * 1000000)));
    if (this.solarMode && (await this.updateSolarSamples())) {
      // The core advanced the clock during the first presentation; redraw with
      // transfers for the new instant without advancing time again.
      await this.presentFrame(0n);
    }
    this.frames++;
    if (
      !this.disposed &&
      (this.frames === 1 || timestamp - this.lastNotify > 120)
    ) {
      this.lastNotify = timestamp;
      this.notify(this.summary("运行中"));
    }
  }
  private async presentFrame(elapsedNanos: bigint): Promise<void> {
    if (!this.engine || !this.state) return;
    const id = `web:frame:${++this.request}`;
    const request = create(HostFrameEnvelopeSchema, {
      context: {
        requestId: id,
        sessionId,
        protocolVersion: { major: 1, minor: 0, schemaId: "spaceeyes.core.v1" },
        timeGeneration: this.state.clock!.generation,
        expectedSceneRevision: this.state.sceneRevision,
      },
      frame: {
        reference: { value: "demo:root" },
        camera: { value: "demo:camera" },
        width: this.width,
        height: this.height,
        elapsedNanos,
      },
    });
    const response = fromBinary(
      ResponseEnvelopeSchema,
      await this.engine.present(
        principal,
        toBinary(HostFrameEnvelopeSchema, request),
      ),
    );
    if (
      response.requestId !== id ||
      response.status !== ResponseStatus.COMPLETED ||
      response.payload.case !== "presented"
    )
      throw new Error(
        response.payload.case === "error"
          ? response.payload.value.message
          : "画布呈现失败",
      );
    this.state = response.payload.value.session;
    this.presentedSequence = response.frameSequence;
  }
  private async updateSolarSamples(): Promise<boolean> {
    const state = this.state;
    const clock = state?.clock;
    if (!this.solarLoader || !this.client || !state || !clock) return false;
    const instant = clock.instant;
    if (!instant) return false;
    const key = `${instant.seconds}:${instant.nanos}`;
    if (key === this.solarInstant) return false;
    const timeEt = solarSeconds(instant);
    if (
      this.solarTimeEt !== undefined &&
      Math.abs(timeEt - this.solarTimeEt) < 1
    )
      return false;
    let revision = state.frameGraphRevision;
    let changed = false;
    for (const body of SOLAR_BODIES) {
      try {
        const loaded = await this.solarLoader.load(body.path, timeEt);
        const ephemeris = solarState(loaded, timeEt);
        if (ephemeris === null) continue;
        this.solarStates.set(body.id, ephemeris);
        const position = displayPosition(ephemeris.position);
        const response = await this.client.command(
          {
            case: "spatial",
            value: {
              expectedRevision: revision,
              action: {
                case: "updateProviderFrameSample",
                value: {
                  frameId: { value: body.frame },
                  instant,
                  toParent: {
                    translationM: position,
                    rotation: { w: 1, x: 0, y: 0, z: 0 },
                  },
                },
              },
            },
          },
          {
            requestId: `web:solar:${++this.solarIndex}`,
            expectedSceneRevision: state.sceneRevision,
            timeGeneration: clock.generation,
          },
        );
        if (response.payload.case !== "spatial")
          throw new Error("缺少参考系修订");
        revision = response.payload.value.frameGraphRevision;
        changed = true;
      } catch (error) {
        // Keep the last valid sample; never invent a scientific position.
        this.actionError =
          error instanceof Error ? error.message : String(error);
      }
    }
    this.solarInstant = key;
    this.solarTimeEt = timeEt;
    return changed;
  }
  async exportProject(): Promise<Uint8Array> {
    return this.enqueue(async () => {
      const response = await this.client!.query(
        { case: "projectExport", value: {} },
        { requestId: `web:project:${++this.request}` },
      );
      if (response.payload.case !== "project") throw new Error("缺少项目快照");
      return toBinary(ProjectSnapshotSchema, response.payload.value);
    });
  }
  async togglePlayback(): Promise<void> {
    return this.enqueue(async () => {
      await this.command({
        case: "time",
        value: {
          action:
            this.state?.clock?.mode === PlaybackMode.PLAYING
              ? { case: "pause", value: {} }
              : { case: "play", value: {} },
        },
      });
      await this.refresh();
      this.notify(this.summary("运行中"));
    }).catch((error) => {
      this.fail(error);
      throw error;
    });
  }
  async turnCamera(): Promise<void> {
    return this.enqueue(async () => {
      const yaw = this.yaw + 15;
      await this.command({
        case: "scene",
        value: {
          action: {
            case: "setCamera",
            value: {
              objectId: { value: "demo:camera" },
              camera: this.camera(yaw),
            },
          },
        },
      });
      this.yaw = yaw;
      this.selected = undefined;
      this.selectionText = "视角已更新，请选择对象";
      await this.refresh();
    }).catch((error) => {
      this.fail(error);
      throw error;
    });
  }
  private performAction(
    label: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    return this.enqueue(async () => {
      this.actionError = undefined;
      try {
        await operation();
      } catch (error) {
        if (
          !(error instanceof CoreRemoteError) &&
          !(error instanceof RangeError)
        )
          throw error;
        this.actionError = `${label}操作未完成：${error.message}`;
      }
      await this.refresh();
      if (!this.disposed) this.notify(this.summary("运行中"));
    }).catch((error) => {
      this.fail(error);
      throw error;
    });
  }
  focusSelected(follow: boolean): Promise<void> {
    return this.performAction("相机", async () => {
      if (!this.selected) return;
      await this.refresh();
      if (this.selectionRevision !== this.state!.sceneRevision) {
        this.selected = undefined;
        this.selectionText = "场景已变化，请重新选择";
        return;
      }
      await this.command({
        case: "camera",
        value: {
          action: {
            case: "focus",
            value: {
              camera: { value: "demo:camera" },
              target: { value: this.selected.id },
              distanceM: 6,
              follow,
            },
          },
        },
      });
      this.selected = undefined;
      this.selectionRevision = undefined;
      this.selectionText = "视角已更新，请选择对象";
    });
  }
  resetCamera(): Promise<void> {
    return this.performAction("相机", async () => {
      await this.command({
        case: "scene",
        value: {
          action: {
            case: "setCamera",
            value: {
              objectId: { value: "demo:camera" },
              camera: this.camera(0),
            },
          },
        },
      });
      this.yaw = 0;
      this.selected = undefined;
      this.selectionRevision = undefined;
      this.selectionText = "视角已恢复，请选择对象";
    });
  }
  setPlaybackRate(rate: number): Promise<void> {
    return this.performAction("时间", async () => {
      if (!Number.isFinite(rate)) throw new RangeError("无效播放倍速。");
      await this.command({
        case: "time",
        value: { action: { case: "setRate", value: { rate } } },
      });
    });
  }
  private async requirePaused(): Promise<void> {
    await this.refresh();
    if (this.state?.clock?.mode !== PlaybackMode.PAUSED)
      throw new RangeError("请先暂停，再步进或跳转时间。");
  }
  private clearTimeSelection(): void {
    this.selected = undefined;
    this.selectionRevision = undefined;
    this.selectionText = "时间已更新，请选择对象";
  }
  stepSecond(direction: -1 | 1): Promise<void> {
    return this.performAction("时间", async () => {
      await this.requirePaused();
      await this.command({
        case: "time",
        value: {
          action: {
            case: "step",
            value: { deltaNanos: BigInt(direction) * 1000000000n },
          },
        },
      });
      this.clearTimeSelection();
    });
  }
  seekSeconds(text: string): Promise<void> {
    return this.performAction("时间", async () => {
      const parsed = parseSimulationSeconds(text);
      await this.requirePaused();
      const current = this.state!.clock!.instant!;
      await this.command({
        case: "time",
        value: {
          action: {
            case: "seek",
            value: {
              instant: {
                timeScale: current.timeScale,
                epochId: current.epochId,
                ...parsed,
              },
            },
          },
        },
      });
      this.clearTimeSelection();
    });
  }
  private fail(error: unknown): void {
    if (this.disposed) return;
    const message = String(error instanceof Error ? error.message : error);
    this.notify({ ...this.summary("错误"), error: message });
    void this.dispose()
      .then((summary) =>
        this.notify({ ...summary, phase: "错误", error: message }),
      )
      .catch(() => {});
  }

  dispose(): Promise<ViewStatus> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.canvas.removeEventListener("click", this.onClick);
    this.selected = undefined;
    this.presentedSequence = undefined;
    this.selectionText = "画布已卸载";
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.disposal = (async () => {
      await this.tail;
      try {
        if (this.client?.supports("lifecycle.stop")) {
          const response = await this.client.command(
            {
              case: "lifecycle",
              value: { action: { case: "stop", value: {} } },
            },
            { requestId: `web:stop:${++this.request}` },
          );
          if (response.payload.case === "session")
            this.state = response.payload.value;
        }
      } finally {
        this.engine?.free();
        this.engine = undefined;
      }
      return this.summary("已停止");
    })();
    return this.disposal;
  }
}
