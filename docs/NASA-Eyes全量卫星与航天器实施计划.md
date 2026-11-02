# NASA Eyes 卫星与航天器实施计划

> For agentic workers: use subagent-driven-development for implementation and task/whole-change review. 当前分支原地执行，不创建或操作冻结分支。

Goal: 已确认的 622 项目录与真实模型、任务数据按需接入现有三维工作区。

Architecture: 领域目录及 DYN 求值在 TS 数据插件；资源服务按白名单获取/转换模型；Rust/Bevy 保持显示与坐标权威。元数据与模型不嵌入 WASM。

Tech Stack: TypeScript、Next.js、Rust/Bevy 0.19.1、glTF 2、原 NASA DYN、成熟 glTF/纹理转换库。

## 约束

- codex/bevy-planning 原地迭代；development/core-0.0.1 已冻结。
- 初始仍为太阳系总览，全部目录可搜索，资源按需要获取。
- 不伪造位置、半径、姿态、覆盖或模型；缺失三项保留明确状态并继续核对来源。
- 轨迹每会话 4096 点；按系统与目标分配，不以全量目录为由取消预算。
- 每个完整实现里程碑集中检查、版本递增、CHANGELOG、提交推送和 gh 跟踪。

## Task 1：目录、父体与任务数据

Files: platform/eyes-catalog.ts、platform/eyes-catalog.json、tools/import-eyes-catalog.mjs、platform/solar-system.ts、platform/dyn-decoder.ts、platform/dyn-evaluator.ts、web/lib/solar-dyn-server.ts、对应 tests。

接口：solarCatalog 为全量标准化目录；默认 load() 只加载原十对象。增加 parentAt(id,epoch) 与 display/轨道控制器元数据；position() 递归按当前父体组合，循环与缺数据拒绝。保持 load(ids,epoch,orientationIds)、status/provenance/trajectorySamples 兼容。

- [x] 先写回归：622 项存在、131 模型去重、未定义对象不伪就绪；Juno 父体在真实阶段切换；ISS 使用声明路径。
- [x] 静态 AST 导入领域数据，生成可复核来源和受控表达式；构建不依赖参考仓库。
- [x] 按声明控制器及有效覆盖接入 DYN，补齐实际使用的位置/姿态求值，不越界外推。
- [x] 运行
ode --test platform/tests/*.test.ts web/lib/solar-dyn-server.test.ts` 和两个 TS 编译器；检查原十对象回归。

## Task 2：全量资源服务

Files: web/lib/eyes-assets.ts、web/app/assets/eyes/[id]/[...path]/route.ts、web/package.json、工具与资源清单。

接口：模型入口 `/assets/eyes/{id}/model.glb`；六面 `/assets/eyes/{id}/face-{face}.png`。仅目录已声明 id/path 可访问；服务按需获取、缓存、验证依赖，输出 Bevy 可加载资源。对象模型局部变换保留，模型单位标准化至 km，不改变科学状态。

- [x] 写失败回归：未知 id、越界路径、重定向及模型依赖失败均拒绝；共享资源复用且未选择时不请求模型。
- [x] 核对全部 131 个入口；已发现 9 个 Draco、8 个 Basis、15 个纹理变换、4 个 WebP 扩展入口，按成熟转换库输出兼容 glTF/GLB。
- [x] 支持父体球面卫星和非球面模型；登记实际资产，不以中性球体冒充航天器。
- [x] 运行资源服务回归，并对 Juno、ISS、Phobos、压缩模型执行真实资源转换与加载。

## Task 3：宿主完整场景

Files: web/lib/solar-workspace.ts、web/app/workspace-view.tsx、web/integration/solar-workspace.test.ts、必要 SDK/核心显示资源文件。

接口：保持 WorkspaceRuntime 原方法，增加目录类别/系统导航、有效任务时间入口。按选中对象和当前系统决定加载集合、模型升级和轨迹预算。

- [x] 写真实 WASM 回归：总览仍只加载基本状态，选中卫星带父体，飞船使用模型；快速切换/取消不复活旧对象。
- [x] 接通全量可搜索目录、父体关联、系统显示、聚焦/跟随、历史任务跳时及模型/数据分别报告。
- [x] 集中检查原地球—月球—总览及全部新对象路径，保留品牌与资源按需策略。

## Task 4：集中验收与交付

- [x] 固定全量清单统计目录、实体、数据、资源和 GPU 各自状态，缺项不计通过。
- [x] 完整运行 `pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`。
- [x] 实际 GPU 核验木星四大卫星、火卫一/二、ISS、Juno 与跨父体/历史任务，观察模型、轨迹、时间、取消、返回总览。
- [x] 更新 SDK 技能、证据与 CHANGELOG；版本递增，明确未解决资源项，提交推送并 gh 查询 CI。

## 进度

实现、集中检查及代表对象 GPU 验证已完成；交付证据见 evidence/eyes-expansion-0.0.19/README.md。619 项状态在核验时间可求值、131/131 模型和 108/108 表面图转换成功；3 项源定义缺失明确不可用。GPU 只对证据所列样本验收，不能报告 622 项逐一 GPU 通过；最终提交及远端 CI 以实际 Git/gh 结果为准。
