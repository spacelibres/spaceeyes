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
  PlaybackMode,
  ObjectLifecycle,
  TextureColorSpace,
  SamplingFilter,
  SamplingAddress,
  CoreRemoteError,
  ErrorCode,
  type SessionStatus,
  type CommandPayload,
} from "@spaceeyes/core-sdk";
import type { WasmEngine } from "../public/wasm/spaceeyes_wasm.js";
export type ViewStatus = {
  phase: "初始化" | "运行中" | "已停止" | "错误";
  frameCount: number;
  clockNs: string;
  clockText: string;
  playing: boolean;
  resourceBytes: string;
  width: number;
  height: number;
  selectionText: string;
  selected?: { id: string; kind: string; reference: string; sequence: string };
  error?: string;
};
export const initialStatus: ViewStatus = {
  phase: "初始化",
  frameCount: 0,
  clockNs: "0",
  clockText: "0.000000000",
  playing: false,
  resourceBytes: "0",
  width: 0,
  height: 0,
  selectionText: "点击画面选择对象",
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
  ) {
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
    this.engine = new bindings.WasmEngine(
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
    ]);
    if (!capabilities.browserSurface)
      throw new Error("当前核心未提供浏览器画布能力。");
    this.maxDimension = capabilities.limits!.maxCanvasDimension;
    if (this.disposed) return;
    await this.engine.attach_canvas(this.canvas);
    if (this.disposed) return;
    await this.command({
      case: "spatial",
      value: {
        expectedRevision: 0n,
        action: {
          case: "registerRoot",
          value: { frameId: { value: "demo:root" } },
        },
      },
    });
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
    await this.command({
      case: "sceneTransaction",
      value: {
        expectedRevision: this.state!.sceneRevision,
        commands: [
          {
            action: {
              case: "create",
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
              case: "create",
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
              case: "create",
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
        ],
      },
    });
    await this.command({
      case: "lifecycle",
      value: { action: { case: "start", value: {} } },
    });
    await this.refresh();
  }
  private camera(yaw: number) {
    const half = (yaw * Math.PI) / 360;
    return {
      positionM: { x: 0, y: 0, z: 6 },
      orientation: { w: Math.cos(half), x: 0, y: Math.sin(half), z: 0 },
      projection: {
        kind: {
          case: "perspective" as const,
          value: { verticalFovRadians: Math.PI / 3, nearM: 0.1, farM: 100 },
        },
      },
    };
  }
  private async command(payload: CommandPayload): Promise<void> {
    await this.client!.command(payload, {
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
  }
  private summary(phase: ViewStatus["phase"]): ViewStatus {
    const time = this.state?.clock?.instant;
    const seconds = time?.seconds ?? 0n;
    const nanos = time?.nanos ?? 0;
    return {
      phase,
      frameCount: this.frames,
      clockNs: (seconds * 1000000000n + BigInt(nanos)).toString(),
      clockText: `${seconds}.${String(nanos).padStart(9, "0")}`,
      playing: this.state?.clock?.mode === PlaybackMode.PLAYING,
      resourceBytes: (this.state?.resourceUsedBytes ?? 0n).toString(),
      width: this.width,
      height: this.height,
      selectionText: this.selectionText,
      selected: this.selected,
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
        elapsedNanos: BigInt(Math.round(elapsed * 1000000)),
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
    this.frames++;
    if (
      !this.disposed &&
      (this.frames === 1 || timestamp - this.lastNotify > 120)
    ) {
      this.lastNotify = timestamp;
      this.notify(this.summary("运行中"));
    }
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
