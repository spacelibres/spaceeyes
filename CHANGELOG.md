# CHANGELOG

项目：SPACEEYES｜统一开发版本：0.0.1

## [0.0.1] — 2026-10-27

- 2026-10-27：Engine新增ExecutorFeedback统一接收Result/Failed/Cancelled，复用Simulation状态机，禁止取消后的迟到结果重新提交；结果反馈只进入ResultReady，必须经Scene事务才能Completed。增加对应单元测试源码。未执行Cargo/CI测试，待VPS统一验证，版本仍为0.0.1。



- 2026-10-27：Resources新增代次化LeaseId与单次释放校验；Engine任务租约改用独立令牌。TaskExecutor新增尽力取消通知，Engine先标记取消再通知宿主。同步专项规范。真实异步执行、完整结果元数据和Proto仍待实现；构建测试未确认；版本保持0.0.1。


- 按规划实现Engine层任务与Resources逻辑租约关联：attach_task_resource、任务取消/失败、Seek旧代次失效、ResultReady提交成功、Engine关闭时回收任务租约；保持Simulation不直接拥有资源注册表。
- 增加任务租约生命周期单元测试源码，并同步Simulation与Resources规范。当前仍为内存级计数租约，未实现独立LeaseId/句柄代次、执行器强制取消或真实异步执行；Cargo/CI未取得通过证据。版本保持0.0.1。



- 全局核心迭代：Resources新增ResourceManager逻辑登记、字节预算、共享租约计数、禁止带租约释放及资源修订号；Engine统一资源操作入口，EngineSnapshot增加resource_revision。
- 修复Simulation执行器分发失败后可能重新派发同一任务的问题：先标记Running，失败则标记Failed，不再隐式重试。
- 已同步Resources规范并增加资源预算与租约单元测试源码。未实现任务资源租约自动绑定、真实异步执行、GPU资源和Proto；未取得Cargo/CI通过证据。版本保持0.0.1。



- 本轮Simulation：新增平台中立TaskExecutor接口、TaskBudget有界并发/排队策略、确定性ready任务分发与QueueFull/InvalidBudget错误。Engine接入有界任务登记和宿主执行器分发接口。
- 修复潜在时间一致性缺口：TaskResult进入ResultReady后，Engine在最终Scene提交前再次校验TimeGeneration与目标时刻，避免连续步进后同代次旧结果提交。
- 新增预算/分发/时间变化阻止提交的单元测试源码，并同步Simulation设计规范。当前只提供执行适配接口，尚未实现真实异步运行器、CPU时间预算或Resources字节预算。Cargo/CI仍未取得通过证据，版本保持0.0.1。



- Simulation继续实现：任务依赖登记与前置条件检查、稳定顺序就绪队列、Running/ResultReady/Completed状态分离、取消与失败处理、Seek后的旧代次任务失效、终止时取消未完成任务。
- Engine接入SimulationScheduler，并通过唯一Scene事务入口协调TaskResult提交；场景事务失败不会误标任务Completed。新增依赖顺序、取消、过期结果、Seek失效及事务冲突单元测试源码。
- 已同步Simulation规范。当前尚无异步执行器、任务预算、来源覆盖/参考系修订完整校验及Proto协议实现；Cargo/CI未取得通过证据，版本保持0.0.1。



- 新增Spatial动态TransformProvider trait与ProviderRef，可按显式TimeInstant查询变换；支持Engine受控注册、替换提供者，参考系图修订随之更新。
- 新增Simulation最小任务登记、任务状态及generation/目标时刻联合结果有效性检查；未引入NASA专用算法或直接Scene写入。
- 增加动态参考系与过时任务结果单元测试源码，并同步Spatial规范。尚未获得Cargo/CI执行通过证据；动态插值、速度导数、异步任务执行与Proto仍未实现。版本保持0.0.1。



- Spatial实现：新增FrameId参考系注册/删除、父子关系检查、图修订号、Vec3d/Quatd与刚体变换、逆变换和路径组合；严格要求显式TimeInstant，时间样本不匹配时返回错误，不推断星历。
- Engine集成Spatial图并在EngineSnapshot中提供frame_graph_revision；所有参考系写入经Engine入口。新增参考系链、逆变换、非交换旋转、非法父级、断开参考系及时间不匹配测试源码。
- 范围：当前只支持指定历元的静态刚体变换，不支持速度导数、时间插值、动态提供者、NASA DYN或Proto实现。已同步Spatial设计规范；Cargo/CI测试尚无通过证据，版本仍为0.0.1。



- 本轮继续完善Time与Engine：新增ClockSnapshot、play/pause、显式纳秒步进、负时长规范化、溢出保护、时钟修订号；Engine统一转发时间命令并更新快照序列。
- 新增时间步进、溢出不改变状态、播放/暂停代次不变、Engine时间命令幂等序列等单元测试源码；尚未获得Cargo/CI通过证据。
- 继续保持科学时间尺度和历元显式传入，未擅自确定NASA DYN的时间约定；本轮属于0.0.1开发迭代，未单独发布新版本。


