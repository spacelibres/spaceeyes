"use client";
import { useEffect, useRef, useState } from "react";
import {
  solarWorkspaceSettings,
  restoreSolarWorkspaceSettings,
} from "../lib/solar-settings";
import WorkspaceView from "./workspace-view";
import {
  createWorkspace,
  initialSnapshot,
  workspaceCatalog,
  type WorkspaceRuntime,
} from "../lib/solar-workspace";

export default function Workspace() {
  const [state, setState] = useState(initialSnapshot);
  const [stellarSettings, setStellarSettings] = useState(
    solarWorkspaceSettings,
  );
  const [actionError, setActionError] = useState("");
  const actionRevision = useRef(0);
  const [search, setSearch] = useState("");
  const [jump, setJump] = useState("0");
  const [utcJump, setUtcJump] = useState("");
  const runtime = useRef<WorkspaceRuntime | null>(null);
  const controller = useRef<AbortController | null>(null);
  const started = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      controller.current?.abort();
      void runtime.current?.dispose();
    };
    // Scrollable HTML controls overlay the canvas. Keep their wheel events out
    // of winit's window-level input listeners while preserving native scrolling.
    const uiWheel = (event: WheelEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("#info-panel,#catalog-panel,#time-panel")
      )
        event.stopImmediatePropagation();
    };
    window.addEventListener("wheel", uiWheel, { capture: true, passive: true });
    window.addEventListener("pagehide", leave);
    return () => {
      mounted.current = false;
      window.removeEventListener("wheel", uiWheel, true);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);
  const action = <T,>(
    run: (value: WorkspaceRuntime) => T | Promise<T>,
  ): Promise<T | undefined> => {
    const revision = ++actionRevision.current;
    setActionError("");
    const currentRuntime = runtime.current;
    if (!currentRuntime) return Promise.resolve(undefined);
    return Promise.resolve()
      .then(() => run(currentRuntime))
      .catch((error) => {
        if (mounted.current && revision === actionRevision.current)
          setActionError(String(error));
        return undefined;
      });
  };
  const start = async () => {
    ++actionRevision.current;
    setActionError("");
    if (started.current) {
      if (!state.active && !state.busy) {
        const next = new URL(window.location.href);
        next.searchParams.set("enter", "1");
        window.location.assign(next);
      }
      return;
    }
    started.current = true;
    controller.current = new AbortController();
    setState((current) => ({
      ...current,
      busy: true,
      phase: "正在进入太阳系工作区",
    }));
    try {
      let initialSolar = solarWorkspaceSettings();
      try {
        initialSolar = restoreSolarWorkspaceSettings(
          localStorage.getItem("spaceeyes.solar-tuning.v1"),
        );
      } catch (error) {
        setActionError(`本机太阳配置无效，已采用推荐参数：${String(error)}`);
      }
      setStellarSettings(initialSolar);
      runtime.current = await createWorkspace(
        "#spaceeyes-canvas",
        (value) => {
          if (mounted.current) setState(value);
        },
        controller.current.signal,
        {
          stellarSettings: initialSolar,
          onStartup: (phase) => {
            if (mounted.current && !controller.current?.signal.aborted)
              setState((current) => ({ ...current, busy: true, phase }));
          },
        },
      );
    } catch (error) {
      if (mounted.current)
        setState((current) => ({
          ...current,
          active: false,
          busy: false,
          error: controller.current?.signal.aborted ? "" : String(error),
          phase: controller.current?.signal.aborted
            ? "工作区已取消，可重新进入"
            : "启动失败，可点击重新进入",
        }));
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new URL(window.location.href);
      next.searchParams.delete("enter");
      window.history.replaceState(null, "", next);
      void start();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <WorkspaceView
      stellarSettings={stellarSettings}
      onStellar={(settings) => {
        void action((value) => {
          const next = solarWorkspaceSettings(settings);
          value.tuneStellar(next);
          setStellarSettings(next);
        });
      }}
      galaxy={state.galaxy}
      fovDegrees={state.fovDegrees}
      onFov={(degrees) => action((value) => value.fieldOfView(degrees))}
      onGalaxy={() => action((value) => value.galaxy(!state.galaxy.enabled))}
      onRetryGalaxy={() => action((value) => value.galaxy(true))}
      starfield={state.starfield}
      onStarfield={() =>
        action((value) => value.starfield(!state.starfield.enabled))
      }
      onRetryStarfield={() => action((value) => value.retryStarfield())}
      catalog={workspaceCatalog}
      selected={state.selected}
      search={search}
      setSearch={setSearch}
      startupMs={state.startupMs}
      parentId={state.parentId}
      active={state.active}
      busy={state.busy}
      phase={state.phase}
      error={actionError || state.error}
      epoch={state.epoch}
      playing={state.playing}
      rate={String(state.rate)}
      source={state.source}
      coverage={state.coverage}
      dataStatus={state.dataStatus}
      view={state.view}
      labels={state.labels}
      trajectories={state.trajectories}
      trails={state.trails}
      onTrails={() => action((value) => value.trails(!state.trails))}
      jump={jump}
      onJumpInput={setJump}
      utc={state.utc}
      utcJump={utcJump}
      onUtcInput={setUtcJump}
      onUtcJump={() => action((value) => value.seekUtc(utcJump))}
      onStart={() => void start()}
      onStop={() => {
        controller.current?.abort();
        action((value) => value.dispose());
      }}
      onSelect={(id) => action((value) => value.select(id))}
      onPick={async (u, v) =>
        Boolean(await action((value) => value.pick(u, v)))
      }
      onFocus={() => action((value) => value.focus())}
      onFollow={() => action((value) => value.follow())}
      onOverview={() => action((value) => value.overview())}
      onView={(mode) =>
        action((value) =>
          value.view(mode as "orbit" | "top" | "front" | "side"),
        )
      }
      onPlay={() => action((value) => value.play(!state.playing, state.rate))}
      onRate={(rate) =>
        action((value) => value.play(state.playing, Number(rate)))
      }
      onJump={() =>
        action((value) => {
          if (!jump.trim()) throw new Error("请输入 J2000 TDB 秒");
          return value.seek(Number(jump));
        })
      }
      onNow={() => action((value) => value.now())}
      onMissionTime={() => action((value) => value.observeAvailable())}
      onLabels={() =>
        action((value) => value.layers(!state.labels, state.trajectories))
      }
      onTrajectories={() =>
        action((value) => value.layers(state.labels, !state.trajectories))
      }
    />
  );
}
