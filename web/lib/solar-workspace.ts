import { PluginHost, type PluginContext } from "../../platform/plugin-host.ts";
import {
  WasmCorePort,
  type WasmCoreBinding,
} from "../../platform/wasm-core-port.ts";
import { SolarSystemData, solarCatalog } from "../../platform/solar-system.ts";
import planetAssets from "../../validation/solar-assets.json" with { type: "json" };

export interface HostCore extends WasmCoreBinding {
  start_renderer(canvas: string): void;
  stop_renderer(): void;
  free(): void;
  tick(elapsed: number): void;
  epoch(): number;
  playing(): boolean;
  state_at(id: string, epoch: number): string;
  utc_to_tdb(unix: number): number;
  tdb_to_utc(epoch: number): number;
  register_asset(id: string, path: string, kind: string): void;
}
export type SolarSnapshot = {
  active: boolean;
  busy: boolean;
  phase: string;
  error: string;
  epoch: number;
  playing: boolean;
  rate: number;
  selected: string;
  view: string;
  labels: boolean;
  trajectories: boolean;
  source: string;
  coverage: string;
  dataStatus: string;
  utc: string;
};
export const initialSnapshot: SolarSnapshot = {
  active: false,
  busy: false,
  phase: "准备探索太阳系",
  error: "",
  epoch: 0,
  playing: false,
  rate: 1,
  selected: "",
  view: "orbit",
  labels: true,
  trajectories: true,
  source: "NASA Eyes DYN · 按需获取",
  coverage: "由实际数据确定",
  dataStatus: "尚未加载",
  utc: "",
};
export const workspaceCatalog = solarCatalog.map((body) => ({
  ...body,
  parentId: body.parentId ?? undefined,
}));
export interface WorkspaceRuntime {
  select(id: string): Promise<void>;
  focus(): void;
  follow(): void;
  overview(): void;
  view(mode: "orbit" | "top" | "front" | "side"): void;
  play(playing: boolean, rate: number): void;
  seek(epoch: number): Promise<void>;
  seekUtc(value: string): Promise<void>;
  now(): Promise<void>;
  layers(labels: boolean, trajectories: boolean): void;
  dispose(): Promise<void>;
}
export async function createWorkspace(
  canvas: string,
  update: (state: SolarSnapshot) => void,
  signal: AbortSignal,
  options: {
    loadCore?: () => Promise<{
      default(): Promise<unknown>;
      WasmCore: new () => HostCore;
    }>;
    fetch?: typeof fetch;
    requestFrame?: typeof requestAnimationFrame;
    cancelFrame?: typeof cancelAnimationFrame;
  } = {},
): Promise<WorkspaceRuntime> {
  const url = "/wasm/spaceeyes_core.js";
  const module = (
    options.loadCore
      ? await options.loadCore()
      : await import(/* webpackIgnore: true */ url)
  ) as {
    default(): Promise<unknown>;
    WasmCore: new () => HostCore;
  };
  await module.default();
  signal.throwIfAborted();
  const requestFrame =
    options.requestFrame ?? globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame =
    options.cancelFrame ?? globalThis.cancelAnimationFrame.bind(globalThis);
  const core = new module.WasmCore(),
    host = new PluginHost(new WasmCorePort(core));
  const surfaceAssets = new Map<
    string,
    [string, string, string, string, string, string]
  >();
  for (const [id, asset] of Object.entries(planetAssets.bodies)) {
    if (asset.faces.length !== 6) continue;
    const ids: string[] = [];
    for (const face of asset.faces) {
      const assetId = `planet:${id}:face:${face.face}`;
      core.register_asset(
        assetId,
        face.path.replace(/^assets\//, ""),
        "texture",
      );
      ids[face.face] = assetId;
    }
    surfaceAssets.set(
      id,
      ids as [string, string, string, string, string, string],
    );
  }
  for (const ring of planetAssets.rings) {
    core.register_asset(
      `planet:saturn:ring:${ring.name}`,
      ring.path.replace(/^assets\//, ""),
      "texture",
    );
  }
  let sdk!: PluginContext, data!: SolarSystemData;
  let frame = 0,
    closed = false,
    revision = 0,
    lastFrame: number | undefined,
    lastEmit = 0;
  let queue: Promise<void> = Promise.resolve(),
    disposal: Promise<void> | undefined;
  let desiredPlaying = false;
  let lastPublishedEpoch = core.epoch();
  const state = { ...initialSnapshot, busy: true, phase: "加载真实太阳系数据" };
  const emit = () => {
    if (closed) return;
    state.epoch = core.epoch();
    state.playing = core.playing();
    state.utc = new Date(core.tdb_to_utc(state.epoch) * 1000).toISOString();
    if (state.selected && data) {
      const status = data.status(state.selected);
      state.dataStatus =
        (status?.status ?? "未加载") +
        (status?.error ? ` · ${status.error}` : "");
      state.coverage = status?.coverage
        ? status.coverage.join(" — ")
        : "无可用覆盖";
      try {
        JSON.parse(core.state_at(state.selected, state.epoch));
        const provenance = data.provenance(state.selected).at(-1);
        state.source =
          state.selected === "sun"
            ? "本场景日心坐标原点"
            : `NASA Eyes DYN · 近似星历（精度未验收）${provenance ? ` · SHA256 ${provenance.sha256.slice(0, 12)} · 获取 ${provenance.fetchedAt}` : ""}`;
        const visual = sdk.visual.status(state.selected);
        state.dataStatus += ` · 显示资源 ${visual?.phase ?? "pending"}`;
        if (visual?.phase === "failed")
          state.dataStatus += ` · 表面资源失败：${visual.detail}`;
      } catch {
        state.source =
          solarCatalog.find((body) => body.id === state.selected)?.source ??
          "无数据";
      }
    }
    if (!state.selected && data) {
      const loaded = data.status().filter((item) => item.status === "ready");
      const shown = loaded.filter((item) => {
        try {
          return sdk.visual.status(item.id)?.phase === "ready";
        } catch {
          return false;
        }
      }).length;
      state.dataStatus = `${loaded.length}/${solarCatalog.length} 个对象数据可用 · ${shown} 个显示资源就绪`;
      state.source = "NASA Eyes 动态数据与固定表面资源 · 近似星历精度未验收";
      state.coverage = "选择对象查看其真实有效范围";
    }
    update({ ...state });
  };
  const dispose = () =>
    (disposal ??= (async () => {
      closed = true;
      revision++;
      cancelFrame(frame);
      signal.removeEventListener("abort", abort);
      try {
        await host.shutdown();
      } finally {
        core.stop_renderer();
        core.free();
        update({
          ...state,
          active: false,
          busy: false,
          playing: false,
          phase: "工作区已释放，请刷新重新进入",
        });
      }
    })());
  const abort = () => {
    void dispose();
  };
  signal.addEventListener("abort", abort, { once: true });
  const assertLive = () => {
    if (closed || signal.aborted) throw new Error("工作区已关闭");
  };
  const configure = () => {
    for (const body of solarCatalog) {
      if (data.status(body.id)?.status !== "ready") continue;
      try {
        if (!sdk.visual.status(body.id)) {
          sdk.visual.set(body.id, {
            kind: "sphere",
            colorRgba: surfaceAssets.has(body.id) ? [1, 1, 1, 1] : body.color,
            ...(surfaceAssets.has(body.id)
              ? { faceAssets: surfaceAssets.get(body.id)! }
              : {}),
            ...(body.id === "saturn"
              ? {
                  ringAssets: [
                    "planet:saturn:ring:top",
                    "planet:saturn:ring:bottom",
                  ] as [string, string],
                  ringInnerRadiusRatio:
                    planetAssets.ringGeometry.saturn.innerRadiusKm /
                    body.radiusKm,
                  ringOuterRadiusRatio:
                    planetAssets.ringGeometry.saturn.outerRadiusKm /
                    body.radiusKm,
                }
              : {}),
            ...(body.id === "sun"
              ? {
                  emissiveRgba: [1, 0.75, 0.25, 1] as [
                    number,
                    number,
                    number,
                    number,
                  ],
                }
              : {}),
          });
          sdk.visual.label(body.id, body.id.toUpperCase());
        }
        if (state.trajectories && body.parentId) {
          const [start, end] = data.trajectoryRange(body.id, core.epoch());
          sdk.visual.trajectory(
            body.id,
            data.trajectory(body.id, start, end, 128),
          );
        }
      } catch (error) {
        state.error = `${body.name}：${String(error)}`;
      }
    }
    sdk.visual.layers({
      labels: state.labels,
      trajectories: state.trajectories,
    });
  };
  const reload = (epoch: number) => {
    if (closed || signal.aborted)
      return Promise.reject(new Error("工作区已关闭"));
    if (!Number.isFinite(epoch) || Math.abs(epoch) > 1e12)
      return Promise.reject(new Error("请输入有限的 J2000 TDB 秒"));
    const current = ++revision;
    state.busy = true;
    state.phase = "按对象和时间加载数据";
    emit();
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (closed || current !== revision) return;
        const resume = desiredPlaying;
        const restore = data.checkpoint();
        sdk.time.setPlayback(false, state.rate);
        try {
          await data.load(undefined, epoch);
          assertLive();
          if (current !== revision) { restore(); return; }
          if (
            state.active &&
            !data
              .status()
              .some((item) => item.id !== "sun" && item.status === "ready")
          ) {
            restore();
            sdk.time.seek(lastPublishedEpoch);
            data.publishAt(lastPublishedEpoch);
            configure();
            state.phase = "所选时间无可用数据，已保留原场景并暂停";
            desiredPlaying = false;
            throw new Error("所选时间没有可用星历覆盖");
          }
          sdk.time.seek(epoch);
          data.publishAt(epoch);
          const valid = data.status().some((item) => {
            if (item.id === "sun" || item.status !== "ready") return false;
            try { core.state_at(item.id, epoch); return true; } catch { return false; }
          });
          if (state.active && !valid) {
            restore();
            sdk.time.seek(lastPublishedEpoch);
            data.publishAt(lastPublishedEpoch);
            configure();
            desiredPlaying = false;
            throw new Error("所选时间没有可用星历覆盖");
          }
          lastPublishedEpoch = core.epoch();
          configure();
          const selectedUnavailable = state.selected && data.status(state.selected)?.status !== "ready";
          if (selectedUnavailable) {
            sdk.camera.view("overview");
            state.view = "orbit";
            desiredPlaying = false;
          }
          sdk.time.setPlayback(selectedUnavailable ? false : resume, state.rate);
          const available = data
            .status()
            .filter((item) => item.status === "ready").length;
          const unavailable = data
            .status()
            .filter((item) => item.status !== "ready")
            .map(
              (item) =>
                solarCatalog.find((body) => body.id === item.id)?.name ??
                item.id,
            );
          state.phase = `太阳系场景：${available}/${solarCatalog.length} 个对象可用`;
          if (selectedUnavailable) state.phase = "所选对象数据不可用，已返回太阳系总览并暂停";
          if (unavailable.length)
            state.error = `部分源数据暂不可用：${unavailable.join("、")}。选择对象查看具体原因。`;
        } finally {
          if (!closed && current === revision) {
            state.busy = false;
            lastFrame = undefined;
            emit();
          }
        }
      });
    return queue;
  };
  const runtime: WorkspaceRuntime = {
    async select(id) {
      assertLive();
      if (!solarCatalog.some((body) => body.id === id))
        throw new Error("未知对象");
      state.selected = id;
      await reload(core.epoch());
      assertLive();
      if (state.selected !== id) return;
      if (data.status(id)?.status !== "ready") {
        sdk.camera.view("overview");
        state.view = "orbit";
        state.phase = "所选对象数据不可用，已返回太阳系总览";
        state.error = data.status(id)?.error ?? "对象数据不可用";
        emit();
        throw new Error(state.error);
      }
      sdk.camera.focus(id);
      sdk.camera.view("orbit");
      state.view = "orbit";
      emit();
    },
    focus() {
      assertLive();
      if (!state.selected) throw new Error("请先选择对象");
      sdk.camera.focus(state.selected);
      emit();
    },
    follow() {
      assertLive();
      if (!state.selected) throw new Error("请先选择对象");
      sdk.camera.focus(state.selected);
      sdk.camera.view("orbit");
      state.view = "orbit";
      state.phase = "跟随选中对象";
      emit();
    },
    overview() {
      assertLive();
      state.selected = "";
      sdk.camera.view("overview");
      state.view = "orbit";
      state.phase = "太阳系总览";
      emit();
    },
    view(mode) {
      assertLive();
      sdk.camera.view(mode);
      state.view = mode;
      emit();
    },
    play(playing, rate) {
      assertLive();
      if (state.busy) throw new Error("数据加载中，请稍后调整播放");
      sdk.time.setPlayback(playing, rate);
      desiredPlaying = playing;
      state.rate = rate;
      lastFrame = undefined;
      emit();
    },
    seek: reload,
    seekUtc(value) {
      assertLive();
      const unix = Date.parse(value.endsWith("Z") ? value : value + "Z") / 1000;
      if (!Number.isFinite(unix)) throw new Error("请输入有效 UTC 日期");
      return reload(core.utc_to_tdb(unix));
    },
    now() {
      assertLive();
      return reload(core.utc_to_tdb(Date.now() / 1000));
    },
    layers(labels, trajectories) {
      assertLive();
      state.labels = labels;
      state.trajectories = trajectories;
      configure();
      emit();
    },
    dispose,
  };
  try {
    host.register(
      {
        id: "spaceeyes.solar-system",
        apiVersion: 1,
        capabilities: [
          "data.publish",
          "camera.control",
          "time.control",
          "scene.visual",
        ],
      },
      (context) => {
        sdk = context;
        data = new SolarSystemData(
          context,
          options.fetch ? { fetch: options.fetch } : {},
        );
      },
    );
    await host.enable("spaceeyes.solar-system", [
      "data.publish",
      "camera.control",
      "time.control",
      "scene.visual",
    ]);
    assertLive();
    await reload(core.utc_to_tdb(Date.now() / 1000));
    assertLive();
    sdk.camera.view("overview");
    core.start_renderer(canvas);
    state.active = true;
    emit();
    const tick = (now: number) => {
      if (closed) return;
      try {
        if (!state.busy) {
          core.tick(lastFrame === undefined ? 0 : (now - lastFrame) / 1000);
          const epoch = core.epoch();
          const missing = data
            .status()
            .some(
              (item) =>
                item.id !== "sun" &&
                item.coverage &&
                item.status !== "failed" &&
                (epoch < item.coverage[0] || epoch > item.coverage[1]),
            );
          if (missing) {
            sdk.time.seek(lastPublishedEpoch);
            void reload(epoch).catch((error) => {
              state.error = String(error);
              emit();
            });
          } else {
            data.publishAt(epoch);
            lastPublishedEpoch = core.epoch();
          }
        }
        lastFrame = now;
        if (now - lastEmit > 100) {
          emit();
          lastEmit = now;
        }
      } catch (error) {
        state.error = String(error);
        sdk.time.setPlayback(false, state.rate);
        desiredPlaying = false;
        emit();
      }
      frame = requestFrame(tick);
    };
    frame = requestFrame(tick);
    return runtime;
  } catch (error) {
    await dispose();
    throw error;
  }
}