- 开发迭代：Scene新增原子批量命令、乐观修订校验、组织父子关系无环约束、默认拒绝删除有子对象的父节点、确定性只读SceneSnapshot；Engine新增统一场景命令入口、时间跳转及基础EngineSnapshot。
- 新增对应Rust单元测试用例；这些测试尚未执行。当前EngineSnapshot仅为最小一致状态，不是含Spatial/Resources修订的最终FrameSnapshot。
- 代码风险：尚未实现公开Proto适配、Spatial图、资源生命周期、完整引擎状态机；Cargo与Rustc在当前执行环境不可用，尚无构建通过证据。


- 正式启动Rust核心工程开发，版本从0.0.0统一升级为0.0.1；基于已批准核心架构与ADR-001至009。
- 建立独立开发分支development/core-0.0.1、Cargo Workspace及核心crate基础结构；本版本为工程初始化，不宣称渲染或NASA插件完成。
- 版本升级严格按最小位+1、100进1；所有受控文档与代码统一0.0.1。
- 增加foundation/scene/time/engine最小实现与单元测试，其他crate仅保留模块边界；添加GitHub Actions cargo check/test工作流。
- 验证：当前执行环境未安装Cargo，无法本地运行；CI已配置，尚无通过证据。风险：科学时间尺度、Proto字段、GPU后端尚未冻结。

## [Unreleased]

### 2026-10-27 — 双仓库审计问题整改（规划文档）
- 原因：正式仓库版本、DYN迁移范围、来源许可、跨仓库版本治理四项审计问题。
- 修改：架构书统一规划版本0.0.0；新增文档与版本规范、技术可行性方案、DYN迁移与验证规范、第三方来源与许可台账、双仓库整改台账。
- 证据：solarsystem的Dynamo、ephemeris、runtime、tests、docs；spaceeyes主分支架构书。
- 验证：完成GitHub源码静态审查；未运行Rust/WASM、浏览器或完整CI测试。
- 风险/待办：NASA资产许可待核实；Rust迁移、Proto Schema及自动化门禁尚未实现。
- 版本：保持0.0.0；此为规划修订，不构成软件发布。

- 2026-10-27：确定NASA Dynamo解析为独立TypeScript数据源插件 `spaceeyes.nasa.dynamo`；直接按需加载在线DYN，内部解析与求值，公开接口仍用Proto；新增插件设计规范并同步架构与可行性方案。仅文档规划变更，未编写插件、未运行测试、版本保持0.0.0。

- 2026-10-27：定义官方插件001 `spaceeyes.nasa.dynamo`，新增接口、模块对象、数据契约、权限、AI技能书和验收规范 `docs/plugins/001-NASA-Dynamo-接口与验收.md`。仅设计文档，尚未实现或运行测试；统一版本保持0.0.0。

- 2026-10-27：新增《Rust核心引擎设计规范》v0.0.0，定义核心边界、模块与对象、空间精度、时钟调度、渲染、资源、Proto边界、WASM/Native和阶段门。仅规划文档，未实现代码或运行测试，版本保持0.0.0。

- 2026-10-27：新增Scene场景系统与SceneObject对象模型设计规范v0.0.0；明确对象身份、代次句柄、组织关系与参考系分离、生命周期、快照和Proto边界，列出六项待审定决策。仅规划文档，未实现代码或测试。

- 2026-10-27：新增Spatial空间与参考系系统设计规范v0.0.0，明确FrameGraph、时间相关变换、速度导数、多尺度精度与Scene/Time/Rendering边界；补充Scene身份和父对象删除的待审建议。仅规划文档，未实现或测试，版本保持0.0.0。

- 2026-10-27：新增Time仿真时间系统设计规范v0.0.0；定义唯一时钟、时间尺度与历元、播放状态机、固定步进、反向、跳转代次、异步失效、Proto边界和验收矩阵。仅规划文档，未编写代码或执行测试。

- 2026-10-27：新增《Simulation仿真任务调度系统设计规范》v0.0.0，规定单权威时间/场景、任务状态机、依赖图、异步结果代次校验、确定性提交、预算背压、跨平台执行器及验收矩阵。仅设计文档，无代码实现或运行验证，项目版本保持0.0.0。

- 2026-10-27：新增《Rendering三维渲染系统设计规范》v0.0.0，明确渲染与仿真状态解耦、Rust对象职责、跨尺度精度、相机与拾取、GPU后端候选、资源恢复、性能与NASA Eyes首期验收。仅设计文档，未实现或测试，版本保持0.0.0。

- 2026-10-27：新增《Resources统一资源管理系统设计规范》v0.0.0，定义唯一资源所有权、句柄代次、共享租约、异步加载、CPU/GPU预算、缓存、设备丢失恢复及验收矩阵。仅规划文档，无代码或测试，版本保持0.0.0。

