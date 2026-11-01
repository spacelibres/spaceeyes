export const STARTUP_STAGES = [
  ["module", "加载三维核心模块", "核心模块"],
  ["wasm", "下载并初始化 WASM", "显示引擎"],
  ["catalog", "连接天体目录与数据插件", "天体目录"],
  ["data", "加载八大行星轨道、姿态和表面资源", "行星数据"],
  ["renderer", "启动三维渲染器", "三维场景"],
] as const;
export type StartupStage = (typeof STARTUP_STAGES)[number][0] | "ready";
export type StartupProgress = {
  stage: StartupStage;
  label: string;
  completedStages: number;
  totalStages: number;
};
export function startupProgress(stage: StartupStage): StartupProgress {
  const index = STARTUP_STAGES.findIndex(([id]) => id === stage);
  if (stage !== "ready" && index < 0) throw Error("Unknown startup stage");
  return {
    stage,
    label: stage === "ready" ? "三维渲染器已启动" : STARTUP_STAGES[index][1],
    completedStages: stage === "ready" ? STARTUP_STAGES.length : index,
    totalStages: STARTUP_STAGES.length,
  };
}
