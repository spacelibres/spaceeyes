"use client";
import { useEffect, useRef, useState } from "react";
import { SceneGesture } from "../lib/scene-gesture";
export type CatalogEntry = {
  id: string;
  name: string;
  parentId?: string;
  radiusKm: number;
};
export type WorkspaceViewProps = {
  catalog: CatalogEntry[];
  selected: string;
  search: string;
  setSearch: (v: string) => void;
  startupMs?: number;
  active: boolean;
  busy: boolean;
  phase: string;
  error: string;
  epoch: number;
  playing: boolean;
  rate: string;
  source: string;
  coverage: string;
  dataStatus: string;
  view: string;
  labels: boolean;
  trajectories: boolean;
  onStart: () => void;
  onStop: () => void;
  onSelect: (id: string) => void;
  onPick: (u: number, v: number) => Promise<boolean>;
  onFocus: () => void;
  onFollow: () => void;
  onOverview: () => void;
  onView: (v: string) => void;
  onPlay: () => void;
  onRate: (v: string) => void;
  jump: string;
  onJumpInput: (v: string) => void;
  onJump: () => void;
  onNow: () => void;
  utc: string;
  utcJump: string;
  onUtcInput: (v: string) => void;
  onUtcJump: () => void;
  onLabels: () => void;
  onTrajectories: () => void;
};
export default function WorkspaceView(p: WorkspaceViewProps) {
  const gesture = useRef(new SceneGesture());
  const pickRevision = useRef(0);
  useEffect(
    () => () => {
      pickRevision.current++;
      gesture.current.cancel();
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
  const canObserve =
    p.active && Boolean(object) && p.dataStatus.startsWith("ready");
  const matches = p.catalog.filter((o) =>
    `${o.name} ${o.id}`.toLowerCase().includes(p.search.toLowerCase()),
  );
  return (
    <main
      className="immersive"
      onKeyDown={(event) => {
        if (event.key === "Escape" && panel) {
          event.stopPropagation();
          closePanel();
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
          <a href="/diagnostics">数据诊断</a>
        </div>
      </header>
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
            style={{ visibility: p.active ? "visible" : "hidden" }}
            onPointerDown={(event) => gesture.current.begin(event)}
            onPointerMove={(event) => gesture.current.move(event)}
            onPointerCancel={() => gesture.current.cancel()}
            onPointerLeave={() => gesture.current.cancel()}
            onPointerUp={(event) => {
              const point = gesture.current.end(event);
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
          <div className="view-controls">
            <label>
              观察视角
              <select
                disabled={!p.active}
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
            <button disabled={!canObserve || p.busy} onClick={p.onFollow}>
              跟随
            </button>
          </div>
          <dl>
            <dt>数据状态</dt>
            <dd>{p.dataStatus}</dd>
            <dt>科学来源</dt>
            <dd>{p.source}</dd>
            <dt>有效覆盖 · J2000 TDB 秒</dt>
            <dd>{p.coverage}</dd>
            {object && (
              <>
                <dt>参考半径</dt>
                <dd>{object.radiusKm.toLocaleString()} km</dd>
              </>
            )}
          </dl>
          {object && (
            <section>
              <h3>关联对象</h3>
              {p.catalog
                .filter(
                  (o) => o.parentId === object.id || o.id === object.parentId,
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
          <h3>显示图层</h3>
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
          <p className="muted">
            椭圆显示当前状态推导的瞬时轨道，不代表完整周期的实测路径；非闭合轨道保留有效时间路径。
          </p>
        </aside>
      </div>
      <section className="timeline" aria-label="统一时间控制">
        <div>
          <p className="eyebrow">统一仿真时间</p>
          <output>{p.utc || "尚未设置时间"}</output>
          <small>{p.epoch.toFixed(3)} J2000 TDB s</small>
        </div>
        <button disabled={!p.active} onClick={p.onPlay}>
          {p.playing ? "Ⅱ 暂停" : "▶ 播放"}
        </button>
        <label>
          播放速率
          <select
            disabled={!p.active}
            value={p.rate}
            onChange={(e) => p.onRate(e.target.value)}
          >
            {["-86400", "-3600", "-60", "-1", "1", "60", "3600", "86400"].map(
              (v) => (
                <option key={v} value={v}>
                  {Number(v).toLocaleString()} ×
                </option>
              ),
            )}
          </select>
        </label>
        <button
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