- 2026-10-27：完成第07阶段《Core Protocol统一核心协议设计规范》v0.0.0草案，定义八组Proto消息职责、统一信封、Scene/Time/Spatial/Simulation/Rendering/Resources映射、跨平台编解码、兼容性、安全、验收和待审决策。仅文档设计，未创建.proto实现、未运行测试，版本保持0.0.0。

- 2026-10-27：完成Rust核心七模块静态交叉架构审查，新增《Rust核心七模块交叉架构审查报告》v0.0.0；登记12项待审问题（P0四项、P1六项、P2两项）、建议依赖方向、统一提交链、八项ADR和C0阶段门。仅文档审查，未执行代码测试，版本保持0.0.0。

- 2026-10-27：针对七模块交叉审查12项问题，新增《Rust核心跨模块ADR整改方案》v0.0.0，给出ADR-001至ADR-009的责任边界、不变量、验收和问题映射；所有方案待批准，时间尺度/Proto字段及工程验证未冻结。仅规划文档，版本保持0.0.0。

- 2026-10-27：同步七份核心专项设计的跨模块职责，新增C0整改追踪矩阵。所有决策仍待批准，尚未进行代码测试，版本保持0.0.0。

- 2026-10-27：新增C0核心接口、依赖与验收详细设计，以及科学时间语义核验计划；完成设计层面的接口、依赖图、快照时序和12项验收用例。真实时间验证、Proto字段冻结、编译与运行测试及ADR批准仍需证据，版本保持0.0.0。

- 2026-10-27：负责人批准ADR-001至ADR-009，新增ADR-APPROVAL.md，并同步ADR合集及C0验收矩阵状态。仅设计决策获批，科学时间验证、Proto字段和工程测试仍未完成；版本保持0.0.0。

- 2026-10-27：新增C0时间与Proto设计基线、模块依赖核查，明确时间字段与科学单位、公开ID、协议边界和无环crate依赖方向；科学时间与实际Cargo/Proto编译仍待验证，版本保持0.0.0。

- 2026-10-27：清理规划分支中六份过早的验证/核查/重复C0文档，保留七大核心专项设计及已批准ADR，并将ADR合集精简为架构决策文档。仅文档整理，不进行代码验证；版本保持0.0.0。

- 2026-10-27：新增第08阶段《Rust核心对象模型与接口详细设计规范》v0.0.0，统一Engine、Scene、Spatial、Time、Simulation、Rendering、Resources、ProtocolAdapter及相机对象的职责、状态所有权、候选方法、依赖与Proto边界。仅Markdown设计，未编写或验证代码，版本保持0.0.0。

- 2026-10-27：新增第09阶段《Proto数据结构与消息字段设计规范》v0.0.0，细化八组消息、候选字段号、类型、oneof、optional、科学单位、时间与参考系、领域对象映射和兼容规则。仅Markdown设计，未创建.proto或执行编译测试；版本保持0.0.0。

- 2026-10-27：新增第10阶段《命令、查询、事件与错误处理设计规范》v0.0.0，定义命令生命周期、事务、幂等、查询一致性、事件顺序、结构化错误、权限及异步取消语义。仅Markdown设计，未实现代码或测试，版本保持0.0.0。

- 2026-10-27：新增第11阶段《Rust工程目录与模块依赖设计规范》v0.0.0，设计Cargo workspace目标目录、九项核心crate职责、无环依赖、封装规则、WASM/Native与Web宿主边界及ADR对应。仅Markdown设计，未创建工程或执行编译测试，版本保持0.0.0。

- 2026-10-27：新增第12阶段《核心生命周期与状态快照设计规范》v0.0.0，明确Engine、SceneObject、Simulation、Resources生命周期、SceneSnapshot/FrameSnapshot/ProjectSnapshot区别、初始化/停机顺序、项目恢复与Proto边界。仅Markdown设计，未编写代码或验证文件，版本保持0.0.0。

- 2026-10-27：执行第13阶段Markdown文档一致性审查，直接修订Rust核心总规范、Scene、Rendering、Core Protocol、第09阶段Proto、第10阶段命令、第11阶段目录及第12阶段生命周期等八份原文档；统一FrameSnapshot/ProjectSnapshot职责、相机唯一命令入口、事务原子性、恢复代次、资源缺失状态和已批准ADR语义。未创建验证报告或代码，版本保持0.0.0。

- 2026-10-27：完成第14阶段核心架构设计基线整理，新增《Rust核心架构设计基线》v0.0.0，集中索引七大核心模块、第08至12阶段专项设计、已批准ADR、快照职责、Proto边界、未定设计事项及文档优先级。仅Markdown导航与状态整理，不创建代码或验证文档，版本保持0.0.0。

- 2026-10-27：项目负责人正式批准《Rust核心架构设计基线》；同步批准并强化《项目文档与版本规范》中的严格版本递增、100进1、受控成果版本一致、CHANGELOG强制记录及异常阻断规则。此次仅设计批准与规则修订，未启动代码开发、未进行工程测试，统一版本保持0.0.0。
