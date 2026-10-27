// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserSession, initialStatus, type ViewStatus } from "../lib/session";
export default function Page() {
  const mount = useRef<HTMLDivElement>(null);
  const host = useRef<BrowserSession | null>(null);
  const generation = useRef(0);
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<ViewStatus>(initialStatus);
  useEffect(() => {
    if (!enabled || !mount.current) return;
    const id = ++generation.current;
    setStatus(initialStatus);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "三维演示场景");
    canvas.dataset.testid = "scene-canvas";
    mount.current.append(canvas);
    const instance = new BrowserSession(canvas, (value) => {
      if (generation.current === id) setStatus(value);
    });
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
  }, [enabled]);
  const ready = enabled && status.phase === "运行中";
  return (
    <main>
      <header>
        <div>
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
            合成场景 <span>球体 / 三角网格</span>
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
          </div>
          <dl>
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
              <dt>资源容量预留</dt>
              <dd data-testid="resources" data-bytes={status.resourceBytes}>
                {(Number(status.resourceBytes) / 1048576).toFixed(2)} MiB
              </dd>
            </div>
          </dl>
          <p className="hint">
            时间基准：TT / 显式演示历元。当前使用合成数据，不包含真实星历。
          </p>
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
      <footer>
        <span>SPACEEYES · 0.0.1</span>
        <span>真实浏览器绘制 · 合成数据</span>
      </footer>
    </main>
  );
}
