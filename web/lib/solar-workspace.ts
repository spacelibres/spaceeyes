import { PluginHost, type PluginContext } from "../../platform/plugin-host.ts";
import {
  WasmCorePort,
  type WasmCoreBinding,
} from "../../platform/wasm-core-port.ts";
import {
  SolarSystemData,
  solarCatalog,
  baseSolarIds,
} from "../../platform/solar-system.ts";
import {
  eyesCatalog,
  getEyesDefinition,
  parentAt,
} from "../../platform/eyes-catalog.ts";
import planetAssets from "../../validation/solar-assets.json" with { type: "json" };
import observationTimes from "../../platform/eyes-observation-times.json" with { type: "json" };
import {
  StarfieldSource,
  type StarfieldProgress,
} from "../../platform/starfield-source.ts";

export interface HostCore extends WasmCoreBinding {
  pick_object(u: number, v: number): string | undefined;
  start_renderer(canvas: string): void;
  stop_renderer(): void;
  free(): void;
  tick(elapsed: number): void;
  epoch(): number;
  focused_object(): string | undefined;
  playing(): boolean;
  state_at(id: string, epoch: number): string;
  utc_to_tdb(unix: number): number;
  tdb_to_utc(epoch: number): number;
  register_asset(id: string, path: string, kind: string): void;
}
export type SolarSnapshot = {
  galaxy: { enabled: boolean; phase: string; detail?: string };
  starfield: StarfieldProgress;
  startupMs?: number;
  parentId?: string;
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
  galaxy: { enabled: false, phase: "disabled" },
  starfield: {
    enabled: false,
    loading: false,
    readyLayers: 0,
    totalLayers: 7,
    pointCount: 0,
    error: "",
  },
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
const visibleCatalogIds = new Set([
  ...baseSolarIds,
  ...eyesCatalog.map((body) => body.id),
]);
export const workspaceCatalog = solarCatalog
  .filter((body) => visibleCatalogIds.has(body.id))
  .map((body) => ({
    ...body,
    parentId: body.parentId ?? undefined,
  }));
export interface WorkspaceRuntime {
  galaxy(enabled: boolean): void;
  starfield(enabled: boolean): Promise<void>;
  retryStarfield(): Promise<void>;
  observeAvailable(): Promise<void>;
  pick(u: number, v: number): Promise<boolean>;
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
    onStartup?: (phase: string) => void;
    backgroundStars?: boolean;
    backgroundGalaxy?: boolean;
    loadCore?: () => Promise<{
      default(): Promise<unknown>;
      WasmCore: new () => HostCore;
    }>;
    fetch?: typeof fetch;
    requestFrame?: typeof requestAnimationFrame;
    cancelFrame?: typeof cancelAnimationFrame;
  } = {},
): Promise<WorkspaceRuntime> {
  const startupAt = performance.now();
  signal.throwIfAborted();
  options.onStartup?.("加载三维核心模块");
  const url = "/wasm/spaceeyes_core.js";
  const module = (
    options.loadCore
      ? await options.loadCore()
      : await import(/* webpackIgnore: true */ url)
  ) as {
    default(): Promise<unknown>;
    WasmCore: new () => HostCore;
  };
  signal.throwIfAborted();
  options.onStartup?.("下载并初始化 WASM");
  await module.default();
  signal.throwIfAborted();
  const requestFrame =
    options.requestFrame ?? globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame =
    options.cancelFrame ?? globalThis.cancelAnimationFrame.bind(globalThis);
  const core = new module.WasmCore(),
    host = new PluginHost(new WasmCorePort(core));
  core.register_asset(
    "environment:milkyway:4k",
    "deep-space/milkyway.webp",
    "texture",
  );
  core.register_asset("environment:milkyway:preview", "deep-space/milkyway-preview.webp", "texture");
  let galaxyPreview = false;
  for (const body of eyesCatalog) {
    const definition = getEyesDefinition(body.id);
    if (definition?.model)
      core.register_asset(
        `eyes:${body.id}:model`,
        `eyes/${body.id}/model.glb`,
        "model",
      );
  }
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
  for (const body of eyesCatalog) {
    if (
      surfaceAssets.has(body.id) ||
      !getEyesDefinition(body.id)?.spheroidLOD?.textures?.color
    )
      continue;
    const ids = Array.from({ length: 6 }, (_, face) => {
      const id = `eyes:${body.id}:face:${face}`;
      core.register_asset(id, `eyes/${body.id}/face-${face}.png`, "texture");
      return id;
    });
    surfaceAssets.set(
      body.id,
      ids as [string, string, string, string, string, string],
    );
  }
  let sdk!: PluginContext, data!: SolarSystemData;
  let galaxySdk!: PluginContext;
  let stars!: StarfieldSource;
  let frame = 0,
    closed = false,
    revision = 0,
    lastFrame: number | undefined,
    lastEmit = 0;
  let queue: Promise<void> = Promise.resolve(),
    disposal: Promise<void> | undefined;
  let desiredPlaying = false;
  let lastPublishedEpoch = core.epoch();
  let lastTrajectoryRefresh = 0;
  const state: SolarSnapshot = {
    ...initialSnapshot,
    busy: true,
    phase: "加载真实太阳系数据",
  };
  const emit = () => {
    if (closed) return;
    if (state.galaxy.enabled && core.environment_status) {
      const status = JSON.parse(core.environment_status());
      if (galaxyPreview && status.phase === "ready") {
        galaxyPreview = false;
        galaxySdk.visual.environment({assetId: "environment:milkyway:4k", frame: "ICRF", intensity: 1});
      }
      if (status && ["pending", "ready", "failed"].includes(status.phase))
        state.galaxy = {
          enabled: true,
          phase: status.phase,
          ...(status.detail
            ? { detail: String(status.detail).slice(0, 240) }
            : {}),
        };
    }
    state.epoch = core.epoch();
    state.playing = core.playing();
    state.utc = new Date(core.tdb_to_utc(state.epoch) * 1000).toISOString();
    if (state.selected && data) {
      state.parentId = data.parentAt(state.selected, state.epoch) ?? undefined;
      const status = data.status(state.selected);
      state.dataStatus =
        (status?.status ?? "未加载") +
        (status?.error ? ` · ${status.error}` : "");
      state.coverage = status?.coverage
        ? status.coverage.join(" — ")
        : "无可用覆盖";
      try {
        JSON.parse(core.state_at(state.selected, state.epoch));
        const provenance = data
          .provenance(state.selected)
          .findLast((entry) => !entry.url.includes("&type=ori"));
        state.source =
          state.selected === "sun"
            ? "本场景日心坐标原点"
            : `NASA Eyes DYN · 近似星历（精度未验收）${provenance ? ` · SHA256 ${provenance.sha256.slice(0, 12)} · 获取 ${provenance.fetchedAt}${provenance.selection ? " · 已隔离源文件异常，使用核验有效区段" : ""}` : ""}`;
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
      state.dataStatus = `${loaded.length}/${solarCatalog.length} 个对象数据可用 · ${shown} 个显示表示就绪 · 高清表面仅选择时加载`;
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
          galaxy: { enabled: false, phase: "disabled" },
          starfield: {
            ...state.starfield,
            enabled: false,
            loading: false,
            readyLayers: 0,
            pointCount: 0,
            error: "",
          },
          phase: "工作区已释放，可重新进入",
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
  const detailedBodies = new Set<string>();
  const trajectoryWindows = new Map<string, [number, number]>();
  const sceneIds = (epoch: number) => {
    const ids = new Set(baseSolarIds);
    if (state.selected) {
      let id: string | null = state.selected;
      const visited = new Set<string>();
      while (id && !visited.has(id)) {
        visited.add(id);
        ids.add(id);
        if (id === "sun") break;
        id = parentAt(id, epoch);
      }
      const system =
        solarCatalog.find((body) => body.id === state.selected)?.kind ===
        "planet"
          ? state.selected
          : parentAt(state.selected, epoch);
      for (const body of eyesCatalog
        .filter(
          (body) =>
            body.kind === "moon" &&
            body.subcategory === "Major Moon" &&
            parentAt(body.id, epoch) === system,
        )
        .slice(0, 24))
        ids.add(body.id);
    }
    return [...ids];
  };
  const refreshTrajectory = (id: string) => {
    const count = data.status().filter((s) => s.status === "ready").length;
    const ordinary = state.selected
      ? Math.min(128, Math.max(8, Math.floor(2048 / Math.max(1, count - 1))))
      : 256;
    const trail = data.trajectorySamples(
      id,
      core.epoch(),
      state.selected === id ? 2048 : ordinary,
      state.selected === id,
      "instantaneous",
    );
    sdk.visual.trajectory(id, trail.points, trail.epochsTdbSeconds, {
      originId: trail.originId,
      colorRgba: solarCatalog.find((body) => body.id === id)!.color,
    });
    trajectoryWindows.set(id, trail.refreshRange);
  };
  const configure = () => {
    for (const id of trajectoryWindows.keys())
      if (data.status(id)?.status !== "ready") trajectoryWindows.delete(id);
    // Shrink the previous target's trail before growing the new one; retain the session budget.
    for (const body of [...solarCatalog].sort(
      (a, b) =>
        Number(a.id === state.selected) - Number(b.id === state.selected),
    )) {
      if (data.status(body.id)?.status !== "ready") continue;
      try {
        const upgrade =
          state.selected === body.id && !detailedBodies.has(body.id);
        const detailed = detailedBodies.has(body.id) || upgrade;
        if (!sdk.visual.status(body.id) || upgrade) {
          const model = getEyesDefinition(body.id)?.model;
          if (detailed && model) {
            sdk.visual.set(body.id, {
              kind: "model",
              assetId: `eyes:${body.id}:model`,
              scaleKmPerUnit: 1,
              scene: 0,
            });
          } else
            sdk.visual.set(body.id, {
              kind: "sphere",
              colorRgba:
                detailed && surfaceAssets.has(body.id)
                  ? [1, 1, 1, 1]
                  : body.color,
              ...(detailed && surfaceAssets.has(body.id)
                ? { faceAssets: surfaceAssets.get(body.id)! }
                : {}),
              ...(detailed && body.id === "saturn"
                ? {
                    ringAssets: [
                      "planet:saturn:ring:top",
                      "planet:saturn:ring:top",
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
                    stellar: { coronaIntensity: 1, flowSpeed: 0.15 },
                  }
                : {}),
            });
          if (upgrade) detailedBodies.add(body.id);
          sdk.visual.label(
            body.id,
            (getEyesDefinition(body.id)?.label ?? body.id).toUpperCase(),
          );
        }
        if (
          state.trajectories &&
          body.id !== "sun" &&
          data.parentAt(body.id, core.epoch()) &&
          (baseSolarIds.includes(body.id) ||
            (getEyesDefinition(body.id)?.controllers ?? []).some(
              (c) => c.type === "dynamo" || c.type === "orbitalElements",
            ))
        ) {
          refreshTrajectory(body.id);
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
          const ids = sceneIds(epoch);
          data.retain(ids);
          await data.load(
            ids,
            epoch,
            [...detailedBodies, state.selected].filter(Boolean),
          );
          assertLive();
          if (current !== revision) {
            restore();
            return;
          }
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
            try {
              core.state_at(item.id, epoch);
              return true;
            } catch {
              return false;
            }
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
          const selectedUnavailable =
            state.selected && data.status(state.selected)?.status !== "ready";
          if (selectedUnavailable) {
            sdk.camera.view("overview");
            state.view = "orbit";
            desiredPlaying = false;
          }
          sdk.time.setPlayback(
            selectedUnavailable ? false : resume,
            state.rate,
          );
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
          state.phase = `当前场景：${available}/${data.status().length} 个对象可用 · 目录 ${workspaceCatalog.length} 项`;
          if (selectedUnavailable)
            state.phase = "所选对象数据不可用，已返回太阳系总览并暂停";
          state.error = unavailable.length
            ? `部分源数据暂不可用：${unavailable.join("、")}。选择对象查看具体原因。`
            : "";
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
    galaxy(enabled) {
      assertLive();
      galaxyPreview = enabled;
      galaxySdk.visual.environment(null);
      if (enabled)
        galaxySdk.visual.environment({
          assetId: "environment:milkyway:preview",
          frame: "ICRF",
          intensity: 1,
        });
      state.galaxy = { enabled, phase: enabled ? "pending" : "disabled" };
      emit();
    },
    starfield(enabled) {
      assertLive();
      return stars.enable(enabled);
    },
    retryStarfield() {
      assertLive();
      return stars.retry();
    },
    async observeAvailable() {
      assertLive();
      const id = state.selected;
      if (!id) throw Error("请先选择任务");
      const epoch = (observationTimes.epochs as Record<string, number>)[id];
      if (epoch === undefined) throw Error("该对象没有已核验的有效观测时间");
      const pending = reload(epoch),
        ownedRevision = revision;
      await pending;
      assertLive();
      if (state.selected !== id || revision !== ownedRevision) return;
      if (data.status(id)?.status === "ready") sdk.camera.focus(id);
      emit();
    },
    async pick(u, v) {
      assertLive();
      const id = core.pick_object(u, v);
      if (!id) return false;
      await runtime.select(id);
      return !closed && state.selected === id;
    },
    async select(id) {
      assertLive();
      if (!solarCatalog.some((body) => body.id === id))
        throw new Error("未知对象");
      state.selected = id;
      const pending = reload(core.epoch()),
        ownedRevision = revision;
      await pending;
      assertLive();
      if (state.selected !== id || revision !== ownedRevision) return;
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
      const ownedRevision = ++revision;
      desiredPlaying = false;
      sdk.time.setPlayback(false, state.rate);
      state.selected = "";
      data.retain(baseSolarIds);
      configure();
      sdk.camera.view("overview");
      state.view = "orbit";
      state.phase = "太阳系总览";
      emit();
      if (state.busy)
        void queue
          .finally(() => {
            if (closed || revision !== ownedRevision) return;
            data.retain(baseSolarIds);
            data.publishAt(core.epoch());
            configure();
            state.busy = false;
            state.phase = "太阳系总览";
            emit();
          })
          .catch((error) => {
            if (!closed && revision === ownedRevision) {
              state.busy = false;
              state.error = String(error);
              emit();
            }
          });
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
    host.register(
      {
        id: "spaceeyes.background-stars",
        apiVersion: 1,
        capabilities: ["scene.visual"],
      },
      (context) => {
        stars = new StarfieldSource(
          context,
          (progress) => {
            state.starfield = progress;
            emit();
          },
          options.fetch ? { fetch: options.fetch } : {},
        );
      },
    );
    await host.enable("spaceeyes.background-stars", ["scene.visual"]);
    host.register(
      {
        id: "spaceeyes.background-galaxy",
        apiVersion: 1,
        capabilities: ["scene.visual"],
      },
      (context) => {
        galaxySdk = context;
      },
    );
    await host.enable("spaceeyes.background-galaxy", ["scene.visual"]);
    assertLive();
    options.onStartup?.("加载总览所需轨道数据");
    await reload(core.utc_to_tdb(Date.now() / 1000));
    assertLive();
    sdk.camera.view("overview");
    options.onStartup?.("启动三维渲染器");
    core.start_renderer(canvas);
    state.startupMs = Math.max(0, performance.now() - startupAt);
    state.active = true;
    if (options.backgroundGalaxy !== false) runtime.galaxy(true);
    emit();
    if (options.backgroundStars !== false)
      void stars.enable(true).catch((error) => {
        if (!closed) {
          state.starfield = {
            ...state.starfield,
            loading: false,
            error: String(error),
          };
          emit();
        }
      });
    const tick = (now: number) => {
      if (closed) return;
      try {
        if (!state.busy) {
          core.tick(lastFrame === undefined ? 0 : (now - lastFrame) / 1000);
          if (
            state.selected &&
            data.status(state.selected)?.status === "ready" &&
            core.focused_object() === undefined &&
            !state.busy
          ) {
            state.selected = "";
            data.retain(baseSolarIds);
            configure();
            state.view = "orbit";
            state.phase = "已拉远至太阳系总览";
            emit();
          }
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
            if (state.trajectories && now - lastTrajectoryRefresh > 100) {
              for (const [id, window] of trajectoryWindows) {
                if (epoch < window[0] || epoch > window[1])
                  refreshTrajectory(id);
              }
              lastTrajectoryRefresh = now;
            }
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
