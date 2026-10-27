# SPACEEYES Proto数据结构与消息字段设计规范

版本：0.0.1｜状态：第09阶段设计草案｜日期：2026-10-27
范围：Markdown字段设计，不创建.proto文件、不编译、不进行工程测试。
依据：第07阶段Core Protocol规范、第08阶段Rust核心对象模型、已批准ADR-001至ADR-009。

## 1. 设计原则
- 单一权威Proto Schema；未来Rust/TypeScript类型从同一Schema生成，禁止平行手写DTO。
- Proto仅用于公开结构化交换；Rust内部高频数学对象、GPU数据不强制序列化。
- 不将NASA DYN格式写入核心协议；DYN作为后续数据插件内部格式。
- 采用明确的消息、enum、oneof和optional表达语义；字段编号是**规划建议**，尚未发布或冻结。
- 版本0.0.0为项目统一版本；package建议spaceeyes.core.v1仅是协议命名空间，不是项目版本1.0.0。
- 禁止以proto3默认零值推断未知科学时间、参考系、权限或成功状态。

## 2. 文件和包组织
| 文件 | package | 主要消息 |
|---|---|---|
| common.proto | spaceeyes.core.v1 | ProtocolVersion、RequestContext、Error、ObjectId、FrameId、ResourceId |
| time.proto | spaceeyes.core.v1 | TimeInstant、TimeRange、ClockState、TimeCommand |
| spatial.proto | spaceeyes.core.v1 | Vector3d、Quaterniond、Transform、SpatialState、FrameDescriptor |
| scene.proto | spaceeyes.core.v1 | SceneObject、SceneCommand、SceneSnapshot |
| simulation.proto | spaceeyes.core.v1 | TaskRequest、TaskResult、TaskStatus |
| rendering.proto | spaceeyes.core.v1 | CameraState、RenderPrimitive、PickRequest、PickResult |
| resources.proto | spaceeyes.core.v1 | ResourceDescriptor、ResourceLease、ResourceStatus |
| core.proto | spaceeyes.core.v1 | CommandEnvelope、QueryEnvelope、ResponseEnvelope、EventEnvelope、FrameSnapshot |

建议按职责拆文件，不把文件数量机械等同于Rust crate数量。

## 3. common.proto字段设计
### ProtocolVersion
| 编号 | 字段 | 类型 | 语义 |
|---|---|---|---|
| 1 | major | uint32 | 协议兼容主代 |
| 2 | minor | uint32 | 协议兼容能力修订 |
| 3 | schema_id | string | Schema标识 |

### RequestContext
| 编号 | 字段 | 类型 | 语义 |
|---|---|---|---|
| 1 | request_id | string | 请求唯一标识及幂等依据 |
| 2 | session_id | string | 会话身份 |
| 3 | protocol_version | ProtocolVersion | 发送方协议版本 |
| 4 | correlation_id | optional string | 关联请求链 |
| 5 | causation_id | optional string | 直接触发来源 |
| 6 | expected_scene_revision | optional uint64 | 乐观并发校验 |
| 7 | time_generation | optional uint64 | 时间任务代次 |

ObjectId、FrameId、ResourceId建议各自使用value:string字段1，属于不同的强类型消息，禁止互换；内部slot+generation不进入公开Proto。

### Error
1 code:ErrorCode；2 message:string；3 request_id:string；4 details:repeated ErrorDetail。ErrorCode的0值必须为ERROR_UNSPECIFIED，不得表示成功。候选错误：INVALID_ARGUMENT、UNSUPPORTED_VERSION、UNKNOWN_OBJECT、UNKNOWN_FRAME、STALE_GENERATION、REVISION_CONFLICT、INVALID_HANDLE、RESOURCE_EXCEEDED、PERMISSION_DENIED、PROVIDER_UNAVAILABLE、CANCELLED、INTERNAL_ERROR。

## 4. time.proto字段设计
### TimeInstant
| 编号 | 字段 | 类型 | 说明 |
|---|---|---|---|
| 1 | time_scale | TimeScale | 显式时间尺度，0为UNSPECIFIED |
| 2 | epoch_id | string | 显式历元标识，禁止隐式J2000 |
| 3 | seconds | sint64 | 相对历元整秒 |
| 4 | nanos | uint32 | 0至999999999 |
TimeScale候选值：UNSPECIFIED=0、TT=1、TDB=2、UTC=3；枚举数字尚未冻结。TT/TDB与NASA DYN实际约定仍待后续实证；不因此假定某一时间尺度为核心唯一标准。

