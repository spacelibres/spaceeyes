# Core Protocol统一核心协议设计规范

版本：0.0.1｜状态：待审定设计草案｜日期：2026-10-27
设计阶段：07｜归属：SpaceEyes Rust Core公开边界｜仅设计，不创建可运行代码
依据：Rust核心与Scene、Spatial、Time、Simulation、Rendering、Resources六项专项设计规范。

## 1. 目标和边界
统一Rust核心、WASM宿主、未来Native宿主及TypeScript SDK之间的结构化数据契约。所有跨模块公开边界、跨语言、跨进程及需要长期持久化的结构化交换使用版本化Protocol Buffers。Rust内部领域对象、数学热路径、GPU缓冲区不强制逐次Protobuf编解码。协议不包含NASA DYN原始记录格式，也不实现gRPC网络服务；未来可复用消息添加service。

## 2. 核心不变量
1. 只有一个权威Schema源，Rust/TypeScript类型均从它生成，禁止手写平行DTO。
2. Proto消息是边界数据，不是Scene、Clock或ResourceManager的内部可变对象。
3. WebAssembly与Native共用消息、错误、状态和命令语义；传输适配可不同。
4. 每条涉及科学状态的消息明确时间尺度、历元、单位、FrameId、来源与有效范围；不能隐式地心或默认时间。
5. Scene ObjectId与内部代次句柄分离，公开标识不包含内存地址。
6. 插件身份和权限由宿主验证；消息中自报权限不可信。
7. 接收方校验输入并拒绝未知必需能力、非法数值、过时结果与不兼容版本。
8. 版本0.0.0是全项目规划基线；Proto package的v1命名若采用仅表示Schema命名空间，不代表项目版本升级。

## 3. Schema模块建议
| 文件 | 主要消息职责 |
|---|---|
| common.proto | RequestContext、Error、Version、Id、Capability |
| time.proto | TimeInstant、Duration、TimeScale、ClockState、TimeGeneration |
| spatial.proto | FrameRef、Transform、SpatialState、Validity |
| scene.proto | SceneObjectRef、SceneCommand、SceneSnapshot、Hierarchy |
| simulation.proto | TaskRequest、TaskStatus、TaskResult、SimulationSnapshot |
| rendering.proto | CameraState、RenderPrimitive、PickRequest/Result |
| resources.proto | ResourceRef、ResourceDescriptor、ResourceState、Lease |
| core.proto | CommandEnvelope、QueryEnvelope、EventEnvelope、ResponseEnvelope |

建议目录：proto/spaceeyes/core/v1/。文件名、包名、字段号尚未冻结；模块划分以接口职责而非Rust crate数量为准。

## 4. 统一消息信封
候选公共上下文：protocol_version、request_id、session_id、causation_id、correlation_id、source_capability、expected_scene_revision、time_generation。响应区分Accepted、Completed、Rejected与Cancelled，不能将已接受任务伪装为已完成。事件包括event_id、sequence、snapshot_revision、occurred_at及结构化payload。请求重试的幂等语义由宿主/核心共同定义。

不推荐用任意字符串+opaque bytes承载所有命令；首期优先使用明确的oneof类型化消息，便于生成SDK、权限审查和AI技能书。保留受控扩展点但不能绕过版本兼容。

## 5. Scene协议
公开ObjectId稳定、内部ObjectHandle含代次；SceneCommand候选：CreateObject、DeleteObject、SetParent、SetVisibility、SetSpatialState。ParentId仅是组织关系，FrameId是物理参考系。SceneSnapshot包含scene_revision、time_reference、对象通用状态与资源引用。删除父对象默认拒绝和显式级联遵循已批准的Scene事务设计约束。

## 6. Time协议
TimeInstant必须包含时间尺度和明确零点/历元；候选使用整数秒与亚秒部分，禁止JS Date毫秒作为唯一权威表示。TT/TDB/UTC转换、闰秒和J2000/DYN约定未验证前不冻结字段含义。TimeCommand候选：Play、Pause、Seek、SetRate、Live、Step。TimeGeneration用于拒绝跳转后过期结果，不能简单与每一渲染帧号等同。

## 7. Spatial协议
FrameRef标识参考系，Transform携带源/目标、时刻、位置、姿态、单位、有效区间与可选导数。速度变换在旋转参考系下需要角速度及变换导数；缺失导数不能报告完整速度变换成功。禁止仅传裸XYZ而缺少参考系、时间或单位。

## 8. Simulation协议
TaskRequest携带task_id、session_id、time_generation、requested_instant、scene_revision、frame_graph_revision、依赖与预算；TaskResult携带状态、来源版本、覆盖区间、错误或结果。旧代次、已删除对象、失效资源或不匹配参考系必须拒绝提交。任务状态与取消语义和Simulation设计规范一致。

