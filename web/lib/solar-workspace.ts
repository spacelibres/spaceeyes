import { shouldRefreshTrajectory } from "./trajectory-refresh.ts";
import {
  entityAlignDependencies,
  isEntityAlign,
} from "../../platform/eyes-orientation.ts";
import {
  snapshotEnvironment,
  type EnvironmentSpec,
} from "../../platform/environment-contract.ts";
import {
  parseSceneLink,
  formatSceneLink,
  type SceneLinkState,
} from "./scene-link.ts";
import { activeController } from "../../platform/eyes-controllers.ts";
import { isLive } from "./time-controls.ts";
import { solarWorkspaceSettings } from "./solar-settings.ts";
import { buildStellarTuning } from "../../platform/stellar-tuning.ts";
import { PluginHost, type PluginContext } from "../../platform/plugin-host.ts";
import {
  WasmCorePort,
  type WasmCoreBinding,
} from "../../platform/wasm-core-port.ts";
import {
  SolarSystemData,
  solarCatalog,
  baseSolarIds,
  hasDisplayCatalog,
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
  camera_render_status?(): string;
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
  planetPreparation: { ready: number; total: number; failed: number };
  observationMode: "nearby" | "system" | "follow";
  followId?: string;
  cameraDebug?: Readonly<Record<string, unknown>>;
  dataCache: {
    records: number;
    positionEntries: number;
    orientationEntries: number;
    provenance: number;
    maxRecords: number;
  };
  live: boolean;
  lighting: "natural" | "shadow" | "flood";
  fovDegrees: number;
  galaxy: {
    enabled: boolean;
    phase: string;
    detail?: string;
    desiredLod?: number;
    readyLod?: number;
    currentLod?: number;
    blend?: number;
    loadedTiles?: number;
    gpuBytes?: number;
  };
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
  moons: boolean;
  spacecraft: boolean;
  trails: boolean;
  source: string;
  coverage: string;
  attitude: string;
  articulation?: string;
  dataStatus: string;
  utc: string;
};
export const initialSnapshot: SolarSnapshot = {
  planetPreparation: { ready: 0, total: 8, failed: 0 },
  observationMode: "nearby",
  dataCache: {
    records: 0,
    positionEntries: 0,
    orientationEntries: 0,
    provenance: 0,
    maxRecords: 1000000,
  },
  live: false,
  lighting: "shadow",
  fovDegrees: 45,
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
  moons: true,
  spacecraft: true,
  trails: true,
  source: "NASA Eyes DYN · 按需获取",
  coverage: "由实际数据确定",
  attitude: "未选择对象",
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
  cancelSceneRestore(): void;
  restoreScene(state: SceneLinkState): Promise<void>;
  tuneStellar(settings: Record<string, number>): void;
  lighting(mode: "natural" | "shadow" | "flood"): void;
  fieldOfView(degrees: number): void;
  galaxy(enabled: boolean): void;
  starfield(enabled: boolean): Promise<void>;
  retryStarfield(): Promise<void>;
  observeAvailable(): Promise<void>;
  pick(u: number, v: number): Promise<boolean>;
  select(id: string): Promise<void>;
  focus(): void;
  observation(
    mode: "nearby" | "system" | "follow",
    followId?: string,
  ): Promise<void>;
  orbit(yaw: number, pitch: number): void;
  zoom(delta: number): void;
  follow(referenceId?: string): Promise<void>;
  overview(): void;
  view(mode: "orbit" | "top" | "front" | "side"): void;
  play(playing: boolean, rate: number): void;
  seek(epoch: number): Promise<void>;
  seekUtc(value: string): Promise<void>;
  now(): Promise<void>;
  groups(moons: boolean, spacecraft: boolean): Promise<void>;
  trails(enabled: boolean): void;
  layers(labels: boolean, trajectories: boolean): void;
  dispose(): Promise<void>;
}
export async function createWorkspace(
  canvas: string,
  update: (state: SolarSnapshot) => void,
  signal: AbortSignal,
  options: {
    onStartup?: (phase: string) => void;
    stellarSettings?: Record<string, number>;
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
  let galaxySpec: EnvironmentSpec | undefined;
  let galaxyGeneration = 0;
  let galaxyAbort = new AbortController();
  const loadGalaxy = async () => {
    const requestSignal = AbortSignal.any([signal, galaxyAbort.signal]);
    const response = await (options.fetch ?? fetch)("/api/galaxy-manifest", {
      signal: requestSignal,
    });
    if (!response.ok) throw Error("Galaxy manifest unavailable");
    const manifest = await response.json();
    signal.throwIfAborted();
    requestSignal.throwIfAborted();
    if (
      manifest.schemaVersion !== 1 ||
      manifest.tileSize !== 256 ||
      manifest.border !== 2 ||
      !/^[a-f0-9]{64}$/.test(manifest.source?.sha256) ||
      manifest.source.width !== 8192 ||
      manifest.source.height !== 4096
    )
      throw Error("Invalid galaxy manifest");
    for (const l of manifest.levels)
      for (const t of l.tiles)
        if (
          t.assetId !== `galaxy:l${l.level}:${t.x}:${t.y}` ||
          t.path !== `deep-space/galaxy-l${l.level}-${t.x}-${t.y}.sehdr`
        )
          throw Error("Galaxy tile identity mismatch");
    if (
      manifest.diffuse.assetId !== "galaxy:diffuse" ||
      manifest.specular.assetId !== "galaxy:specular" ||
      manifest.diffuse.path !== "deep-space/galaxy-diffuse.sehdr" ||
      manifest.specular.path !== "deep-space/galaxy-specular.sehdr"
    )
      throw Error("Galaxy IBL identity mismatch");
    const records = [
      ...manifest.levels.flatMap((l: { tiles: unknown[] }) => l.tiles),
      manifest.diffuse,
      manifest.specular,
    ];
    if (records.length > 1026) throw Error("Galaxy manifest budget");
    const seen = new Set<string>();
    for (const r of records) {
      if (
        !r ||
        !/^deep-space\/galaxy-(?:l[0-6]-[0-9]+-[0-9]+|diffuse|specular)\.sehdr$/.test(
          r.path,
        ) ||
        !/^galaxy:(?:l[0-6]:[0-9]+:[0-9]+|diffuse|specular)$/.test(r.assetId) ||
        !/^[a-f0-9]{64}$/.test(r.sha256) ||
        !Number.isInteger(r.bytes) ||
        r.bytes < 16 ||
        r.bytes > 16 * 1024 * 1024 ||
        seen.has(r.assetId)
      )
        throw Error("Invalid galaxy resource");
      seen.add(r.assetId);
    }
    const spec = snapshotEnvironment({
      assetId: manifest.levels[0].tiles[0].assetId,
      frame: "ICRF",
      intensity: 1,
      lod: {
        tileSize: 256,
        border: 2,
        levels: manifest.levels.map(
          (l: {
            level: number;
            width: number;
            height: number;
            tiles: { x: number; y: number; assetId: string }[];
          }) => ({
            ...l,
            tiles: l.tiles.map((t) => ({ x: t.x, y: t.y, assetId: t.assetId })),
          }),
        ),
        diffuseAssetId: manifest.diffuse.assetId,
        specularAssetId: manifest.specular.assetId,
        exposureEv: 0,
        blackLevel: 0,
        iblIntensity: 1,
      },
    });
    for (const r of records) core.register_asset(r.assetId, r.path, "texture");
    galaxySpec = spec;
    return spec;
  };
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
  let cancelRestore: (() => void) | undefined;
  let observationToken = 0;
  let queue: Promise<void> = Promise.resolve(),
    disposal: Promise<void> | undefined;
  let stellarSettings = solarWorkspaceSettings(options.stellarSettings);
  let desiredPlaying = false;
  let lastPublishedEpoch = core.epoch();
  const secondaryRestores = new Set<string>();
  const secondaryLoads = new Set<string>();
  const secondaryRetryAt = new Map<string, number>();
  let lastTrajectoryId: string | undefined;
  let lastTrajectoryRefresh = -Infinity;
  let lastSelectedTrajectoryRefresh = -Infinity;
  const state: SolarSnapshot = {
    ...initialSnapshot,
    busy: true,
    phase: "加载真实太阳系数据",
  };
  const emit = () => {
    if (closed) return;
    const planets = solarCatalog.filter(
      (body) => body.kind === "planet" && baseSolarIds.includes(body.id),
    );
    const planetPhase = (id: string) => {
      try {
        return sdk?.visual.status(id)?.phase;
      } catch {
        return undefined;
      } // Not yet published during the startup progress callbacks.
    };
    state.planetPreparation = {
      total: planets.length,
      ready: planets.filter((body) => planetPhase(body.id) === "ready").length,
      failed: planets.filter(
        (body) =>
          data?.status(body.id)?.status === "failed" ||
          planetPhase(body.id) === "failed",
      ).length,
    };
    if (core.environment_status) {
      const status = JSON.parse(core.environment_status()) ?? {};
      state.galaxy = {
        ...state.galaxy,
        desiredLod: status.desiredLod,
        readyLod: status.readyLod,
        currentLod: status.currentLod,
        blend: status.blend,
        loadedTiles: status.loadedTiles,
        gpuBytes: status.gpuBytes,
      };
      if (
        Number.isInteger(status.desiredLod) &&
        status.desiredLod >= 0 &&
        status.desiredLod <= 6
      )
        void stars?.setLod(status.desiredLod).catch(() => {});
      if (
        state.galaxy.enabled &&
        status &&
        ["pending", "ready", "failed"].includes(status.phase)
      )
        state.galaxy = {
          enabled: true,
          desiredLod: status.desiredLod,
          readyLod: status.readyLod,
          currentLod: status.currentLod,
          blend: status.blend,
          loadedTiles: status.loadedTiles,
          gpuBytes: status.gpuBytes,
          phase: status.phase,
          ...(status.detail
            ? { detail: String(status.detail).slice(0, 240) }
            : {}),
        };
    }
    try {
      const debug = core.camera_render_status?.();
      state.cameraDebug = debug ? (JSON.parse(debug) ?? undefined) : undefined;
    } catch {
      state.cameraDebug = undefined;
    }
    if (data) state.dataCache = data.cacheStats();
    state.epoch = core.epoch();
    state.playing = state.busy ? desiredPlaying : core.playing();
    state.live =
      !state.busy &&
      isLive(
        core.tdb_to_utc(state.epoch),
        Date.now(),
        state.playing,
        state.rate,
      );
    state.utc = new Date(core.tdb_to_utc(state.epoch) * 1000).toISOString();
    state.articulation = undefined;
    if (state.selected && data) {
      state.parentId = data.parentAt(state.selected, state.epoch) ?? undefined;
      const status = data.status(state.selected);
      state.attitude =
        status?.orientationStatus === "ready"
          ? status.orientationSource === "derived"
            ? "NASA Eyes 实体控制器推导姿态（非实测，精度未验收）"
            : status.orientationSource === "fixed"
              ? "NASA Eyes 固定控制器姿态（非实测，精度未验收）"
              : "NASA Eyes DYN 姿态数据可用（精度未验收）"
          : status?.orientationStatus === "unavailable"
            ? `姿态不可用：${status.orientationError ?? "源数据未就绪"}；不作真实姿态声明`
            : status?.orientationStatus === "not-requested"
              ? "姿态按需加载，尚未请求；不作真实姿态声明"
              : "未提供动态姿态；固定控制器姿态待核验，不作真实姿态声明";
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
        if (status?.orientationNote) state.attitude += "；自旋可视化相位以首次有效加载时刻为零点，源未给绝对相位";
      const jointCount = (getEyesDefinition(state.selected)?.controllers ?? []).filter((c) => c.type === "align" && c.joint && (!c.coverage || (state.epoch >= Number(c.coverage[0]) && state.epoch <= Number(c.coverage[1])))).length;
      state.articulation = undefined;
      if (jointCount) {
        const joints = sdk?.visual.jointStatus(state.selected);
        state.articulation = status?.orientationStatus !== "ready"
          ? "等待有效机身姿态，未应用太阳翼关节控制"
          : joints?.phase === "ready"
            ? `已启用 ${joints.applied.length} 个对日关节，遵循各自转轴约束`
            : joints?.phase === "partial" || joints?.phase === "failed"
              ? `已应用 ${joints.applied.length}/${jointCount} 个关节；未匹配或重名节点：${[...joints.missing, ...joints.ambiguous].join("、") || "层级不可用"}`
              : `等待模型节点就绪（${jointCount} 个关节）`;
      }
      state.source =
          state.selected === "sun"
            ? "本场景日心坐标原点"
            : status?.positionSource === "fixed"
              ? "NASA Eyes 固定控制器位置（非实时遥测，精度未验收）"
              : status?.positionSource === "orbital-elements"
                ? "NASA Eyes 轨道元素推导位置（非实时遥测，精度未验收）"
                : `NASA Eyes DYN · 近似星历（精度未验收）${provenance ? ` · SHA256 ${provenance.sha256.slice(0, 12)} · 获取 ${provenance.fetchedAt}${provenance.selection ? " · 已隔离源文件异常，使用核验有效区段" : ""}` : ""}`;
        if (
          (status?.positionSource === "fixed" ||
            status?.positionSource === "orbital-elements") &&
          status.coverage?.some((value) => Math.abs(value) === 1e12)
        )
          state.coverage += " · 平台求值范围，非观测覆盖终点";
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
      state.attitude = "未选择对象";
      const loaded = data.status().filter((item) => item.status === "ready");
      const shown = loaded.filter((item) => {
        try {
          return sdk.visual.status(item.id)?.phase === "ready";
        } catch {
          return false;
        }
      }).length;
      state.dataStatus = `${loaded.length}/${solarCatalog.length} 个对象数据可用 · ${shown} 个显示表示就绪 · 八大行星表面初始化预载`;
      state.source = "NASA Eyes 动态数据与固定表面资源 · 近似星历精度未验收";
      state.coverage = "选择对象查看其真实有效范围";
    }
    update({ ...state });
  };
  const dispose = () =>
    (disposal ??= (async () => {
      observationToken++;
      closed = true;
      secondaryRestores.clear();
      secondaryRetryAt.clear();
      secondaryLoads.clear();
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
          live: false,
          attitude: "工作区已释放",
          dataCache: { ...initialSnapshot.dataCache },
          planetPreparation: { ...initialSnapshot.planetPreparation },
          lighting: "natural",
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
  const detailedBodies = new Set<string>(
    solarCatalog
      .filter(
        (body) => body.kind === "planet" && baseSolarIds.includes(body.id),
      )
      .map((body) => body.id),
  );
  const trajectoryWindows = new Map<string, [number, number]>();
  const pendingTrajectories = new Set<string>();
  const trajectoryCounts = new Map<string, number>();
  const trajectoryDetails = new Map<string, boolean>();
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
            ((state.spacecraft && body.kind === "spacecraft") ||
              (state.moons &&
                body.kind === "moon" &&
                body.subcategory === "Major Moon")) &&
            parentAt(body.id, epoch) === system,
        )
        .slice(0, 128))
        ids.add(body.id);
    }
    let reference = state.followId;
    const seen = new Set<string>();
    while (reference && !seen.has(reference)) {
      seen.add(reference);
      ids.add(reference);
      if (reference === "sun") break;
      reference = parentAt(reference, epoch) ?? undefined;
    }
    // Retain exactly the scene dependency closure, stopping parent ancestry at Sun.
    for (const id of ids) {
      if (id !== "sun") {
        const parent = parentAt(id, epoch);
        if (parent && hasDisplayCatalog(parent)) ids.add(parent);
      }
      for (const controller of activeController(
        id,
        epoch,
        "rotateByEntityOrientation",
      )) {
        const reference =
          controller.entityForOrientation ?? parentAt(id, epoch);
        if (reference && reference !== id && hasDisplayCatalog(reference))
          ids.add(reference);
      }
      for (const controller of activeController(id, epoch, "align")) {
        if (isEntityAlign(controller))
          for (const reference of entityAlignDependencies(controller))
            if (hasDisplayCatalog(reference.id)) ids.add(reference.id);
      }
      if (ids.size > 256) throw Error("当前场景依赖超出对象预算（256）");
    }
    if (ids.size > 256) throw Error("当前场景超出对象预算（256）");
    return [...ids];
  };
  const trajectoryBudget = (id: string) => {
    const count = data.status().filter((s) => s.status === "ready").length;
    return state.selected === id
      ? (solarCatalog.find((body) => body.id === id)?.kind === "spacecraft" ? 512 : 256)
      : Math.min(256, Math.floor((16384 - 1024) / Math.max(1, count)));
  };
  const refreshTrajectory = (id: string) => {
    if (!data.hasTrajectory(id, core.epoch())) {
      sdk.visual.trajectory(id, []);
      trajectoryWindows.delete(id);
      pendingTrajectories.delete(id);
      trajectoryCounts.delete(id);
      return;
    }
    const budget = trajectoryBudget(id);
    const isTrail = ["spacecraft"].includes(
      solarCatalog.find((body) => body.id === id)!.kind,
    );
    const history = isTrail
      ? data.trailSamples(
          id,
          core.epoch(),
          budget,
          state.selected === id,
        )
      : undefined;
    const trail: ReturnType<SolarSystemData["trajectorySamples"]> =
      history ??
      data.trajectorySamples(
        id,
        core.epoch(),
        budget,
        state.selected === id,
        "instantaneous",
      );
    sdk.visual.trajectory(id, trail.points, trail.epochsTdbSeconds, {
      ...(history
        ? {
            kind: "trail" as const,
            trailDurationSeconds: history.durationSeconds,
            breakIndices: history.breakIndices,
          }
        : {kind: "orbit" as const, ...(trail.conic ? {conic: trail.conic} : {})}),
      originId: trail.originId,
      colorRgba: isTrail ? [1, 1, 1, 1] : solarCatalog.find((body) => body.id === id)!.color,
    });
    trajectoryWindows.set(id, trail.refreshRange);
    pendingTrajectories.delete(id);
    trajectoryCounts.set(id, budget);
    trajectoryDetails.set(id, state.selected === id);
  };
  const publishJoints = () => {
    for (const body of solarCatalog) {
      if (!detailedBodies.has(body.id) || !getEyesDefinition(body.id)?.model || data.status(body.id)?.status !== "ready")
        continue;
      try {
        sdk.visual.joints(
          body.id,
          data.status(body.id)?.orientationStatus === "ready"
            ? data.jointAims(body.id, core.epoch())
            : [],
        );
      } catch {
        sdk.visual.joints(body.id, []);
      }
    }
  };
  const configureBody = (body: (typeof solarCatalog)[number], restore = false) => {
      if (data.status(body.id)?.status !== "ready") return;
      try {
        const upgrade =
          (state.selected === body.id ||
            (body.kind === "planet" &&
              parentAt(state.selected, core.epoch()) === body.id)) &&
          !detailedBodies.has(body.id);
        const detailed = detailedBodies.has(body.id) || upgrade;
        if (restore || !sdk.visual.status(body.id) || upgrade) {
          const model = getEyesDefinition(body.id)?.model;
          const framingRadiusKm = getEyesDefinition(body.id)?.extentsRadius;
          if (detailed && model) {
            sdk.visual.set(body.id, {
              kind: "model",
              assetId: `eyes:${body.id}:model`,
              scaleKmPerUnit: 1,
              ...(typeof framingRadiusKm === "number" &&
              Number.isFinite(framingRadiusKm) &&
              framingRadiusKm > 0 &&
              framingRadiusKm <= 1e12
                ? { framingRadiusKm }
                : {}),
              scene: 0,
            });
          } else
            sdk.visual.set(body.id, {
              kind: "sphere",
              colorRgba:
                detailed && body.id !== "sun" && surfaceAssets.has(body.id)
                  ? [1, 1, 1, 1]
                  : body.color,
              ...(detailed && body.id !== "sun" && surfaceAssets.has(body.id)
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
          if (body.id === "sun" && stellarSettings)
            sdk.visual.stellar(body.id, buildStellarTuning(stellarSettings));
          if (upgrade) detailedBodies.add(body.id);
          sdk.visual.label(
            body.id,
            (getEyesDefinition(body.id)?.label ?? body.id).toUpperCase(),
          );
        }
        if (
          (body.kind === "spacecraft" ? state.trails : state.trajectories) &&
          body.id !== "sun" &&
          data.parentAt(body.id, core.epoch()) &&
          (baseSolarIds.includes(body.id) ||
            (getEyesDefinition(body.id)?.controllers ?? []).some(
              (c) => c.type === "dynamo" || c.type === "orbitalElements",
            ))
        ) {
          const window = trajectoryWindows.get(body.id);
          const budget = trajectoryBudget(body.id);
          if (!data.hasTrajectory(body.id, core.epoch())) {
            refreshTrajectory(body.id);
          } else if (body.kind === "spacecraft" && body.id !== state.selected &&
              (trajectoryCounts.get(body.id) ?? 0) <= budget) {
            if (restore || !window || trajectoryCounts.get(body.id) !== budget)
              pendingTrajectories.add(body.id);
          } else if (restore || !window || trajectoryCounts.get(body.id) !== budget ||
                     trajectoryDetails.get(body.id) !== (state.selected === body.id) ||
                     core.epoch() < window[0] || core.epoch() > window[1]) {
            refreshTrajectory(body.id);
          }
        }
      } catch (error) {
        state.error = `${body.name}：${String(error)}`;
      }
  };
  const configure = () => {
    for (const id of new Set([...trajectoryWindows.keys(), ...pendingTrajectories])) {
      const kind = solarCatalog.find((body) => body.id === id)?.kind;
      if (data.status(id)?.status !== "ready" ||
          (kind === "spacecraft" ? !state.trails : !state.trajectories)) {
        pendingTrajectories.delete(id);
        trajectoryCounts.delete(id);
        if (data.status(id)?.status !== "ready") trajectoryWindows.delete(id);
      }
    }
    for (const id of trajectoryWindows.keys()) {
      const kind = solarCatalog.find((body) => body.id === id)?.kind;
      if (kind === "spacecraft" ? !state.trails : !state.trajectories) {
        sdk.visual.trajectory(id, []);
        trajectoryWindows.delete(id);
      }
    }
    // Shrink the previous target's trail before growing the new one; retain the session budget.
    for (const body of [...solarCatalog].sort(
      (a, b) =>
        Number(a.id === state.selected) - Number(b.id === state.selected),
    )) {
      configureBody(body);
    }
    publishJoints();
    sdk.visual.layers({
      labels: state.labels,
      trajectories: state.trajectories || state.trails,
    });
  };
  const refreshDataWarning = () => {
    const unavailable = data
      .status()
      .filter(
        (item) => item.status === "failed" || item.status === "unsupported",
      )
      .map(
        (item) =>
          solarCatalog.find((body) => body.id === item.id)?.name ?? item.id,
      );
    const outside = data
      .status()
      .filter((item) => item.status === "out-of-coverage").length;
    state.phase =
      state.phase.replace(/ · \d+项当前时间无覆盖/g, "") +
      (outside ? ` · ${outside}项当前时间无覆盖` : "");
    state.error = unavailable.length
      ? `部分源数据暂不可用：${unavailable.join("、")}。选择对象查看具体原因。`
      : "";
  };
  const validateFollow = () => {
    if (state.observationMode !== "follow" || !state.followId) return;
    try {
      if (data.status(state.followId)?.status !== "ready")
        throw Error("reference unavailable");
      core.state_at(state.followId, core.epoch());
    } catch {
      if (state.selected && data.status(state.selected)?.status === "ready")
        sdk.camera.observe(state.selected, "nearby");
      state.observationMode = "nearby";
      state.followId = undefined;
      state.error = "跟随参考对象在当前时刻无有效数据，已恢复近景观察";
    }
  };
  const primaryMoons = (target: string, epoch: number) => state.moons &&
    solarCatalog.find(body => body.id === target)?.kind === "planet"
    ? eyesCatalog.filter(body => body.kind === "moon" && body.subcategory === "Major Moon" && parentAt(body.id, epoch) === target).map(body => body.id)
    : [];
  const systemMembers = (target: string, epoch: number) => sceneIds(epoch).filter(id =>
    id === target || (parentAt(id, epoch) === target && data.status(id)?.status === "ready" &&
      solarCatalog.find(body => body.id === id)?.kind === (target === "sun" ? "planet" : "moon")));
  const criticalDependencies = (epoch: number) => {
    const required = new Set<string>(state.selected ? [state.selected] : ["sun"]);
    if (state.followId) required.add(state.followId);
    for (const id of required) {
      const parent = parentAt(id, epoch);
      if (parent && !required.has(parent)) required.add(parent);
      for (const controller of getEyesDefinition(id)?.controllers ?? [])
        if (isEntityAlign(controller))
          for (const reference of entityAlignDependencies(controller))
            if (hasDisplayCatalog(reference.id)) required.add(reference.id);
    }
    return required;
  };
  const reload = (epoch: number, prioritizeSelection = false) => {
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
        const restore = data.checkpoint();
        sdk.time.setPlayback(false, state.rate);
        try {
          const ids = sceneIds(epoch);
          data.retain(ids);
          const orientationIds = new Set(
            [...detailedBodies, state.selected].filter(Boolean),
          );
          let parent = state.selected ? parentAt(state.selected, epoch) : null;
          const parentSeen = new Set<string>();
          while (parent && !parentSeen.has(parent)) {
            parentSeen.add(parent);
            if (hasDisplayCatalog(parent)) orientationIds.add(parent);
            if (parent === "sun") break;
            parent = parentAt(parent, epoch);
          }
          const critical = criticalDependencies(epoch);
          const family = state.observationMode === "system" ? primaryMoons(state.selected, epoch) : [];
          const primaryIds = prioritizeSelection && state.selected
            ? ids.filter((id) => critical.has(id) || family.includes(id))
            : ids;
          await data.load(primaryIds, epoch, [...orientationIds]);
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
            selectedUnavailable ? false : desiredPlaying,
            state.rate,
          );
          const available = data
            .status()
            .filter((item) => item.status === "ready").length;
          state.phase = `当前场景：${available}/${data.status().length} 个对象可用 · 目录 ${workspaceCatalog.length} 项`;
          if (selectedUnavailable)
            state.phase = "所选对象数据不可用，已返回太阳系总览并暂停";
          refreshDataWarning();
          validateFollow();
          if (prioritizeSelection && !selectedUnavailable) {
            const remaining = ids.filter((id) => !primaryIds.includes(id));
            void data.load(remaining, epoch, [...orientationIds]).then(() => {
              if (closed || signal.aborted || current !== revision) return;
              data.publishAt(core.epoch());
              configure();
              if (state.phase.startsWith("当前场景：")) {
                const ready = data.status().filter(item => item.status === "ready").length;
                state.phase = `当前场景：${ready}/${data.status().length} 个对象可用 · 目录 ${workspaceCatalog.length} 项`;
              }
              refreshDataWarning();
              emit();
            }).catch((error) => {
              if (closed || signal.aborted || current !== revision) return;
              state.error = error instanceof Error ? error.message : String(error);
              emit();
            });
          }
          if (
            state.selected &&
            !selectedUnavailable &&
            core.focused_object() === undefined
          ) {
            const target = state.selected;
            const members = sceneIds(epoch).filter(
              (id) =>
                id === target ||
                (parentAt(id, epoch) === target &&
                  data.status(id)?.status === "ready" &&
                  solarCatalog.find((body) => body.id === id)?.kind ===
                    (target === "sun" ? "planet" : "moon")),
            );
            sdk.camera.observe(
              target,
              state.observationMode,
              state.observationMode === "system"
                ? { members }
                : state.observationMode === "follow"
                  ? { followId: state.followId }
                  : undefined,
            );
            sdk.camera.view(state.view as "orbit" | "top" | "front" | "side");
          }
        } finally {
          restore.discard();
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
    cancelSceneRestore() {
      assertLive();
      observationToken++;
      revision++;
      cancelRestore?.();
      state.busy = false;
      desiredPlaying = false;
      sdk.time.setPlayback(false, state.rate);
      emit();
    },
    async restoreScene(input) {
      assertLive();
      runtime.cancelSceneRestore();
      const ids = workspaceCatalog.map((body) => body.id);
      const next = parseSceneLink(formatSceneLink(input, ids), ids);
      if (!next) throw Error("场景链接无有效状态");
      const token = ++observationToken;
      const previous = { ...state };
      const previousEpoch = core.epoch();
      const rollbackData = data.checkpoint();
      const rollback = () => {
        cancelRestore = undefined;
        rollbackData();
        rollbackData.discard();
        Object.assign(state, previous);
        sdk.time.seek(previousEpoch);
        data.publishAt(previousEpoch);
        lastPublishedEpoch = previousEpoch;
        configure();
      };
      cancelRestore = rollback;
      sdk.time.setPlayback(false, state.rate);
      desiredPlaying = false;
      state.selected = next.targetId;
      state.observationMode = "nearby";
      state.followId = next.followId;
      state.moons = next.moons;
      state.spacecraft = next.spacecraft;
      try {
        const pending = reload(next.epoch ?? core.epoch());
        const ownedRevision = revision;
        await pending;
        assertLive();
        if (token !== observationToken || ownedRevision !== revision) {
          if (cancelRestore === rollback) cancelRestore = undefined;
          rollbackData.discard();
          return;
        }
        if (next.targetId) {
          if (data.status(next.targetId)?.status !== "ready")
            throw Error("场景对象在指定时间无有效数据");
          if (
            next.mode === "follow" &&
            (!next.followId || data.status(next.followId)?.status !== "ready")
          )
            throw Error("跟随参考对象在指定时间无有效数据");
          const members = sceneIds(core.epoch()).filter(
            (id) =>
              id === next.targetId ||
              (parentAt(id, core.epoch()) === next.targetId &&
                data.status(id)?.status === "ready" &&
                solarCatalog.find((body) => body.id === id)?.kind ===
                  (next.targetId === "sun" ? "planet" : "moon")),
          );
          sdk.camera.observe(
            next.targetId,
            next.mode,
            next.mode === "system"
              ? { members }
              : next.mode === "follow"
                ? { followId: next.followId }
                : undefined,
          );
          sdk.camera.view(next.view);
        } else sdk.camera.view("overview");
        sdk.camera.lighting(next.lighting);
        sdk.camera.fieldOfView(next.fovDegrees);
        cancelRestore = undefined;
        rollbackData.discard();
        state.observationMode = next.mode;
        state.view = next.view;
        state.lighting = next.lighting;
        state.fovDegrees = next.fovDegrees;
        state.labels = next.labels;
        state.trajectories = next.trajectories;
        state.trails = next.trails;
        configure();
        sdk.time.setPlayback(next.playing, next.rate);
        desiredPlaying = next.playing;
        state.rate = next.rate;
        emit();
      } catch (error) {
        if (!closed && token === observationToken) {
          rollback();
          state.observationMode = "nearby";
          state.followId = undefined;
          try {
            if (
              state.selected &&
              data.status(state.selected)?.status === "ready"
            )
              sdk.camera.observe(state.selected, "nearby");
          } catch {}
          state.error = `场景恢复失败：${String(error)}`;
          emit();
        }
        throw error;
      }
    },

    tuneStellar(settings) {
      assertLive();
      const next = solarWorkspaceSettings(settings);
      const tuning = buildStellarTuning(next);
      sdk.visual.stellar("sun", tuning);
      stellarSettings = next;
    },
    lighting(mode) {
      assertLive();
      if (state.busy) throw Error("场景加载中，请稍后修改光照");
      observationToken++;
      sdk.camera.lighting(mode);
      state.lighting = mode;
      emit();
    },
    fieldOfView(degrees) {
      assertLive();
      if (state.busy) throw Error("场景加载中，请稍后修改视场");
      observationToken++;
      sdk.camera.fieldOfView(degrees);
      state.fovDegrees = degrees;
      emit();
    },
    galaxy(enabled) {
      assertLive();
      const generation = ++galaxyGeneration;
      galaxyAbort.abort();
      galaxyAbort = new AbortController();
      galaxySdk.visual.environment(null);
      if (enabled)
        void (galaxySpec ? Promise.resolve(galaxySpec) : loadGalaxy())
          .then((spec) => {
            if (closed || generation !== galaxyGeneration || signal.aborted)
              return;
            galaxySdk.visual.environment(spec);
            emit();
          })
          .catch((error) => {
            if (closed || generation !== galaxyGeneration) return;
            state.galaxy = {
              enabled: true,
              phase: "failed",
              detail: String(error),
            };
            emit();
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
      cancelRestore?.();
      observationToken++;
      if (!solarCatalog.some((body) => body.id === id))
        throw new Error("未知对象");
      state.observationMode = primaryMoons(id, core.epoch()).length ? "system" : "nearby";
      state.followId = undefined;
      state.selected = id;
      const pending = reload(core.epoch(), true),
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
      if (state.observationMode === "system")
        sdk.camera.observe(id, "system", {members: systemMembers(id, core.epoch())});
      sdk.camera.view("orbit");
      state.view = "orbit";
      emit();
    },
    focus() {
      assertLive();
      observationToken++;
      if (!state.selected) throw new Error("请先选择对象");
      sdk.camera.observe(state.selected, "nearby");
      state.observationMode = "nearby";
      state.followId = undefined;
      emit();
    },
    orbit(yaw, pitch) {
      assertLive();
      sdk.camera.orbit(yaw, pitch);
    },
    zoom(delta) {
      assertLive();
      sdk.camera.zoom(delta);
    },
    async observation(mode, followId) {
      assertLive();
      const token = ++observationToken;
      const target = state.selected;
      if (!target) throw Error("请先选择观察对象");
      const reference =
        mode === "follow"
          ? (followId ?? parentAt(target, core.epoch()) ?? undefined)
          : undefined;
      if (
        mode === "follow" &&
        (!reference ||
          reference === target ||
          !solarCatalog.some((body) => body.id === reference))
      )
        throw Error("请选择不同且已登记的跟随参考对象");
      state.followId = reference;
      try {
        await reload(core.epoch());
        assertLive();
        if (state.selected !== target || token !== observationToken) return;
        if (
          mode === "follow" &&
          (!reference || data.status(reference)?.status !== "ready")
        )
          throw Error("跟随参考对象在当前时刻无有效数据");
        const members = sceneIds(core.epoch()).filter(
          (id) =>
            id === target ||
            (parentAt(id, core.epoch()) === target &&
              data.status(id)?.status === "ready" &&
              solarCatalog.find((body) => body.id === id)?.kind ===
                (target === "sun" ? "planet" : "moon")),
        );
        sdk.camera.observe(
          target,
          mode,
          mode === "system"
            ? { members }
            : mode === "follow"
              ? { followId: reference }
              : undefined,
        );
        state.observationMode = mode;
        if (mode === "follow") {
          sdk.camera.view("orbit");
          state.view = "orbit";
        }
        emit();
      } catch (error) {
        if (
          !closed &&
          token === observationToken &&
          state.selected === target
        ) {
          state.observationMode = "nearby";
          state.followId = undefined;
          try {
            if (data.status(target)?.status === "ready")
              sdk.camera.observe(target, "nearby");
          } catch {
            /* Preserve the original observation error. */
          }
          state.error = `观察模式不可用，已恢复近景：${String(error)}`;
          emit();
        }
        throw error;
      }
    },
    follow(referenceId) {
      return runtime.observation("follow", referenceId);
    },
    overview() {
      assertLive();
      cancelRestore?.();
      observationToken++;
      const ownedRevision = ++revision;
      sdk.time.setPlayback(desiredPlaying, state.rate);
      state.observationMode = "nearby";
      state.followId = undefined;
      state.selected = "";
      data.retain(baseSolarIds);
      refreshDataWarning();
      configure();
      sdk.camera.view("overview");
      state.view = "orbit";
      state.phase = "太阳系总览";
      refreshDataWarning();
      emit();
      if (state.busy)
        void queue
          .finally(() => {
            if (closed || revision !== ownedRevision) return;
            data.retain(baseSolarIds);
            refreshDataWarning();
            data.publishAt(core.epoch());
            configure();
            state.busy = false;
            sdk.time.setPlayback(desiredPlaying, state.rate);
            state.phase = "太阳系总览";
            refreshDataWarning();
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
      if (state.busy) throw Error("场景加载中，请稍后修改视角");
      observationToken++;
      sdk.camera.view(mode);
      state.view = mode;
      emit();
    },
    play(playing, rate) {
      assertLive();
      if (state.busy && playing) throw new Error("数据加载中，请稍后调整播放");
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
    async now() {
      assertLive();
      const catchUp = desiredPlaying && state.rate === 1;
      const pending = reload(core.utc_to_tdb(Date.now() / 1000));
      const ownedRevision = revision;
      await pending;
      assertLive();
      if (
        !catchUp ||
        revision !== ownedRevision ||
        !desiredPlaying ||
        state.rate !== 1
      )
        return;
      const latest = core.utc_to_tdb(Date.now() / 1000);
      const ready = data
        .status()
        .filter((item) => item.id !== "sun" && item.status === "ready");
      if (
        !ready.length ||
        ready.some(
          (item) =>
            !item.coverage ||
            latest < item.coverage[0] ||
            latest > item.coverage[1],
        )
      )
        return;
      sdk.time.seek(latest);
      data.publishAt(latest);
      lastPublishedEpoch = core.epoch();
      validateFollow();
      emit();
    },
    async groups(moons, spacecraft) {
      assertLive();
      state.moons = moons;
      state.spacecraft = spacecraft;
      const target = state.selected;
      const pending = reload(core.epoch());
      const ownedRevision = revision;
      await pending;
      if (closed || revision !== ownedRevision || state.selected !== target) return;
      if (state.observationMode === "system" && target)
        sdk.camera.observe(target, "system", {members: systemMembers(target, core.epoch())});
      emit();
    },
    trails(enabled) {
      assertLive();
      state.trails = enabled;
      configure();
      emit();
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
    options.onStartup?.("加载八大行星轨道、姿态和表面资源");
    await reload(core.utc_to_tdb(Date.now() / 1000));
    assertLive();
    if (
      data.status().some((item) => item.id !== "sun" && item.status === "ready")
    ) {
      runtime.play(true, 1);
      await runtime.now();
      assertLive();
    }
    sdk.camera.view("overview");
    options.onStartup?.("启动三维渲染器");
    runtime.lighting("shadow");
    core.start_renderer(canvas);
    state.startupMs = Math.max(0, performance.now() - startupAt);
    state.active = true;
    if (options.backgroundGalaxy !== false) runtime.galaxy(true);
    emit();
    void stars.setLod(0);
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
          const required = criticalDependencies(epoch);
          const expired = data.status().filter((item) => item.id !== "sun" &&
            item.coverage && item.status !== "failed" && item.status !== "loading" &&
            (epoch < item.coverage[0] || epoch > item.coverage[1]));
          const missing = expired.some((item) => required.has(item.id));
          if (missing) {
            sdk.time.seek(lastPublishedEpoch);
            void reload(epoch, Boolean(state.selected)).catch((error) => {
              state.error = String(error);
              emit();
            });
          } else {
            data.publishAt(epoch);
            // Publish first so expired secondary objects disappear before loading.
            // Secondary cache work never seeks time or changes playback/selection.
            const retained = new Set(data.status().map((item) => item.id));
            for (const id of secondaryRetryAt.keys())
              if (!retained.has(id)) secondaryRetryAt.delete(id);
            for (const item of expired) {
              if (required.has(item.id) || secondaryLoads.has(item.id) ||
                  now < (secondaryRetryAt.get(item.id) ?? -Infinity)) continue;
              secondaryRetryAt.set(item.id, now + 1000);
              secondaryLoads.add(item.id);
              const requestedRevision = revision;
              void data.load([item.id], epoch, []).then(() => {
                if (!closed && requestedRevision === revision && data.status(item.id)?.status === "ready")
                  secondaryRestores.add(item.id);
              }).catch(() => {}).finally(() => {
                secondaryLoads.delete(item.id);
              });
            }
            let restored = false;
            for (const id of secondaryRestores) {
              secondaryRestores.delete(id);
              const body = solarCatalog.find((item) => item.id === id);
              if (!body || data.status(id)?.status !== "ready") continue;
              configureBody(body, true);
              restored = true;
              break;
            }
            publishJoints();
            validateFollow();
            if (!restored && (state.trajectories || state.trails) && (pendingTrajectories.size > 0 || now - lastTrajectoryRefresh >= 50)) {
              // Cosmetic maintenance must not rebuild the whole scene in one RAF.
              // Rotate over current windows; no deferred work can publish a stale selection.
              const selectedWindow = trajectoryWindows.get(state.selected);
              const selectedDue = selectedWindow && now - lastSelectedTrajectoryRefresh >= 100 &&
                (epoch < selectedWindow[0] || epoch > selectedWindow[1]);
              const ids = [...new Set([...pendingTrajectories, ...trajectoryWindows.keys()])];
              const start = selectedDue ? ids.indexOf(state.selected) :
                (ids.indexOf(lastTrajectoryId ?? "") + 1) % Math.max(1, ids.length);
              for (let offset = 0; offset < ids.length; offset++) {
                const id = ids[(start + offset) % ids.length]!;
                if (data.status(id)?.status !== "ready") {
                  trajectoryWindows.delete(id);
                  pendingTrajectories.delete(id);
                  trajectoryCounts.delete(id);
                  continue;
                }
                const window = trajectoryWindows.get(id);
                if (shouldRefreshTrajectory(
                    pendingTrajectories.has(id),
                    !window || epoch < window[0] || epoch > window[1],
                    id === state.selected,
                    now - lastTrajectoryRefresh,
                    now - lastSelectedTrajectoryRefresh,
                  )) {
                  try {
                    refreshTrajectory(id);
                  } catch (error) {
                    if (id === state.selected) throw error;
                    pendingTrajectories.delete(id);
                    trajectoryWindows.delete(id);
                    trajectoryCounts.delete(id);
                    sdk.visual.trajectory(id, []);
                    state.error = `${id}：${String(error)}`;
                  }
                  lastTrajectoryId = id;
                  lastTrajectoryRefresh = now;
                  if (id === state.selected) lastSelectedTrajectoryRefresh = now;
                  break;
                }
              }
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