### TimeRange
1 start:TimeInstant；2 end:TimeInstant；3 include_start:bool；4 include_end:bool。范围必须可比较，跨尺度需显式转换。

### ClockState
1 instant:TimeInstant；2 mode:PlaybackMode；3 rate:double；4 generation:uint64；5 revision:uint64。
PlaybackMode：UNSPECIFIED=0、PAUSED=1、PLAYING=2、LIVE=3。

### TimeCommand
oneof action：1 play:PlayCommand；2 pause:PauseCommand；3 seek:SeekCommand；4 set_rate:SetRateCommand；5 live:LiveCommand；6 step:StepCommand。Seek/Reset/Live语义重置增加generation，连续播放不逐帧递增。

## 5. spatial.proto字段设计
Vector3d：1 x:double；2 y:double；3 z:double。
Quaterniond：1 w:double；2 x:double；3 y:double；4 z:double；内部约定WXYZ为命名分量，和外部DYN磁盘编码独立。
FrameDescriptor：1 frame_id:FrameId；2 parent_frame_id:optional FrameId；3 provider_id:string；4 revision:uint64。
Transform：1 source_frame:FrameId；2 target_frame:FrameId；3 instant:TimeInstant；4 translation_m:Vector3d；5 rotation:Quaterniond；6 linear_velocity_mps:optional Vector3d；7 angular_velocity_radps:optional Vector3d；8 validity:TimeRange；9 provider_id:string。
SpatialState：1 frame_id:FrameId；2 instant:TimeInstant；3 position_m:optional Vector3d；4 velocity_mps:optional Vector3d；5 orientation:optional Quaterniond；6 angular_velocity_radps:optional Vector3d；7 validity:TimeRange；8 source_id:string。
缺少变换导数时不能声称完成旋转参考系下的完整速度转换。

## 6. scene.proto字段设计
SceneObject：1 object_id:ObjectId；2 parent_id:optional ObjectId；3 frame_id:optional FrameId；4 visible:bool；5 lifecycle:ObjectLifecycle；6 resources:repeated ResourceId；7 unresolved:bool。
SceneCommand使用oneof action：1 create:CreateObject；2 remove:RemoveObject；3 set_parent:SetParent；4 set_visibility:SetVisibility；5 set_spatial_state:SetSpatialState；6 set_camera:SetCameraState。
SceneTransaction：1 commands:repeated SceneCommand；2 expected_revision:optional uint64。首期事务强制全有或全无，不设置含糊的atomic=false开关；未来best-effort必须另定义显式消息。
SceneSnapshot：1 scene_revision:uint64；2 objects:repeated SceneObject；3 time:TimeInstant。Scene层快照不单独宣布完整FrameSnapshot。

## 7. simulation.proto字段设计
TaskRequest：1 task_id:string；2 request_id:string；3 session_id:string；4 generation:uint64；5 requested_instant:TimeInstant；6 expected_scene_revision:uint64；7 frame_graph_revision:uint64；8 dependencies:repeated string；9 provider_id:string；10 budget:TaskBudget。
TaskResult：1 task_id:string；2 generation:uint64；3 requested_instant:TimeInstant；4 coverage:TimeRange；5 provider_version:string；6 status:TaskStatus；7 result:oneof TaskPayload；8 error:optional Error。
TaskStatus的0值为UNSPECIFIED；其它为QUEUED、RUNNING、RESULT_READY、COMPLETED、CANCELLED、FAILED、STALE。接受任务不等于完成。TaskBudget只管理调度预算，不拥有CPU/GPU资源字节配额。

## 8. rendering.proto字段设计
CameraState：1 camera_id:ObjectId；2 frame_id:FrameId；3 instant:TimeInstant；4 position_m:Vector3d；5 orientation:Quaterniond；6 projection:Projection；7 follow_target:optional ObjectId。
RenderPrimitive：1 primitive_id:string；2 object_id:ObjectId；3 geometry_ref:ResourceId；4 material_ref:ResourceId；5 visible:bool。
PickRequest：1 session_id:string；2 frame_sequence:uint64；3 viewport_id:string；4 screen_x:double；5 screen_y:double。
PickResult：1 object_id:optional ObjectId；2 frame_sequence:uint64；3 hit_position_m:optional Vector3d；4 status:PickStatus。
相机持久状态由受控核心命令管理，Renderer不成为第二权威相机。