## 9. Rendering与Resources协议
Rendering协议表达相机、绘制原语、材质参数、拾取和显示能力，不能直接传GPU指针。资源协议公开逻辑ResourceId、状态、所有者、租约与能力，内部带代次句柄由适配器管理。大批量顶点/纹理可以经受控缓冲句柄传递，Proto承担控制与元数据；需要定义缓冲长度、类型、校验和所有权。

## 10. 兼容性与Schema治理
- 每个字段号一旦发布不得复用；删除字段用reserved保护编号及名称。
- 禁止在原字段号上改变类型、语义、单位或时间零点。
- 新增字段需明确缺省值语义；必要字段不应仅依赖proto3隐式零值，应使用optional或oneof表达存在性。
- 未知枚举值必须安全处理，不能默认为成功或某个参考系。
- Schema变更需提交ADR、更新对应MD、CHANGELOG并执行兼容性检查。
- Proto兼容性版本独立于项目统一发布版本的数字进位规则；发布时受控文档与代码版本仍必须一致。
- 数据持久化需要额外的分块、索引、校验与容错封装；Proto本身不是随机访问文件格式。

## 11. Rust/TypeScript生成与WASM桥接
建议以单一proto目录生成Rust与TypeScript编解码类型，生成产物可复现并在CI检查漂移。Rust领域模型通过ProtocolAdapter映射；WASM通过受控字节缓冲或消息桥传递，Native未来可复用同一协议。选择prost、protobuf-es或其它工具前先做最小双语言往返原型；不预先锁定具体版本。未来gRPC还需要service、认证、流控、超时和错误映射，当前不实施。

## 12. 错误、权限与安全
统一错误分类候选：InvalidArgument、UnsupportedVersion、UnknownObject、UnknownFrame、StaleGeneration、RevisionConflict、InvalidHandle、ResourceExceeded、PermissionDenied、ProviderUnavailable、Cancelled、InternalError。错误必须保留request_id、领域原因与可诊断信息，但不能泄露宿主密钥或内部路径。对数组长度、嵌套深度、字符串、数值有限性、资源预算和消息大小设上限，避免畸形Proto导致资源耗尽。

## 13. 验收设计
| 用例 | 预期 |
|---|---|
| Rust→Proto→TS→Proto→Rust | 关键字段与存在性语义一致 |
| 同一消息WASM/Native | 解码与业务语义一致 |
| TimeInstant极端日期 | 无静默精度丢失，超范围显式拒绝 |
| FrameId与单位缺失 | 拒绝科学状态输入 |
| Scene修订不匹配 | 返回冲突，不发生半提交 |
| Seek后旧TaskResult | 拒绝StaleGeneration |
| 旧ResourceHandle | 拒绝访问 |
| 未知枚举/未知字段 | 安全兼容或明确拒绝，不误判成功 |
| 大数组/畸形输入 | 受控失败，内存占用有界 |
| Schema破坏性变更 | CI兼容检查失败 |
| 插件越权命令 | 宿主拒绝且核心状态不变 |

本阶段仅编制验收计划，没有实际执行测试。

## 14. 待审定的跨模块决策
1. TimeInstant的时间尺度、零点、精度和可表示范围。
2. ObjectId/FrameId/ResourceId编码与命名空间。
3. Command/Query/Event的信封字段、排序、幂等及错误码。
4. 批量Scene命令原子性与部分结果语义。
5. SceneSnapshot和SimulationSnapshot的修订一致性。
6. Buffer/Resource句柄与WASM内存所有权。
7. Proto package命名、生成工具、Schema兼容检查。
8. SDK能力发现、插件权限与消息类型的映射。

## 15. 阶段出口
完成六个模块协议映射表、字段语义和ADR审定后，进入七大核心模块的交叉架构审查；不得仅因本文件创建就宣布Schema冻结或开始实现。首期仍以NASA Eyes体验为优先，最终AI通过公开SDK及版本化SKILL.md开发插件的目标保持不变。

## 16. 交叉审查整改对齐（待审）
FrameSnapshot候选字段：session_id、simulation_instant、time_generation、scene_revision、frame_graph_revision、resource_epoch、frame_sequence。所有写命令经Engine入口。TimeInstant候选time_scale、epoch_id、seconds、subsecond_nanos；科学时间语义及字段号未冻结。ObjectId、FrameId、ResourceId为独立公开身份，内部代次槽位不得暴露为跨进程句柄。


## 17. 第13阶段协议边界统一
公开协议必须区分SceneSnapshot、Engine FrameSnapshot、ProjectSnapshot。FrameSnapshot包含一致的时间、Scene、Spatial及资源修订，ProjectSnapshot只保存可恢复的稳定逻辑状态和来源引用。CommandEnvelope仅进入Engine统一入口；Response的Accepted不等于Completed；Project恢复须有显式命令与生命周期事件。字段设计统一由第09阶段规范维护，禁止建立平行Schema。


> 版本同步记录（2026-10-27）：随首次Rust核心开发启动，本受控文档升级至0.0.1。历史规划记录不改写。
