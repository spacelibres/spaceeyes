import { STARTUP_STAGES, type StartupProgress } from "../lib/startup-progress";

export default function LoadingScene({
  progress,
  detail,
  planets,
  onCancel,
}: {
  progress: StartupProgress;
  detail: string;
  planets?: { ready: number; total: number; failed: number };
  onCancel: () => void;
}) {
  const percent = (progress.completedStages / progress.totalStages) * 100;
  return (
    <div className="scene-loading" aria-label="三维场景加载" aria-busy="true">
      <div className="loading-emblem" aria-hidden="true">
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" />
          <circle
            className="loading-orbit"
            cx="60"
            cy="60"
            r="54"
            pathLength="100"
            strokeDasharray={`${percent} 100`}
          />
        </svg>
        <img src="/icon.svg" alt="" width="64" height="64" />
      </div>
      <p className="loading-kicker">SPACE EYES</p>
      <h2>正在进入三维工作区</h2>
      <p className="loading-detail" role="status">
        {detail || progress.label}
      </p>
      <div
        className="loading-progress"
        role="progressbar"
        aria-label="初始化阶段进度"
        aria-valuemin={0}
        aria-valuemax={progress.totalStages}
        aria-valuenow={progress.completedStages}
        aria-valuetext={`已完成 ${progress.completedStages}/${progress.totalStages} 个准备阶段，${progress.label}`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="loading-caption">
        <span>阶段进度</span>
        <span>
          {progress.completedStages} / {progress.totalStages}
        </span>
      </div>
      <ol className="loading-stages">
        {STARTUP_STAGES.map(([id, , name], index) => (
          <li
            key={id}
            className={
              index < progress.completedStages
                ? "is-complete"
                : id === progress.stage
                  ? "is-current"
                  : ""
            }
            aria-current={id === progress.stage ? "step" : undefined}
          >
            <span aria-hidden="true">
              {index < progress.completedStages
                ? "✓"
                : String(index + 1).padStart(2, "0")}
            </span>
            {name}
          </li>
        ))}
      </ol>
      {progress.stage === "data" && planets && (
        <p className="loading-resources">
          行星显示资源 {planets.ready} / {planets.total} 已就绪
          {planets.failed ? ` · ${planets.failed} 项暂不可用` : ""}
        </p>
      )}
      <button className="loading-cancel" onClick={onCancel}>
        取消加载
      </button>
    </div>
  );
}
