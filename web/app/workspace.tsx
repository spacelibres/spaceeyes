"use client";
import { useEffect, useRef, useState } from "react";
import { PluginHost, type PluginContext } from "../../platform/plugin-host.ts";
import { WasmCorePort } from "../../platform/wasm-core-port.ts";
import type { WasmCore } from "../../core/pkg-web/spaceeyes_core";
import { parseEpoch, boundedEpoch, onceAsync } from "../lib/controls";
type Runtime = {
  core: WasmCore;
  host: PluginHost;
  sdk: PluginContext;
  frame: number;
  closed: boolean;
  release: () => Promise<void>;
};
export default function Workspace() {
  const rateRef = useRef("1");
  const runtime = useRef<Runtime | null>(null),
    mounted = useRef(true),
    started = useRef(false);
  const [phase, setPhase] = useState("尚未启动"),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0),
    [playing, setPlaying] = useState(false),
    [rate, setRate] = useState("1"),
    [jump, setJump] = useState("0"),
    [visual, setVisual] = useState("pending"),
    [active, setActive] = useState(false);
  async function dispose() {
    const r = runtime.current;
    if (!r || r.closed) return;
    r.closed = true;
    cancelAnimationFrame(r.frame);
    try {
      await r.release();
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      r.core.stop_renderer();
      r.core.free();
      runtime.current = null;
      if (mounted.current) {
        setActive(false);
        setPhase("已释放 · 刷新页面重新进入");
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      mounted.current = false;
      void dispose();
    };
    window.addEventListener("pagehide", hide);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", hide);
      void dispose();
    };
  }, []);
  const invoke = (f: (r: Runtime) => void) => {
    try {
      const r = runtime.current;
      if (!r || r.closed) throw Error("核心未运行");
      f(r);
    } catch (e) {
      setError(String(e));
    }
  };
  async function start() {
    if (started.current) return;
    started.current = true;
    setPhase("加载WASM");
    let core: WasmCore | undefined;
    let host: PluginHost | undefined;
    try {
      const url = "/wasm/spaceeyes_core.js";
      const module = await import(/* webpackIgnore: true */ url);
      await module.default();
      if (!mounted.current) return;
      core = new module.WasmCore();
      core!.register_asset("model:juno", "models/juno/Juno.gltf", "model");
      host = new PluginHost(new WasmCorePort(core!));
      let sdk!: PluginContext;
      host.register(
        {
          id: "spaceeyes.verification",
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
        },
      );
      await host.enable("spaceeyes.verification", [
        "data.publish",
        "camera.control",
        "time.control",
        "scene.visual",
      ]);
      if (!mounted.current) {
        await host.shutdown();
        core!.free();
        return;
      }
      const r: Runtime = {
        core: core!,
        host,
        sdk,
        frame: 0,
        closed: false,
        release: onceAsync(() => host!.shutdown()),
      };
      runtime.current = r;
      const publish = () =>
        sdk.data.publish("fixture:juno", {
          positionKm: [1e12, 0, 0],
          radiusKm: 0.02,
          epochTdbSeconds: r.core.epoch(),
          coverageTdbSeconds: [0, 1e9],
          frame: "ICRF",
          source: "synthetic technical verification; not mission ephemeris",
        });
      publish();
      sdk.camera.focus("fixture:juno");
      sdk.visual.set("fixture:juno", {
        kind: "model",
        assetId: "model:juno",
        scene: 0,
        scaleKmPerUnit: 0.001,
      });
      r.core.start_renderer("#spaceeyes-canvas");
      setActive(true);
      setPhase("插件已启用 · Bevy运行中");
      let last: number | undefined;
      const frame = (now: number) => {
        if (r.closed) return;
        try {
          r.core.tick(last === undefined ? 0 : (now - last) / 1000);
          last = now;
          const bounded = boundedEpoch(r.core.epoch());
          if (bounded.boundary) {
            sdk.time.setPlayback(false, Number(rateRef.current));
            sdk.time.seek(bounded.epoch);
            setError("已到合成夹具时间覆盖边界，播放暂停");
          }
          publish();
          setEpoch(r.core.epoch());
          setPlaying(r.core.playing());
          const status = sdk.visual.status("fixture:juno");
          setVisual(status?.phase ?? "pending");
          if (status?.phase === "failed")
            setError(status.detail ?? "资源加载失败");
          r.frame = requestAnimationFrame(frame);
        } catch (e) {
          setError(String(e));
          void dispose();
        }
      };
      r.frame = requestAnimationFrame(frame);
    } catch (e) {
      setError(String(e));
      setPhase("启动失败");
      if (runtime.current) {
        await dispose();
      } else {
        if (host) await host.shutdown().catch(() => {});
        if (core) {
          core.stop_renderer();
          core.free();
        }
      }
    }
  }
  return (
    <main>
      <header>
        <div>
          <img src="/spacelibre.svg" alt="spacelibre" width="240" />
          <h1>
            太空之眼 <small>SPACE EYES</small>
          </h1>
        </div>
        <span className="badge">技术验证工作区</span>
      </header>
      <p className="notice">
        合成位置与时间夹具 · 非真实天文/任务仿真 · NASA Juno模型仅验证资源接线
      </p>
      <div className="workspace">
        <aside>
          <h2>对象目录</h2>
          <button
            disabled={!active || visual !== "ready"}
            onClick={() => invoke((r) => r.sdk.camera.focus("fixture:juno"))}
          >
            Juno 模型夹具 · 选择并聚焦
          </button>
          <p>ICRF · 千米 · J2000 TDB秒</p>
          <p>
            来源：合成科学状态；模型：NASA Eyes Juno固定资源包。无NASA背书。
          </p>
          <h2>资源与插件</h2>
          <p role="status">{phase}</p>
          <p>模型状态：{visual}</p>
          <p>仅ready时开放聚焦。拖动环绕，滚轮缩放。</p>
          <button disabled={started.current} onClick={() => void start()}>
            启动三维工作区
          </button>
          <button disabled={!active} onClick={() => void dispose()}>
            停止并释放
          </button>
        </aside>
        <section className="viewport" aria-label="Bevy三维画布">
          <canvas id="spaceeyes-canvas" style={{ visibility: active ? "visible" : "hidden" }} />
          <span className="caption">BEVY / WASM · 技术夹具</span>
        </section>
      </div>
      <section className="timeline">
        <h2>时间控制</h2>
        <output>{epoch.toFixed(3)} TDB s</output>
        <button
          disabled={!active}
          onClick={() =>
            invoke((r) => r.sdk.time.setPlayback(!playing, Number(rate)))
          }
        >
          {playing ? "暂停" : "播放"}
        </button>
        <label>
          倍率{" "}
          <select
            disabled={!active}
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              rateRef.current = e.target.value;
              invoke((r) =>
                r.sdk.time.setPlayback(playing, Number(e.target.value)),
              );
            }}
          >
            {["-10", "-1", "1", "10", "100"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          跳时{" "}
          <input
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            aria-label="J2000 TDB秒"
          />
        </label>
        <button
          disabled={!active}
          onClick={() => invoke((r) => r.sdk.time.seek(parseEpoch(jump)))}
        >
          跳转
        </button>
        <p>有效覆盖：0–1,000,000,000 TDB秒。未接入真实DYN与UTC转换。</p>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>
        轨迹、姿态、真实DYN驱动的运动和完整NASA
        Eyes体验待实现。资源ready不代表GPU效果验收。
      </footer>
    </main>
  );
}
