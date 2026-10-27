# Simulation仿真任务调度系统设计规范

版本：0.0.1｜状态：待审定草案｜日期：2026-10-27
设计阶段：04。依据：Rust核心、Scene、Spatial、Time三份设计规范。本阶段仅设计，不写实现。

## 1. 目标与边界
Simulation负责按权威仿真时间安排任务、依赖检查、预算管理、异步结果验证、受控提交及快照发布。核心不解析NASA DYN、不实现轨道或多体算法、不管理插件生命周期。插件经宿主SDK提供领域计算结果，不能直接写Scene。

## 2. 设计原则
- 每个会话只有一个SimulationClock与一个Scene权威状态。
- 建议单一逻辑提交者，允许计算并发；并发结果不直接修改Scene。
- TimeSnapshot、TimeGeneration、SceneRevision、FrameGraphRevision参与结果有效性判断。
- Rendering读取一致的只读快照，不推进仿真。
- Rust内部使用对象封装与trait；公开结构化消息采用Protobuf。
- WASM和Native共享调度语义，不假设浏览器一定支持线程。

## 3. 对象模型（候选）
| 对象 | 职责 |
|---|---|
| SimulationScheduler | 任务登记、阶段安排与结果提交协调 |
| SimulationTask | 不可变任务描述、目标时刻、依赖和预算 |
| TaskRegistry | 任务状态、所有权、句柄代次与取消 |
| DependencyGraph | 拓扑依赖与环检测 |
| TaskExecutor | 抽象同步与异步执行，适配WASM/Native |
| BudgetController | CPU/队列/资源预算与背压 |
| ResultValidator | 时间、代次、对象、参考系和来源校验 |
| ResultCommitter | 通过Scene命令提交合格结果 |
| SimulationSnapshot | 时间与场景修订一致的只读状态 |

上述为职责划分，不要求每个对象独立crate。

## 4. 任务生命周期
Created → Validated → Queued → Running → ResultReady → Committing → Completed。
异常终态：Cancelled、Failed、Stale；终态均需清理资源。任务已接受不等于执行成功；取消是尽力而为，不能假定已发生的外部副作用可撤销。

## 5. 任务类型
候选类别：ClockStep、TransformResolve、StateEvaluation、SceneUpdate、ResourcePrepare、SnapshotPublish。具体天文算法属于插件，不属于核心任务枚举的强制实现。任务输入为不可变快照或受控句柄。

## 6. 逻辑调度周期
1. 接收并验证宿主命令。
2. 获取唯一TimeSnapshot及代次。
3. 根据依赖图确定可运行任务，拒绝循环。
4. 执行有界同步任务；异步任务返回句柄。
5. 校验结果与当前时间、会话、对象代次、Scene/Spatial修订、来源及覆盖范围。
6. 通过Scene命令按确定顺序提交。
7. 发布一致的只读快照。
8. 渲染器独立消费最近有效快照。

批量提交原子性与部分数据不可用的展示语义待与Scene联合审定。

## 7. 时间一致性
每个任务至少关联task_id、request_id、session_id、requested_instant、time_generation、scene_revision、frame_graph_revision、provider_id/version及dependencies。Seek/Reset/Live切换使旧任务失效；过时结果不得覆盖新时间。反向播放不意味着所有领域算法支持逆积分。没有覆盖的星历必须返回Unavailable，不允许假造当前位置。

## 8. 并发、预算与背压
首期建议单逻辑提交者、可选并发计算者。浏览器可使用Worker但不依赖SharedArrayBuffer；Native可使用原生执行器。任务队列、并发数、运行时长和资源预算必须有限。优先交互与当前焦点对象；预取可延迟或取消。具体阈值待设备实测，不提前承诺帧率。

## 9. 资源与错误
错误至少区分InvalidTask、DependencyCycle、StaleGeneration、InvalidObjectHandle、TimeOutOfRange、ProviderUnavailable、BudgetExceeded、Cancelled、ExecutionFailed。任务停用或宿主关闭时应取消可取消任务、拒收迟到结果并释放归属资源。GPU设备丢失由Rendering/Resources处理，不得静默改写科学状态。

## 10. Proto与插件边界
公开候选消息：SimulationTaskRequest、TaskHandle、TaskStatus、TaskResult、TaskError、SimulationSnapshot、CancelTaskRequest。字段、时间零点、错误码待Proto规范冻结。宿主执行身份与权限校验，核心再次验证状态不变量。AI生成插件必须使用版本化SDK技能书及相同预算、权限与验证规则。

## 11. 验收设计
| 测试 | 预期 |
|---|---|
| 依赖任务乱序完成 | 按依赖与确定提交顺序生效 |
| 循环依赖 | 拒绝任务 |
| Seek后旧数据返回 | 标记Stale，不覆盖新状态 |
| 对象删除后任务返回 | 失效句柄不能写入 |
| 网络失败/缺数据 | 显式Unavailable |
| 队列满/超预算 | 拒绝或背压，不无限增长 |
| 取消/关闭 | 清理任务及资源 |
| 不同渲染帧率 | 不改变权威仿真语义 |
| Rust/TS Proto往返 | 时间、代次、修订、错误完整 |
| 未授权插件任务 | 宿主拒绝且核心状态不变 |

## 12. 待审定事项
任务粒度与执行器trait、依赖图与优先级、修订不匹配时拒绝还是重算、快照原子发布、部分数据展示、取消预算、连续播放中的代次规则、批量Scene命令原子性。当前没有Rust实现或测试结果。

## 13. 交叉审查整改对齐（待审）
Simulation负责计算任务与结果有效性校验，不直接写Scene。Engine负责统一命令入口及单一逻辑提交，Scene负责场景事务。任务结果须联合校验generation、目标时刻、coverage、来源版本及对象代次。Simulation仅管理任务队列和CPU调度预算，CPU/GPU资源字节及租约归Resources。详见Rust核心跨模块ADR整改方案。


> 版本同步记录（2026-10-27）：本受控文档随首次Rust核心开发启动统一升级至0.0.1；历史规划说明及原始批准日期保留为历史记录。实际实现范围以CHANGELOG.md为准。


## 14. 0.0.1实现进度（2026-10-27）
已实现基础SimulationScheduler任务登记、依赖检查、确定性ready顺序、任务开始、取消、失败、ResultReady与Completed分离；Engine负责根据TimeGeneration失效旧任务，并通过唯一Scene事务入口提交已验证任务结果。Scene提交失败时任务保留ResultReady供显式处理。当前任务依赖要求先注册前置任务，避免形成循环；尚未实现异步执行器、CPU预算、超时、跨提供者数据覆盖、SceneRevision/FrameGraphRevision完整校验或Proto消息。已编写单元测试但尚无CI通过记录。此节为0.0.1范围说明，未变更已批准ADR。