## 9. resources.proto字段设计
ResourceDescriptor：1 resource_id:ResourceId；2 kind:ResourceKind；3 owner_id:string；4 source_id:optional string；5 size_bytes:uint64；6 recoverable:bool；7 checksum:optional bytes。
ResourceLease：1 lease_id:string；2 resource_id:ResourceId；3 holder_id:string。首期不设置expires_at；未来若有租约到期时间须使用独立墙上时钟类型，绝不复用SimulationInstant。
ResourceStatus：1 resource_id:ResourceId；2 state:ResourceState；3 resource_epoch:uint64；4 error:optional Error。
公开不暴露Rust内部槽位或GPU指针；资源最终释放权归Resources。

## 10. core.proto字段设计
CommandEnvelope：1 context:RequestContext；oneof payload：2 scene:SceneCommand；3 time:TimeCommand；4 resource:ResourceCommand；5 simulation:SimulationCommand；6 restore_project:RestoreProjectRequest。相机变更通过SceneCommand.set_camera进入Scene事务，不设平行CameraCommand写入口。
QueryEnvelope：1 context:RequestContext；oneof payload：2 scene:SceneQuery；3 spatial:SpatialQuery；4 time:TimeQuery；5 resource:ResourceQuery。
ResponseEnvelope：1 request_id:string；2 status:ResponseStatus；oneof payload：3 scene:SceneResponse；4 time:TimeResponse；5 resource:ResourceResponse；6 error:Error。
EventEnvelope：1 event_id:string；2 session_id:string；3 sequence:uint64；4 causation_id:optional string；oneof payload：5 scene:SceneEvent；6 time:TimeEvent；7 resource:ResourceEvent；8 simulation:SimulationEvent。
FrameSnapshot：1 session_id:string；2 instant:TimeInstant；3 time_generation:uint64；4 scene_revision:uint64；5 frame_graph_revision:uint64；6 resource_epoch:uint64；7 frame_sequence:uint64；8 availability:FrameAvailability；9 scene:SceneSnapshot。
FrameAvailability：UNSPECIFIED=0、COMPLETE=1、PARTIAL=2、STALE=3。PARTIAL不可被解释为完整科学状态。

## 11. 字段存在性与协议兼容
- 必须有的消息字段由适配层验证，不能假设proto3自动强制required。
- 对可缺失数值采用optional或oneof；未知枚举必须拒绝或安全降级。
- 字段编号发布后不可复用；删除字段须reserved编号和名称。
- 改变单位、时间尺度、参考系语义属于破坏性变更，即使二进制类型不变也必须另行治理。
- RequestContext权限来源由宿主鉴权，不信任调用者自报能力。
- 对超大消息、数组和嵌套结构设置上限，具体阈值属于后续工程配置。

## 12. 领域对象与Proto映射
| Rust领域对象 | Proto消息 | 映射职责 |
|---|---|---|
| Engine命令 | CommandEnvelope | ProtocolAdapter校验后分发 |
| SceneObject | SceneObject | 对外只读字段，不泄露内部句柄 |
| SimulationClock | ClockState | 显式时间尺度、历元、generation |
| ReferenceFrameGraph | FrameDescriptor/Transform | FrameId与graph_revision |
| SimulationTask | TaskRequest/TaskResult | 异步结果有效性字段完整 |
| Renderer相机 | CameraState | 持久逻辑状态与GPU派生状态分离 |
| ResourceManager | ResourceDescriptor/Status | 公开ResourceId，隐藏内部代次句柄 |
| Engine一致快照 | FrameSnapshot | 原子发布的时间/场景/参考系修订 |

## 13. 当前设计尚未确定的细节
字段号、枚举数值与package路径均为本阶段建议，不代表正式Schema冻结。仍需明确：核心时间尺度与历元、FrameId命名空间、相机多视口、SceneTransaction原子性表达、ResourceLease期限是否使用墙上时间、FrameSnapshot是否内嵌完整Scene或仅引用只读快照。

## 14. 后续设计约束
下一阶段第10阶段将统一Command、Query、Event、Error的生命周期、幂等、排序、权限和失败语义；不得绕过本阶段Proto消息设计另建平行通信协议。当前不创建实际.proto文件或运行测试。


