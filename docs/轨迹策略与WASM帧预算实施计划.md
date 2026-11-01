# 轨迹策略与WASM帧预算实施计划

> For agentic workers: use subagent-driven-development for isolated implementation and review; root integrates shared contracts and runs full verification.

Goal: 消费28个轨迹动作并贯通60/30fps预算，保留完整科学时间及现有NASA对齐行为。
Architecture: TS声明式阶段策略和可恢复采样经受控SDK发布；Rust统一渲染节拍、复用轨迹缓冲；宿主只调度有界工作并低频暴露诊断。
Tech Stack: Bevy0.19.1/Rust/WASM，TypeScript/Next，现有DYN求值，无新增全量引擎依赖。

## Global constraints

当前codex/bevy-planning原地继续，用户已要求合入当前工作分支，不创建新分支或触碰冻结分支。九个既有CRLF状态及无关未跟踪资源不提交。执行已批准《轨迹策略与WASM帧预算设计》的60fps上限、超预算30fps、2ms非关键分片和真实测量门槛；不缩短拖尾、不伪造缺数据、不混入Nyx。子任务不单独提交或改版本；root在完整验证后统一递增补丁、更新CHANGELOG、提交推送和gh跟踪。

## Task 1: 声明式轨迹策略

Files: platform/eyes-trail-policy.ts，新建platform/eyes-trail-phases.json、platform/tests/eyes-trail-phases.test.ts。
Consumes: 已审计coverage-actions.json及原始TrailComponent/目录。
Produces: eyesTrailPhase(id,epoch)返回稳定冻结的起止、相对时间、参考体、参考姿态和可见策略；eyesTrailBoundaries(id)返回有限端点。所有退出先于进入，默认重算。

- [x] 写失败回归，独立计算九对象28槽位端点±epsilon、精确共享端点、正倒序、默认值恢复和源码hash。
- [x] Run `node --test platform/tests/eyes-trail-phases.test.ts`，先确认缺失策略失败。
- [x] 固定白名单字面量实现，不运行源码回调；复用现有显式length规则。
- [x] 重跑策略及现有eyes-trail-policy测试，报告接口供root集成。

## Task 2: Rust真实渲染节拍与诊断

Files: core/src/renderer.rs，新建core/src/frame_budget.rs，必要core/src/lib.rs/wasm.rs；不更改轨迹策略字段。
Consumes: 单调墙钟、实际CPU更新时间、可见性。
Produces: 60/30节拍控制与有界诊断快照；测试可驱动模拟时间。必须约束Bevy实际呈现路径，不能只限制宿主RAF。优先使用锁定Bevy/Winit调度，禁止主线程sleep/忙等。

- [x] 写模拟高刷/事件洪流、2秒降档、10秒恢复、后台恢复和无补帧循环失败测试。
- [x] 核对本机锁定crate源码与实际浏览器runner，选择可真正执行的限帧入口。
- [x] 实现节拍、滞回及有界分位统计，GPU时间不支持保持缺省。
- [x] Run `cargo test --manifest-path core/Cargo.toml --features browser-render frame_budget`，再编译wasm目标；保留相机/输入事件语义。

## Task 3: 可恢复轨迹采样

Files: platform/adaptive-trail.ts、对应tests；新建web/lib/trajectory-work.ts及测试。root接入solar-system.ts和solar-workspace.ts。
Consumes: 有界位置求值函数、时间窗/点数/边界、修订token及取消信号。
Produces: 可恢复step(deadline,stepLimit)任务，同步旧接口保持等价；主机队列最多2个计算任务，按对象合并最新修订、每次至多提交一个结果。

- [x] 写同步/分片等价、每片步数、取消/过期不提交、轮转及队列上限失败测试。
- [x] Run `node --test platform/tests/adaptive-trail.test.ts web/lib/trajectory-work.test.ts`。
- [x] 使用可恢复状态机细分，不把同一同步函数放进Promise伪装异步。每次调度必须实际让出浏览器事件循环。
- [x] 新旧接口结果含完整端点和真实断点，失败保持明确状态。

## Task 4: root集成数据/契约/网格与诊断

Files: platform/solar-system.ts、trail-history.ts、trajectory-contract.ts、plugin-host.ts、core-port.ts；core/src轨迹结构/校验/渲染；web/lib/solar-workspace.ts、web诊断入口。

- [x] 用失败回归验证参考体历史姿态公式、绝对起点、Juno参考体、可见策略、缓存修订及历史预算失败恢复。
- [x] 字段由TS和Rust双重校验；保留所属会话、来源和清理，不开放Bevy对象。
- [x] 宿主时间独立推进，分片工作按2ms及数量上限调度；阶段/选择改变取消旧工作；隐藏暂停绘制并重置计时锚点。
- [x] 轨迹mesh复用容量，静态数据不重复上传；高亮/当前姿态/显示原点与几何修订分离。计时后验证收益，不以平均FPS代替长帧检查。
- [x] 更新SDK技能书、文档和诊断导出；固定窗口统计并区分CPU/实际呈现/不可用GPU计时。

## Task 5: 集中验证与提交

- [ ] 先采集生产基线，再以相同环境对照；固定对象、FOV、倍率及视口，至少每场景60秒，记录p50/p95/p99、长任务和最坏1秒。
- [x] Run `pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，必须exit0。
- [ ] 实际GPU复测总览、地月、木星、ISS/LRO/MRO/Psyche/Juno及九策略边界，快速选择/缩放/标签/图层/模型阶段/隐藏恢复不能回归。保存截图、日志和指标；未达门槛修复后重测，不放宽阈值。
- [ ] 独立最终审查全部diff；只暂存本批文件，git diff --cached --check通过后提交推送，gh核验远端状态，仍运行不得报通过。

## 最终验证状态

八类场景最终候选暖态采样均超过100秒，窗口p95最大36.4ms、p99最大43.7ms，各自采样期间新增>50ms长任务0；完整检查再次退出0。九对象27个真实边界求值ready，所有槽位端点正倒序由回归覆盖。已人工验证中文搜索、选择后立即缩放、跟随参考及拖尾图层恢复。独立最终代码审查无关键阻塞。

完整GPU边界截图、每次GPU完成时间与上传字节量尚未具备，隐藏恢复/退出生命周期主要由自动测试覆盖，不能将Task5的所有人工交互项打勾。既有源不可用和近距构图/光照问题另列evidence/README，不能称为NASA全功能视觉验收。
