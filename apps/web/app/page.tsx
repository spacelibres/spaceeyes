// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
"use client";
import { useEffect, useRef, useState } from "react";
import {
  BrowserSession,
  initialStatus,
  validateProjectFile,
  type ViewStatus,
} from "../lib/session";
export default function Page() {
  const mount = useRef<HTMLDivElement>(null);
  const host = useRef<BrowserSession | null>(null);
  const generation = useRef(0);
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<ViewStatus>(initialStatus);
  const [seekInput, setSeekInput] = useState("0");
  const [scene, setScene] = useState<string | null>(null);
  const [projectBytes, setProjectBytes] = useState<Uint8Array | undefined>();
  const [projectError, setProjectError] = useState<string | null>(null);
  useEffect(() => {
    setScene(new URLSearchParams(window.location.search).get("scene"));
  }, []);
  const solar = scene === "solar";
  useEffect(() => {
    if (!enabled || !mount.current) return;
    const id = ++generation.current;
    setStatus(initialStatus);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "三维演示场景");
    canvas.dataset.testid = "scene-canvas";
    mount.current.append(canvas);
    const instance = new BrowserSession(
      canvas,
      (value) => {
        if (generation.current === id) setStatus(value);
      },
      projectBytes,
    );
    host.current = instance;
    return () => {
      host.current = null;
      canvas.remove();
      void instance
        .dispose()
        .then((value) => {
          if (generation.current === id) setStatus(value);
        })
        .catch((error) => {
          if (generation.current === id)
            setStatus({
              ...initialStatus,
              phase: "错误",
              error: String(error),
            });
        });
    };
  }, [enabled, projectBytes]);
  const ready = enabled && status.phase === "运行中";
  return (
    <main>
      <header>
        <div>
          <img
            className="brand"
            src="/brand/spacelibre-white.svg"
            alt="spacelibre"
            width="240"
            height="53"
          />
          <p className="eyebrow">SPACEEYES</p>
          <h1>探索，从一个视角开始</h1>
        </div>
        <span className="badge">浏览器三维原型</span>
      </header>
      <section className="workspace">
        <div className="viewport">
          <div ref={mount} className="canvas-mount" />
          {status.phase === "初始化" && enabled && (
            <div className="overlay">正在连接三维场景…</div>
          )}
          {!enabled && <div className="overlay">画布已卸载</div>}
          <div className="scene-label">
            {solar ? (
              <>
                太阳系星历 <span>NASA DYN / 显示压缩</span>
              </>
            ) : (
              <>
                合成场景 <span>球体 / 三角网格</span>
              </>
            )}
          </div>
        </div>
        <aside>
          <p className="eyebrow">场景控制</p>
          <h2>同一场景，实时呈现</h2>
          <p className="description">
            调整视角，观察材质与深度遮挡；播放时间时，场景使用同一仿真时钟。
          </p>
          <div className="controls">
            <button
              disabled={!ready}
              onClick={() => {
                void host.current?.togglePlayback().catch(() => {});
              }}
            >
              {status.playing ? "暂停" : "播放"}
            </button>
            <button
              disabled={!ready}
              onClick={() => {
                void host.current?.turnCamera().catch(() => {});
              }}
            >
              视角 +15°
            </button>
            <a href={solar ? "/" : "?scene=solar"}>
              {solar ? "返回演示场景" : "打开太阳系星历"}
            </a>
            <button
              data-testid="project-save"
              disabled={!ready}
              onClick={() => {
                void host.current
                  ?.exportProject()
                  .then((bytes) => {
                    const copy = new Uint8Array(bytes.byteLength);
                    copy.set(bytes);
                    const url = URL.createObjectURL(
                      new Blob([copy], { type: "application/octet-stream" }),
                    );
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = "spaceeyes-project.bin";
                    anchor.click();
                    setTimeout(() => URL.revokeObjectURL(url), 10_000);
                  })
                  .catch((error) => {
                    console.error("project save failed", error);
                  });
              }}
            >
              保存项目
            </button>
            <label>
              打开项目
              <input
                data-testid="project-open"
                type="file"
                accept=".bin,application/octet-stream"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file
                    .arrayBuffer()
                    .then(async (buffer) => {
                      const bytes = new Uint8Array(buffer);
                      if (!(await validateProjectFile(bytes))) {
                        setProjectError(
                          "项目文件无效或已损坏，当前场景未改变。",
                        );
                        return;
                      }
                      setProjectError(null);
                      setProjectBytes(bytes);
                    })
                    .catch(() => {});
                  event.target.value = "";
                }}
              />
            </label>
            {projectError && (
              <span role="alert" data-testid="project-error">
                {projectError}
              </span>
            )}
          </div>
          <section className="time-controls" aria-label="时间控制">
            <label>
              播放倍速
              <select
                aria-label="播放倍速"
                disabled={!ready}
                value={status.playbackRate}
                onChange={(event) => {
                  void host.current
                    ?.setPlaybackRate(Number(event.target.value))
                    .catch(() => {});
                }}
              >
                {[-16, -4, -1, -0.25, 0.25, 1, 4, 16].map((rate) => (
                  <option key={rate} value={String(rate)}>
                    {rate}×
                  </option>
                ))}
              </select>
            </label>
            <div className="controls">
              <button
                disabled={!ready || status.playing}
                onClick={() => {
                  void host.current?.stepSecond(-1).catch(() => {});
                }}
              >
                步退1秒
              </button>
              <button
                disabled={!ready || status.playing}
                onClick={() => {
                  void host.current?.stepSecond(1).catch(() => {});
                }}
              >
                步进1秒
              </button>
            </div>
            <label htmlFor="time-axis">时间轴 / 历元相对天</label>
            <input
              id="time-axis"
              data-testid="time-axis"
              type="range"
              min={-3650}
              max={3650}
              step={1}
              disabled={!ready || status.playing}
              defaultValue={0}
              onChange={(event) => {
                const days = Number(event.target.value);
                setSeekInput(String(days * 86400));
                void host.current
                  ?.seekSeconds(String(days * 86400))
                  .catch(() => {});
              }}
            />
            <p className="hint">
              时间轴按当前显式历元的天数偏移，不是 UTC 日期；暂停后可拖动。
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void host.current?.seekSeconds(seekInput).catch(() => {});
              }}
            >
              <label htmlFor="seek-time">目标时间 / 历元相对秒</label>
              <div className="seek-row">
                <input
                  id="seek-time"
                  type="text"
                  inputMode="decimal"
                  maxLength={64}
                  disabled={!ready || status.playing}
                  value={seekInput}
                  onChange={(event) => setSeekInput(event.target.value)}
                />
                <button type="submit" disabled={!ready || status.playing}>
                  跳转
                </button>
              </div>
            </form>
            <p className="hint">
              暂停后可步进或跳转，小数最多9位；相对当前显式历元，不是UTC日期。
            </p>
          </section>
          <dl>
            <div>
              <dt>相机模式</dt>
              <dd data-testid="camera-mode">{status.cameraMode}</dd>
            </div>
            {status.cameraTarget && (
              <div>
                <dt>跟随目标</dt>
                <dd data-testid="camera-target">{status.cameraTarget}</dd>
              </div>
            )}
            <div>
              <dt>状态</dt>
              <dd data-testid="phase">{status.phase}</dd>
            </div>
            <div>
              <dt>仿真时间 / 秒</dt>
              <dd data-testid="clock" data-nanos={status.clockNs}>
                {status.clockText}
              </dd>
            </div>
            <div>
              <dt>画布</dt>
              <dd data-testid="dimensions">
                {status.width} × {status.height}
              </dd>
            </div>
            <div>
              <dt>已呈现帧</dt>
              <dd data-testid="frames">{status.frameCount}</dd>
            </div>
            <div>
              <dt>场景对象</dt>
              <dd data-testid="objects">{status.objectCount}</dd>
            </div>
            <div>
              <dt>资源容量预留</dt>
              <dd data-testid="resources" data-bytes={status.resourceBytes}>
                {(Number(status.resourceBytes) / 1048576).toFixed(2)} MiB
              </dd>
            </div>
          </dl>
          <p className="hint">
            {solar
              ? "时间基准：TT / 显式演示历元；位置来自 NASA DYN 插件，并按显示比例压缩，不是科学尺度。"
              : "时间基准：TT / 显式演示历元。当前使用合成数据，不包含真实星历。"}
          </p>
          <section
            className="selection"
            aria-label="对象信息"
            aria-live="polite"
          >
            <h3>对象信息</h3>
            <p data-testid="selection-status">{status.selectionText}</p>
            {status.selectedEphemeris && (
              <p className="hint" data-testid="ephemeris">
                {status.selectedEphemeris}
              </p>
            )}
            {status.selected && (
              <dl>
                <div>
                  <dt>对象</dt>
                  <dd data-testid="selected-object">{status.selected.id}</dd>
                </div>
                <div>
                  <dt>类型</dt>
                  <dd data-testid="selected-kind">{status.selected.kind}</dd>
                </div>
                <div>
                  <dt>参考系</dt>
                  <dd data-testid="selected-frame">
                    {status.selected.reference}
                  </dd>
                </div>
                <div>
                  <dt>选中帧</dt>
                  <dd>{status.selected.sequence}</dd>
                </div>
              </dl>
            )}
            <div className="controls">
              <button
                disabled={!ready || !status.selected}
                onClick={() => {
                  void host.current?.focusSelected(false).catch(() => {});
                }}
              >
                聚焦对象
              </button>
              <button
                disabled={!ready || !status.selected}
                onClick={() => {
                  void host.current?.focusSelected(true).catch(() => {});
                }}
              >
                跟随对象
              </button>
            </div>
            <button
              className="secondary"
              disabled={!ready}
              onClick={() => {
                void host.current?.resetCamera().catch(() => {});
              }}
            >
              恢复视角
            </button>
          </section>
          <button
            className="secondary"
            onClick={() => setEnabled((value) => !value)}
          >
            {enabled ? "卸载画布" : "重新挂载"}
          </button>
        </aside>
      </section>
      {status.error && (
        <p role="alert" className="error">
          {status.error}
        </p>
      )}
      {status.actionError && (
        <p role="alert" className="error">
          {status.actionError}
        </p>
      )}
      <footer>
        <span>SPACEEYES · 0.0.1</span>
        <span>真实浏览器绘制 · 合成数据</span>
      </footer>
    </main>
  );
}
