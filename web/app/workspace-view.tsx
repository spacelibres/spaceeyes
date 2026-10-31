"use client";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ZoomButtonGesture, type ZoomDirection } from "../lib/zoom-button";
import {
  TIME_RATES,
  rateToSliderIndex,
  adjacentRate,
  formatRate,
} from "../lib/time-controls";
import SolarTuningPanel from "./solar-tuning-panel";
import { TouchCamera } from "../lib/touch-camera";
import { SceneGesture } from "../lib/scene-gesture";
import type { StarfieldProgress } from "../../platform/starfield-source";
export type CatalogEntry = {
  id: string;
  name: string;
  parentId?: string;
  radiusKm: number;
  kind?: string;
  subcategory?: string;
  radiusSource?: string;
  keywords?: string[];
};
export type WorkspaceViewProps = {
  cameraDebug?: Readonly<Record<string, unknown>>;
  shareUrl?: string;
  onShare?: () => void;
  stellarSettings?: Record<string, number>;
  onStellar?: (settings: Record<string, number>) => void;
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
  dataCache?: {
    records: number;
    positionEntries: number;
    orientationEntries: number;
    provenance: number;
    maxRecords: number;
  };
  lighting?: "natural" | "shadow" | "flood";
  onLighting?: (mode: "natural" | "shadow" | "flood") => void;
  fovDegrees: number;
  onFov: (degrees: number) => void;
  onGalaxy: () => void;
  onRetryGalaxy: () => void;
  starfield: StarfieldProgress;
  onStarfield: () => void;
  onRetryStarfield: () => void;
  catalog: CatalogEntry[];
  selected: string;
  search: string;
  setSearch: (v: string) => void;
  startupMs?: number;
  parentId?: string;
  active: boolean;
  busy: boolean;
  phase: string;
  error: string;
  epoch: number;
  playing: boolean;
  live?: boolean;
  rate: string;
  source: string;
  coverage: string;
  attitude?: string;
  articulation?: string;
  dataStatus: string;
  view: string;
  labels: boolean;
  trajectories: boolean;
  moons?: boolean;
  spacecraft?: boolean;
  onGroups?: (moons: boolean, spacecraft: boolean) => void;
  trails: boolean;
  onStart: () => void;
  onStop: () => void;
  onSelect: (id: string) => void;
  onPick: (u: number, v: number) => Promise<boolean>;
  onFocus: () => void;
  onFollow: (referenceId?: string) => void;
  observationMode?: "nearby" | "system" | "follow";
  followId?: string;
  onObservation?: (
    mode: "nearby" | "system" | "follow",
    referenceId?: string,
  ) => void;
  onOrbit?: (yaw: number, pitch: number) => void;
  onZoom?: (delta: number) => void;
  onOverview: () => void;
  onView: (v: string) => void;
  onPlay: () => void;
  onRate: (v: string) => void;
  jump: string;
  onJumpInput: (v: string) => void;
  onJump: () => void;
  onNow: () => void;
  onMissionTime: () => void;
  utc: string;
  utcJump: string;
  onUtcInput: (v: string) => void;
  onUtcJump: () => void;
  onLabels: () => void;
  onTrajectories: () => void;
  onTrails: () => void;
};
export default function WorkspaceView(p: WorkspaceViewProps) {
  const [timeExpanded, setTimeExpanded] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const zoomIntent = useRef(p.onZoom);
  zoomIntent.current = p.onZoom;
  const zoomButtons = useRef(
    new ZoomButtonGesture((delta) => zoomIntent.current?.(delta)),
  );
  useEffect(() => {
    setSettingsExpanded(
      !window.matchMedia("(max-width: 760px), (max-height: 440px)").matches,
    );
    const stop = () => zoomButtons.current.cancel();
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    zoomButtons.current.cancel();
    return () => zoomButtons.current.cancel();
  }, [p.active, p.selected, p.observationMode, p.followId, p.view]);
  const zoomButtonProps = (direction: ZoomDirection) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!p.active || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      zoomButtons.current.begin(event.pointerId, direction);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        zoomButtons.current.cancel();
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      zoomButtons.current.end(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerLeave: () => zoomButtons.current.cancel(),
    onPointerCancel: () => zoomButtons.current.cancel(),
    onLostPointerCapture: () => zoomButtons.current.cancel(),
    onBlur: () => zoomButtons.current.cancel(),
    onClick: (event: { detail: number }) =>
      zoomButtons.current.click(event.detail, direction),
  });
  const screen = useRef<HTMLElement>(null);
  const observationTools = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = observationTools.current;
    const root = screen.current;
    if (!element || !root) return;
    const measure = () =>
      root.style.setProperty(
        "--observation-tools-height",
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--observation-tools-height");
    };
  }, []);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    const element = screen.current;
    setFullscreenSupported(
      Boolean(document.fullscreenEnabled && screen.current?.requestFullscreen),
    );
    const changed = () => {
      setFullscreen(document.fullscreenElement === screen.current);
      setFullscreenError("");
    };
    const failed = () =>
      setFullscreenError("无法进入全屏，请检查浏览器权限或窗口状态");
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("fullscreenerror", failed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("fullscreenerror", failed);
      if (element && document.fullscreenElement === element)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!p.active && document.fullscreenElement === screen.current)
      void document
        .exitFullscreen()
        .catch(() => setFullscreenError("无法退出全屏，请按 Esc"));
  }, [p.active]);
  const toggleFullscreen = () => {
    setFullscreenError("");
    try {
      const request =
        document.fullscreenElement === screen.current
          ? document.exitFullscreen()
          : screen.current?.requestFullscreen();
      void request?.catch(() =>
        setFullscreenError("全屏请求被浏览器拒绝，请检查权限"),
      );
    } catch {
      setFullscreenError("当前浏览器无法切换全屏");
    }
  };
  const touch = useRef(new TouchCamera());
  const gesture = useRef(new SceneGesture());
  const pickRevision = useRef(0);
  useEffect(
    () => () => {
      pickRevision.current++;
      gesture.current.cancel();
      touch.current.clear();
    },
    [p.active],
  );
  const [panel, setPanel] = useState<"catalog" | "info" | "time" | null>(null);
  useEffect(() => {
    if (panel)
      document
        .getElementById(`${panel}-panel`)
        ?.querySelector<HTMLButtonElement>(".close-panel")
        ?.focus();
  }, [panel]);
  const closePanel = () => {
    pickRevision.current++;
    document
      .querySelector<HTMLButtonElement>(`[data-panel="${panel}"]`)
      ?.focus();
    setPanel(null);
  };
  const select = (id: string) => {
    pickRevision.current++;
    setPanel("info");
    p.onSelect(id);
  };
  const togglePanel = (next: "catalog" | "info" | "time") => {
    pickRevision.current++;
    setPanel(panel === next ? null : next);
  };
  const object = p.catalog.find((o) => o.id === p.selected);
  const [category, setCategory] = useState("all");
  const canObserve =
    p.active && Boolean(object) && p.dataStatus.startsWith("ready");
  const matches = p.catalog.filter(
    (o) =>
      (category === "all" ||
        (category === "major"
          ? o.kind === "star" || o.kind === "planet"
          : o.kind === category)) &&
      `${o.name} ${o.id} ${o.keywords?.join(" ") ?? ""}`
        .toLowerCase()
        .includes(p.search.toLowerCase()),
  );
  return (
    <main
      ref={screen}
      className={`immersive ${timeExpanded ? "time-expanded" : "time-collapsed"}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && panel) {
          event.stopPropagation();
          closePanel();
        }
        if (
          event.key === "Escape" &&
          document.fullscreenElement === screen.current
        ) {
          void document
            .exitFullscreen()
            .catch(() =>
              setFullscreenError("无法退出全屏，请使用浏览器的退出全屏操作"),
            );
        }
      }}
    >
      <header>
        <div>
          <picture>
            <source media="(max-width: 600px)" srcSet="/icon.svg" />
            <img src="/spacelibre.svg" alt="spacelibre" width="240" />
          </picture>
          <h1>
            太空之眼 <small>SPACE EYES</small>
          </h1>
        </div>
        <div className="header-actions">
          <button
            data-panel="catalog"
            aria-expanded={panel === "catalog"}
            aria-controls="catalog-panel"
            onClick={() => togglePanel("catalog")}
          >
            探索天体
          </button>
          <button
            data-panel="info"
            aria-expanded={panel === "info"}
            aria-controls="info-panel"
            onClick={() => togglePanel("info")}
          >
            对象与图层
          </button>
          <button disabled={!p.active} onClick={p.onOverview}>
            太阳系总览
          </button>
          <button
            disabled={!fullscreenSupported || !p.active}
            aria-pressed={fullscreen}
            title={fullscreenSupported ? "切换全屏" : "当前浏览器不支持全屏"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? "退出全屏" : "全屏"}
          </button>
          <button
            disabled={!p.active || p.busy}
            onClick={() => {
              p.onShare?.();
              setSharing(true);
              setCopyStatus("");
            }}
          >
            分享场景
          </button>
          <a href="/diagnostics">数据诊断</a>
        </div>
      </header>
      {sharing && (
        <section className="share-panel" aria-label="分享场景">
          <button onClick={() => setSharing(false)} aria-label="关闭分享">
            ×
          </button>
          <label>
            场景链接
            <input
              readOnly
              value={p.shareUrl ?? ""}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button
            onClick={() => {
              if (!navigator.clipboard?.writeText) {
                setCopyStatus("无法自动复制，请选取链接手动复制");
                return;
              }
              void navigator.clipboard.writeText(p.shareUrl ?? "").then(
                () => setCopyStatus("已复制场景链接"),
                () => setCopyStatus("复制失败，请选取链接手动复制"),
              );
            }}
          >
            复制链接
          </button>
          <p role="status">{copyStatus}</p>
          <p>保存对象、时间及观察模式等语义状态，不包含精确鼠标轨道角度。</p>
        </section>
      )}
      <div className="workspace-status" role="status">
        <span className={p.active ? "status-dot live" : "status-dot"} />
        <span className="phase-text">{p.phase}</span>
        {p.active && p.startupMs !== undefined && (
          <small>
            本次初始化 {(p.startupMs / 1000).toFixed(2)}{" "}
            秒（不含首帧及贴图就绪）
          </small>
        )}
        <button onClick={p.busy || p.active ? p.onStop : p.onStart}>
          {p.busy ? "取消加载" : p.active ? "退出工作区" : "进入工作区"}
        </button>
      </div>
      <div className="workspace">
        <aside
          id="catalog-panel"
          className="catalog tool-panel"
          hidden={panel !== "catalog"}
          aria-label="探索天体面板"
        >
          <button
            className="close-panel"
            aria-label="关闭天体目录"
            onClick={closePanel}
          >
            ×
          </button>
          <h2>探索太阳系</h2>
          <label className="search-label">
            对象目录
            <input
              type="search"
              value={p.search}
              onChange={(e) => p.setSearch(e.target.value)}
              placeholder="搜索名称或标识"
            />
          </label>
          <label className="search-label">
            对象分类
            <select
              aria-label="对象分类"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">全部对象</option>
              <option value="major">太阳与行星</option>
              <option value="moon">天然卫星</option>
              <option value="spacecraft">人造卫星与飞船</option>
            </select>
          </label>
          <p className="muted">
            {matches.length} / {p.catalog.length} 项 · 模型按需加载
          </p>
          <button
            className="overview-button"
            disabled={!p.active}
            onClick={p.onOverview}
          >
            ↗ 返回太阳系总览
          </button>
          <nav aria-label="太阳系对象">
            {matches.map((o) => (
              <button
                key={o.id}
                aria-pressed={p.selected === o.id}
                disabled={!p.active}
                className={
                  o.parentId ? "catalog-object child" : "catalog-object"
                }
                onClick={() => select(o.id)}
              >
                <span>{o.name}</span>
                <small>{o.id}</small>
              </button>
            ))}
          </nav>
          {!matches.length && <p>没有匹配对象。尝试太阳、地球或月球。</p>}
        </aside>
        <section className="viewport" aria-label="Bevy太阳系三维画布">
          <canvas
            id="spaceeyes-canvas"
            tabIndex={0}
            aria-label="三维场景：方向键环绕，加减缩放，Home近景，空格播放"
            onKeyDown={(event) => {
              if (!p.active || p.busy) return;
              const orbit: Record<string, [number, number]> = {
                ArrowLeft: [-0.06, 0],
                ArrowRight: [0.06, 0],
                ArrowUp: [0, -0.06],
                ArrowDown: [0, 0.06],
              };
              if (orbit[event.key]) p.onOrbit?.(...orbit[event.key]);
              else if (event.key === "+" || event.key === "=")
                p.onZoom?.(-0.15);
              else if (event.key === "-") p.onZoom?.(0.15);
              else if (event.key === "Home") p.onObservation?.("nearby");
              else if (event.key === " ") p.onPlay();
              else return;
              event.preventDefault();
              event.stopPropagation();
            }}
            style={{ visibility: p.active ? "visible" : "hidden" }}
            onPointerDown={(event) => {
              if (
                touch.current.begin(
                  event.pointerId,
                  event.clientX,
                  event.clientY,
                  event.pointerType,
                )
              ) {
                event.preventDefault();
                event.stopPropagation();
                gesture.current.cancel();
                event.currentTarget.setPointerCapture(event.pointerId);
                return;
              }
              event.currentTarget.focus();
              gesture.current.begin(event);
            }}
            onPointerMove={(event) => {
              if (event.pointerType === "touch") {
                event.preventDefault();
                event.stopPropagation();
                const intent = touch.current.move(
                  event.pointerId,
                  event.clientX,
                  event.clientY,
                );
                if (p.active && !p.busy) {
                  if (intent?.orbit) p.onOrbit?.(...intent.orbit);
                  if (intent?.zoom !== undefined) p.onZoom?.(intent.zoom);
                }
                return;
              }
              gesture.current.move(event);
            }}
            onPointerCancel={() => {
              gesture.current.cancel();
              touch.current.clear();
            }}
            onPointerLeave={() => {
              gesture.current.cancel();
              touch.current.clear();
            }}
            onPointerUp={(event) => {
              let point: [number, number] | undefined;
              if (event.pointerType === "touch") {
                event.preventDefault();
                event.stopPropagation();
                touch.current.move(
                  event.pointerId,
                  event.clientX,
                  event.clientY,
                );
                point = touch.current.end(event.pointerId);
              } else point = gesture.current.end(event);
              if (!p.active || !point) return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return;
              const revision = ++pickRevision.current;
              void p
                .onPick(
                  (point[0] - rect.left) / rect.width,
                  (point[1] - rect.top) / rect.height,
                )
                .then((hit) => {
                  if (hit && revision === pickRevision.current)
                    setPanel("info");
                });
            }}
          />
          <div className="viewport-heading">
            <span>
              {p.active &&
              object &&
              !p.busy &&
              !p.dataStatus.startsWith("ready")
                ? `${object.name} · 无可用数据，当前显示太阳系总览`
                : (object?.name ?? "太阳系总览")}
            </span>
            <span>ICRF · {object ? "km" : "AU"}</span>
          </div>
          {!p.active && (
            <div className="viewport-empty">
              <h2>
                {p.busy
                  ? "正在准备三维场景"
                  : p.phase.startsWith("启动失败")
                    ? "暂时无法进入场景"
                    : "从太阳系出发"}
              </h2>
              <p>
                {p.busy
                  ? p.phase
                  : "进入工作区，选择天体、观察关联对象并探索时间。"}
              </p>
              <button disabled={p.busy} onClick={p.onStart}>
                {p.busy
                  ? "正在加载…"
                  : p.phase.startsWith("启动失败")
                    ? "重新进入工作区 →"
                    : "进入三维工作区 →"}
              </button>
            </div>
          )}
          <div className="view-controls" ref={observationTools}>
            <div
              id="observation-controls"
              className="observation-controls"
              hidden={!settingsExpanded}
            >
              <label>
                光照
                <select
                  disabled={!p.active || p.busy}
                  value={p.lighting ?? "natural"}
                  onChange={(e) =>
                    p.onLighting?.(
                      e.target.value as "natural" | "shadow" | "flood",
                    )
                  }
                >
                  <option value="natural">自然光</option>
                  <option value="shadow">暗面补光</option>
                  <option value="flood">强补光</option>
                </select>
              </label>
              <button
                className="zoom-button"
                disabled={!p.active}
                aria-label="放大"
                {...zoomButtonProps(-1)}
              >
                +
              </button>
              <button
                className="zoom-button"
                disabled={!p.active}
                aria-label="缩小"
                {...zoomButtonProps(1)}
              >
                −
              </button>
              <label>
                观察模式
                <select
                  disabled={!canObserve || p.busy}
                  value={p.observationMode ?? "nearby"}
                  onChange={(e) =>
                    p.onObservation?.(
                      e.target.value as "nearby" | "system" | "follow",
                      p.followId,
                    )
                  }
                >
                  <option value="nearby">Nearby · 近景</option>
                  <option value="system">System · 系统</option>
                  <option value="follow">Follow · 跟随</option>
                </select>
              </label>
              <label>
                跟随参考
                <select
                  disabled={!canObserve || p.busy}
                  value={p.followId ?? ""}
                  onChange={(e) => p.onFollow(e.target.value)}
                >
                  <option value="">所属父体</option>
                  {p.catalog
                    .filter((o) => o.id !== p.selected)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                观测视场 {p.fovDegrees}°
                <input
                  aria-label="观测视场（度）"
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  disabled={!p.active || p.busy}
                  value={p.fovDegrees}
                  onChange={(e) => p.onFov(Number(e.target.value))}
                />
              </label>
              <label>
                观察视角
                <select
                  disabled={!p.active || p.busy}
                  value={p.view}
                  onChange={(e) => p.onView(e.target.value)}
                >
                  <option value="orbit">自由环绕</option>
                  <option value="top">俯视</option>
                  <option value="front">正视</option>
                  <option value="side">侧视</option>
                </select>
              </label>
            </div>
            <button
              className="settings-toggle"
              disabled={!p.active}
              aria-label={settingsExpanded ? "收起观察设置" : "展开观察设置"}
              title={settingsExpanded ? "收起观察设置" : "展开观察设置"}
              aria-expanded={settingsExpanded}
              aria-controls="observation-controls"
              onClick={() => {
                zoomButtons.current.cancel();
                setSettingsExpanded((value) => !value);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M5 3v18M12 3v18M19 3v18" />
                <path d="M2 8h6M9 16h6M16 6h6" strokeWidth="3" />
              </svg>
            </button>
          </div>
          <span className="caption">
            点击天体或标签 · 拖动环绕 · 滚轮缩放 · 远景标记非真实尺寸
          </span>
        </section>
        <aside
          id="info-panel"
          className="object-details tool-panel"
          hidden={panel !== "info"}
          aria-label="对象与图层面板"
        >
          <button
            className="close-panel"
            aria-label="关闭对象信息"
            onClick={closePanel}
          >
            ×
          </button>
          <p className="eyebrow">对象信息</p>
          <h2>{object?.name ?? "太阳系"}</h2>
          <p className="metadata">{object?.id ?? "SOLAR SYSTEM"}</p>
          <div className="target-actions">
            <button disabled={!canObserve || p.busy} onClick={p.onFocus}>
              聚焦
            </button>
            <button
              disabled={!canObserve || p.busy}
              onClick={() => p.onFollow()}
            >
              跟随
            </button>
          </div>
          <dl>
            <dt>数据状态</dt>
            <dd>{p.dataStatus}</dd>
            <dt>姿态来源与状态</dt>
            <dd>{p.attitude ?? "尚未核验姿态来源"}</dd>
            {p.articulation && (
              <>
                <dt>骨骼与太阳翼</dt>
                <dd>{p.articulation}</dd>
              </>
            )}
            <dt>科学来源</dt>
            <dd>{p.source}</dd>
            {p.selected === "sun" && (
              <>
                <dt>太阳风模型</dt>
                <dd>
                  Parker 等温跨声速模型 ·{" "}
                  {p.stellarSettings?.temperatureMK ?? 1.5} MK、1 AU 密度{" "}
                  {p.stellarSettings?.densityCm3 ?? 5} cm⁻³
                  为示例边界，非实时观测。外流按飞行时间压缩播放、亮度增强；表面与日珥尚非完整
                  MHD。
                </dd>
              </>
            )}
            <dt>有效覆盖 · J2000 TDB 秒</dt>
            <dd>{p.coverage}</dd>
            {object && (
              <>
                <dt>
                  {object.radiusSource?.includes("framing")
                    ? "模型取景范围（非物理半径）"
                    : "参考半径"}
                </dt>
                <dd>{object.radiusKm.toLocaleString()} km</dd>
              </>
            )}
          </dl>
          {object?.kind === "spacecraft" && (
            <button disabled={!p.active || p.busy} onClick={p.onMissionTime}>
              前往有效观测时间
            </button>
          )}
          {object && (
            <section>
              <h3>关联对象</h3>
              {p.catalog
                .filter(
                  (o) =>
                    o.parentId === object.id ||
                    o.id === (p.parentId ?? object.parentId),
                )
                .map((o) => (
                  <button
                    key={o.id}
                    disabled={!p.active}
                    onClick={() => select(o.id)}
                  >
                    {o.name} →
                  </button>
                ))}
            </section>
          )}
          {p.selected === "sun" && p.onStellar && (
            <SolarTuningPanel
              active={p.active && !p.busy}
              onApply={p.onStellar}
              initial={p.stellarSettings}
            />
          )}
          <h3>显示图层</h3>
          <label className="toggle">
            <input
              type="checkbox"
              disabled={!p.active || p.busy}
              checked={p.moons ?? true}
              onChange={(e) =>
                p.onGroups?.(e.target.checked, p.spacecraft ?? true)
              }
            />
            天然卫星
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              disabled={!p.active || p.busy}
              checked={p.spacecraft ?? true}
              onChange={(e) => p.onGroups?.(p.moons ?? true, e.target.checked)}
            />
            人造卫星与飞船
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={p.galaxy.enabled}
              disabled={!p.active}
              onChange={p.onGalaxy}
            />
            银河全景
          </label>
          <p className="muted" role="status" aria-label="银河加载状态">
            {!p.galaxy.enabled
              ? "银河已关闭"
              : p.galaxy.phase === "ready"
                ? "NASA 银河全景已就绪"
                : p.galaxy.phase === "failed"
                  ? "银河资源暂不可用"
                  : "正在加载 NASA 银河全景"}
          </p>
          {p.galaxy.phase === "failed" && (
            <div>
              <p>{p.galaxy.detail}</p>
              <button disabled={!p.active} onClick={p.onRetryGalaxy}>
                重试银河
              </button>
            </div>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={p.starfield.enabled}
              disabled={!p.active}
              onChange={p.onStarfield}
            />
            背景星空
          </label>
          <p className="muted" role="status" aria-label="背景星空状态">
            {!p.starfield.enabled
              ? "星空已关闭"
              : `${p.starfield.loading ? "星空加载中" : "星空数据"}：${p.starfield.readyLayers}/${p.starfield.totalLayers} 层 · ${p.starfield.pointCount.toLocaleString()} 点`}
          </p>
          {p.starfield.error && (
            <div role="alert">
              <p>星空部分资源未就绪：{p.starfield.error}</p>
              <button
                disabled={!p.active || p.starfield.loading}
                onClick={p.onRetryStarfield}
              >
                重试星空
              </button>
            </div>
          )}
          <details className="muted">
            <summary>场景与深空数据诊断</summary>
            <details>
              <summary>相机只读诊断</summary>
              <pre>
                {p.cameraDebug
                  ? JSON.stringify(p.cameraDebug, null, 2)
                  : "渲染器尚未提供相机诊断"}
              </pre>
            </details>
            <dl aria-label="DYN缓存诊断">
              <dt>缓存记录 / 上限</dt>
              <dd>
                {p.dataCache?.records ?? 0} /{" "}
                {p.dataCache?.maxRecords ?? 1000000}
              </dd>
              <dt>位置 / 姿态缓存项</dt>
              <dd>
                {p.dataCache?.positionEntries ?? 0} /{" "}
                {p.dataCache?.orientationEntries ?? 0}
              </dd>
              <dt>来源项</dt>
              <dd>{p.dataCache?.provenance ?? 0}</dd>
            </dl>
            <p className="muted">
              统计解码记录与缓存项数量，非 JavaScript 堆内存字节。
            </p>
            <dl aria-label="深空资源诊断">
              <dt>目标 / 就绪 / 当前层级</dt>
              <dd>
                {[p.galaxy.desiredLod, p.galaxy.readyLod, p.galaxy.currentLod]
                  .map((v) => (v === undefined || v < 0 ? "—" : String(v + 1)))
                  .join(" / ")}
              </dd>
              <dt>过渡进度</dt>
              <dd>
                {p.galaxy.blend === undefined
                  ? "—"
                  : `${Math.round(p.galaxy.blend * 100)}%`}
              </dd>
              <dt>已载入瓦片</dt>
              <dd>{p.galaxy.loadedTiles ?? "—"}</dd>
              <dt>背景纹理显存</dt>
              <dd>
                {p.galaxy.gpuBytes === undefined
                  ? "—"
                  : `${(p.galaxy.gpuBytes / 1048576).toFixed(2)} MiB / 64 MiB`}
              </dd>
              <dt>资源错误</dt>
              <dd>{p.galaxy.detail || p.starfield.error || "无"}</dd>
            </dl>
          </details>
          <label className="toggle">
            <input
              type="checkbox"
              checked={p.labels}
              disabled={!p.active}
              onChange={p.onLabels}
            />
            对象标签
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={p.trajectories}
              disabled={!p.active}
              onChange={p.onTrajectories}
            />
            轨道线
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={p.trails}
              disabled={!p.active}
              onChange={p.onTrails}
            />
            卫星拖尾
          </label>
          <p className="muted">
            行星椭圆是当前状态推导的瞬时轨道；天然卫星显示父体相对轨道，人造卫星拖尾显示有效覆盖内的过去轨迹，尾端随时间渐隐。
          </p>
        </aside>
      </div>
      <section className="timeline" aria-label="统一时间控制">
        <div>
          <p className="eyebrow">统一仿真时间</p>
          <output>{p.utc || "尚未设置时间"}</output>
          <small className="time-diagnostic">
            {p.epoch.toFixed(3)} J2000 TDB s
          </small>
        </div>
        <div className="time-summary" aria-live="off">
          <span>{p.playing ? formatRate(Number(p.rate)) : "已暂停"}</span>
          <span className={p.live ? "live-badge is-live" : "live-badge"}>
            {p.live ? "● LIVE" : "历史 / 仿真"}
          </span>
        </div>
        <button
          className="time-toggle"
          aria-expanded={timeExpanded}
          aria-controls="rate-controls"
          onClick={() => setTimeExpanded(!timeExpanded)}
        >
          {timeExpanded ? "收起时间栏 ▾" : "展开时间栏 ▴"}
        </button>
        <div
          id="rate-controls"
          className="rate-controls"
          hidden={!timeExpanded}
        >
          <button
            disabled={!p.active || (p.busy && !p.playing)}
            onClick={p.onPlay}
          >
            {p.playing ? "Ⅱ 暂停" : "▶ 播放"}
          </button>
          <button
            aria-label="降低播放倍率"
            disabled={!p.active || p.busy || Number(p.rate) <= TIME_RATES[0]}
            onClick={() => p.onRate(String(adjacentRate(Number(p.rate), -1)))}
          >
            −
          </button>
          <label className="rate-slider">
            播放速率 · {formatRate(Number(p.rate))}
            <input
              aria-label="播放速率"
              aria-valuetext={formatRate(Number(p.rate))}
              type="range"
              min="0"
              max="100"
              step="1"
              disabled={!p.active || p.busy}
              value={rateToSliderIndex(Number(p.rate))}
              onChange={(e) =>
                p.onRate(String(TIME_RATES[Number(e.target.value)]))
              }
            />
          </label>
          <button
            aria-label="提高播放倍率"
            disabled={!p.active || p.busy || Number(p.rate) >= TIME_RATES[100]}
            onClick={() => p.onRate(String(adjacentRate(Number(p.rate), 1)))}
          >
            +
          </button>
          <button disabled={!p.active || p.busy} onClick={() => p.onRate("1")}>
            1× 速度
          </button>
        </div>
        <button
          className="time-detail-toggle"
          data-panel="time"
          aria-expanded={panel === "time"}
          aria-controls="time-panel"
          onClick={() => togglePanel("time")}
        >
          日期与跳转
        </button>
        <div
          id="time-panel"
          className="time-panel tool-panel"
          hidden={panel !== "time"}
        >
          <button
            className="close-panel"
            aria-label="关闭日期跳转"
            onClick={closePanel}
          >
            ×
          </button>
          <h2>日期与跳转</h2>
          <label>
            UTC日期
            <input
              type="datetime-local"
              value={p.utcJump}
              onChange={(e) => p.onUtcInput(e.target.value)}
            />
          </label>
          <button disabled={!p.active || p.busy} onClick={p.onUtcJump}>
            跳转日期
          </button>
          <label>
            跳转到 TDB 秒
            <input
              value={p.jump}
              onChange={(e) => p.onJumpInput(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <button disabled={!p.active} onClick={p.onJump}>
            跳转
          </button>
        </div>
        <button disabled={!p.active} onClick={p.onNow}>
          当前时间
        </button>
      </section>
      {fullscreenError && (
        <p className="error" role="alert">
          {fullscreenError}
        </p>
      )}
      {p.error && (
        <p className="error" role="alert">
          {p.error}
        </p>
      )}
      <footer>
        真实数据按需加载 · 覆盖、来源与加载状态可追溯 · 科学数据可用性与 GPU
        效果分别核验
      </footer>
    </main>
  );
}