## 15. 第10与12阶段字段对齐（第13阶段审查修订）
- ResponseEnvelope候选新增command_sequence、committed_scene_revision、frame_sequence、task_id；EventEnvelope新增correlation_id、occurred_at，具体字段号待冻结。
- 增加CommandStatusQuery/CommandStatusResponse；ErrorCode增加IDEMPOTENCY_CONFLICT、SNAPSHOT_EXPIRED。不能把Accepted当作Completed。
- ProjectSnapshot与ProjectManifest为持久化消息，RestoreProjectRequest/Response和EngineLifecycleEvent为生命周期协议消息；ProjectSnapshot不得包含GPU指针、内部代次句柄或插件执行栈。
- FrameSnapshot用于渲染的一致帧，ProjectSnapshot用于持久化，两者不可互换；项目created_at/updated_at属于墙上时间，不是TimeInstant。
- CameraState为Scene持久逻辑状态；CameraCommand必须经Engine进入Scene事务，避免与SceneCommand.set_camera形成双写入口。
- 本章节为Markdown字段建议，不是正式.proto或冻结的字段号。


## 16. 第13阶段生命周期字段约束
ProjectSnapshot保存稳定ObjectId、FrameId、ResourceId、Scene状态、CameraState和时间配置；恢复时必须创建新会话内部句柄及TimeGeneration，旧任务代次不跨恢复继承。ProjectManifest的created_at/updated_at使用独立墙上时钟元数据类型。FrameAvailability的PARTIAL表示可用数据不完整，STALE表示旧时刻帧，不能与Engine生命周期Failed混用。


> 版本同步记录（2026-10-27）：随首次Rust核心开发启动，本受控文档升级至0.0.1。历史规划记录不改写。


## 17. 0.0.1首批Proto实现边界（2026-10-27）
首次建立`proto/spaceeyes/core/v1/common.proto`与`time.proto`，使用prost-build和vendored protoc生成Rust类型；ProtocolAdapter负责显式时间尺度/历元校验及ObjectId、FrameId、ResourceId映射。Schema字段号在当前开发分支作为初始实现使用，**尚未宣布对外冻结**。包名v1是协议命名空间，与项目版本0.0.1不同。未实现Scene、Spatial、Simulation、Rendering、Resources和Core Envelope完整Schema，也未实现TypeScript生成、gRPC服务或NASA DYN插件。旧文中的“仅设计，不创建.proto”属于规划阶段历史说明，当前已进入代码开发。编译与往返测试代码尚待VPS执行。

## 0.0.1同步Scene/Time信封实现
新增scene.proto与core.proto，延用SceneObject字段1–7及既定SceneCommand基础字段1–4；7为set_frame、8为set_resources扩展，未实现的相机/科学空间消息不以默认值伪装成功。CommandEnvelope字段2沿用单SceneCommand，新增字段7为scene_transaction；Time仍为字段3。适配器校验协议major=1、minor=0、schema_id=spaceeyes.core.v1，拒绝未知版本、缺失前置修订和超大输入。响应status只在真实同步提交后为COMPLETED。Host principal由函数参数提供，不能从Proto自报权限。所有字段仍属于0.0.1开发契约，未正式冻结。

## 0.0.1相机命令切片
新增spatial.proto数学值类型和rendering.proto的透视Projection、CameraState；CameraState沿用建议的字段4 position_m、5 orientation、6 projection。相机ID及FrameId由包含组件的SceneObject唯一提供，暂不新增重复身份/时刻字段。SceneObject字段8为可选camera；SceneCommand字段6实现set_camera，包含object_id和可选camera，缺省camera表示移除组件。未知/缺少投影拒绝，不静默替换为默认视图。未实现follow_target及正交投影不作为受支持能力。

## 0.0.1球体显示契约
rendering.proto新增ColorRgb及SpherePrimitive（1 radius_m、2 base_color），均为显示参数。SceneObject字段9保存sphere，SceneCommand字段9为set_sphere（object_id和可选sphere）；缺省sphere表示移除组件。radius/color缺失、非有限或越界均拒绝。兼容既有字段号，不复用SceneCommand字段5。此开发切片不宣布完整RenderPrimitive/材质/纹理Schema冻结。

## 0.0.1网格资源切片
rendering.proto新增MeshVertex、TriangleMesh、MeshInstance；SceneObject字段10为mesh，SceneCommand字段10为set_mesh。resources.proto新增RegisterMeshResource及ResourceCommand.register_mesh，沿用CommandEnvelope字段4 resource；ResponseEnvelope字段5 resource返回稳定资源ID/提交修订。结构化数据仍由唯一Proto定义，不新增自定义二进制格式。网格消息数量、局部坐标及法线由geometry领域构造器校验，信封仍受1MiB上限限制；大模型文件流式传输以后单独设计。
