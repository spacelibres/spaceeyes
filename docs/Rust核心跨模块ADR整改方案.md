# Rust核心跨模块架构决策（ADR合集）

版本：0.0.1｜状态：ADR-001至ADR-009已批准｜日期：2026-10-27
依据：七大核心模块设计交叉审查及项目负责人批准记录。
批准记录：详见 docs/ADR-APPROVAL.md。设计决策已获批准，工程验证仍需执行。

## ADR-001：一致FrameSnapshot与单一提交者（CR-01）
**提议**：每个会话由Engine协调唯一逻辑提交者。Scene是唯一场景可变状态所有者；Simulation可并行计算但只能提出待验证命令。Engine在提交边界形成不可变FrameSnapshot，包含session_id、simulation_instant、time_generation、scene_revision、frame_graph_revision、resource_epoch、frame_sequence和availability状态。Rendering只读取已发布快照。不能将不同时间和修订的局部快照拼接为同一科学状态。
**不变量**：发布操作原子替换快照引用；旧快照可以显示但必须标记stale，不得冒充当前时刻。批量事务失败不产生部分写入。
**验收**：并发完成、Seek、参考系变更和渲染异步帧下的修订一致性测试。

## ADR-002：命令入口与事务职责（CR-02）
**提议**：Host鉴权→ProtocolAdapter校验→Engine CommandDispatcher统一入口→具体模块校验/执行。Scene负责SceneCommand事务，Time负责时间命令，Resources负责资源命令；Simulation只负责验证计算结果并请求Scene提交，不存在第二个直接写Scene入口。每个命令有request_id、expected_revision、结果和事件序列。
**不变量**：同一会话提交顺序确定；重复request_id依幂等缓存返回一致结果；单命令原子，批量默认全有或全无，未来可新增显式best-effort类型。
**验收**：重复命令、并发冲突、失败回滚、事件序列。

## ADR-003：时间代次与异步数据（CR-03）
**提议**：TimeGeneration仅在Seek、Reset、Live源切换或语义重置时递增；连续播放的每个时刻由requested_instant和数据coverage判断，不能仅靠generation判断新鲜度。任务结果附带generation、requested_instant、coverage、provider_version及目标对象代次。Simulation在提交时核验当前目标时刻策略：精确采样匹配或明确的有效覆盖/重采样规则。缓存可跨时刻复用，但缓存复用不等于结果可直接提交。
**不变量**：旧generation绝不写入；同generation但不适用当前时刻的结果也不得覆盖；反向播放必须由领域能力声明支持。
**验收**：跳转后迟到、连续快进、反向、跨段与重复时间边界。

## ADR-004：预算与资源所有权（CR-04）
**提议**：Simulation BudgetController只控制任务队列、并发、CPU时间及调度优先级；Resources是唯一资源ID/租约/CPU-GPU字节配额和生命周期权威；Rendering GPU适配器只报告实际GPU占用、创建和恢复，所有逻辑资源注册经过Resources。Host管理插件网络权限与网络配额。
**不变量**：没有双重最终释放权；任务取消释放租约；设备丢失使GPU句柄失效但不破坏科学状态。
**验收**：共享纹理、任务取消、插件停用、预算超限、设备恢复。

## ADR-005：标识与参考系失效（CR-05、CR-09）
**提议**：ObjectId、FrameId、ResourceId为独立的稳定公开标识，采用命名空间限定的不透明字符串；不得依赖内存地址。内部ObjectHandle/ResourceHandle含槽位和代次，禁止跨进程持久化。Scene ParentId只表示组织；Spatial FrameId表示坐标参考。Frame撤销先由Spatial发布失效事件，Scene中关联对象变为unresolved而非隐式删除；恢复需显式重绑定或有效提供者恢复。
**验收**：旧句柄、跨会话ID、Frame撤销和恢复、组织与参考系不同步。

## ADR-006：时间尺度与数值单位（CR-07）
**提议**：公开TimeInstant采用明确time_scale、epoch_id、seconds和subsecond_nanos，规范化subsecond在0至999999999；科学位置单位m、速度m/s、角度rad、角速度rad/s，且携带FrameId。**不在本ADR擅自确定TT/TDB为唯一核心时间尺度或固定J2000零点**；待NASA/DYN与独立科学参考验证后冻结time_scale与epoch枚举和转换能力。未知时间尺度拒绝科学计算。
**验收**：Rust/TS边界极值、闰秒、TT/TDB转换、非法单位和缺失FrameId。

## ADR-007：相机与渲染（CR-06）
**提议**：相机的可持久化逻辑状态由Scene中的通用CameraState/独立CameraController通过Engine命令维护；Renderer只读取快照生成view/projection矩阵和临时GPU数据。相机跟随目标由Spatial按时刻求值，不把Scene ParentId视为坐标系。UI仅提交相机命令，不维护第二个权威相机。
**验收**：时间跳转、目标删除、相机跟随、不同帧率与多视口。

## ADR-008：跨平台与协议边界（CR-08、CR-10）
**提议**：Rust领域核心不依赖浏览器或操作系统API。WASM/Native适配器负责启动、设备、时钟输入与消息传输；公开Proto契约相同。Host鉴权，ProtocolAdapter做结构和版本校验，Simulation做时间/来源有效性验证，Scene/Resources复核不变量。SDK/技能书只暴露经授权能力，不提供Rust私有对象入口。
**验收**：相同消息Rust/TS往返、WASM/Native语义、越权拒绝、非法来源数据。

## ADR-009：依赖图与测试追踪（CR-11、CR-12）
**提议**：foundation提供跨模块ID/数学值/错误等只读类型；time、spatial、resources依赖foundation；scene只依赖foundation及只读值类型；simulation依赖scene/time/spatial公开接口；rendering依赖只读FrameSnapshot与resources接口，不依赖simulation可变对象；engine组装；protocol-adapter只依赖公开engine facade；wasm/native位于最外层。必须生成实际crate依赖DAG并检查无环。
**验收**：依赖图检查、每项CR映射ADR及测试编号、C0-C5追踪矩阵。


## 设计状态
ADR-001至ADR-009均已批准，作为核心设计约束。涉及科学时间尺度、Proto字段号和具体实现技术的细节仍在相应专项设计中继续明确，不在文档规划阶段执行编译、测试或运行验收。


> 版本同步记录（2026-10-27）：随首次Rust核心开发启动，本受控文档升级至0.0.1。历史规划记录不改写。
