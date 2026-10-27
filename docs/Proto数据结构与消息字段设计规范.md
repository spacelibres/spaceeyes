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

## 0.0.1纹理/材质切片
MeshVertex追加uv字段3，缺省兼容旧顶点(0,0)。Material包含base_color、可选texture、显式filter/address及unlit；MeshInstance和SpherePrimitive追加material字段3，若同时携带旧base_color必须与材质一致。TextureData明确宽高、RGBA8字节与ColorSpace，未知/零值枚举拒绝。ResourceCommand字段2注册纹理，沿用资源提交修订/幂等语义与1MiB信封上限。未改变旧字段号或把图像文件格式当作Proto消息。

生成Rust代码对CreateObject.object使用prost支持的Box布局，防止新增组件使oneof枚举膨胀；不改变Proto字段、字节契约或校验规则，严格Clippy仍执行，不禁用其检查。

## M1-1 公开会话与参考系贯通（0.0.1增量）
状态：本轮实施规范；保持ADR-001至009职责不变。Engine仍唯一写入者，ProtocolAdapter负责校验/映射，WASM与Native复用同一字节协议，不引入第二套状态。
新增LifecycleCommand.start/stop、SpatialCommand.register_root/register_child_sample（要求expected_revision）；子变换为米制、wxyz四元数、显式TimeInstant的单时刻采样，绝不解释为永久静态变换或科学时间转换。根可在Ready准备；start仅Ready→Running；stop调用既有shutdown，释放资源并终止会话，不能重新start；Paused仍只是播放状态。相同请求重放返回原始提交结果，不表示当前生命周期；以查询读取当前状态。
CommandEnvelope追加spatial=8、lifecycle=9，旧字段保持不变；ResponseEnvelope追加spatial=10、session=11、frame=12。SpatialResponse返回提交时图修订；SessionStatus包含生命周期、精确ClockState、四类修订/序列、对象数与资源登记字节。ClockState追加rate_numerator=6/rate_denominator=7以免只读double丢失有理倍速。错误新增ENGINE_UNAVAILABLE=15、TIME_NOT_COVERED=16。
新增独立QueryEnvelope（context=1，session_status=20或resolve_frame=21），通过ProtocolAdapter.query_bytes与WasmEngine.query读取；复用RequestContext的会话、版本、宿主principal校验，最大1MiB。CommandEnvelope保留20/21，QueryEnvelope保留2至9，防止误用入口时把查询解析为写命令；查询不消耗命令幂等历史、不写事件、不推进时钟/代次/修订；相同查询ID允许读取最新状态。可选expected_scene_revision/time_generation作为读取前置条件；查询错误使用ResponseEnvelope结构化返回。resolve_frame使用当前显式时刻，返回source/target/instant/变换/图修订；Stopped只允许状态查询，拒绝参考系解析。尚无对象分页、事件订阅、动态提供者或跨会话查询。
参考系写入先检查图修订，再调用现有Engine接口；非法变换、父节点缺失、重复ID、过时代次/图修订不得改变图、Scene或资源。所有公开ID限制256UTF-8字节；旧协议幂等记录保存规范化领域命令，四元数按已有领域构造器归一化。不新增混合Scene/Spatial原子批次；现有SceneTransaction仍原子。
验收须从全新会话只经公开字节命令创建根/采样子系、相机与球体，查询位姿/状态，构造可绘制一致帧，再验证暂停/Seek、重试、非法输入、停机/资源清理、查询不消耗容量。Rust/WASM编译及全部严格回归必需；TS往返和浏览器画布属于后续M1/M2，不因本轮通过就宣称完成。

构建一致性：protocol-adapter的build.rs显式跟踪整个proto目录，确保只改外部Schema也重新生成Rust类型，避免后续TS/Rust使用不同Schema；实际触碰Schema文件并检查Cargo重生成记录。

## M1-2 能力发现与双语言客户端（0.0.1）
状态：本轮实施规范；依赖M1-1，不改变已批准ADR。Protocol能力发现是只读QueryEnvelope.capabilities=22，CommandEnvelope保留22；ResponseEnvelope.capabilities=13。返回当前支持的操作标识、协议版本、消息/ID/批次/纹理/网格上限与当前会话历史容量/剩余量。能力表示实现支持，不表示身份授权或当前生命周期允许；不宣传Live、GPU画布、动态提供者、事件订阅或项目文件等未开放能力。上限与执行校验使用相同常量，历史容量取实际dispatcher配置，Stopped仍能发现能力。
TS SDK放在packages/core-sdk，由唯一proto目录生成全部类型与编解码，锁定生成器和依赖并检查生成漂移。64位整数用bigint，禁止以JS number传递修订/时间等整数；oneof使用生成的可辨别联合，不手工复制Schema。SDK先发现并核对协议/必需能力，再发送受支持的全部现有命令/查询；提供结构化错误、长度及请求关联校验，不缓存场景/时钟、不隐式重试。重试沿用调用方请求ID。认证principal仅由宿主在transport闭包注入，插件不能自报。SDK不拥有WASM实例；宿主停机后释放实例。
跨语言验收使用真实Rust Native字节宿主与wasm-bindgen生成的WASM实例执行同一TS客户端流程，并比较响应；不用mock替代互通证据。覆盖能力缺失/协议不兼容、所有已开放命令族、修订/时间大于2^53、负时间、字节纹理/网格、幂等/错误/查询/停机与多实例隔离。示例宿主stdin/stdout仅传长度帧封装的Proto，不另建JSON数据契约。WASM在Node执行不等于浏览器画布验收，M2仍须实际WebGPU/交互验证。
新增安装、生成、检查步骤同时纳入本地严格检查和CI；无跳过用例，无第三方许可改写，Node/wasm-bindgen版本受控。M1之后仍按浏览器、统一资源/项目、科学数据和插件治理依赖顺序推进。

## M2-1 浏览器画布与宿主帧（0.0.1实施增量）
状态：本轮实施规范；保持已批准ADR和唯一Rust核心。Next.js/React宿主经既有SDK/Proto构造合成场景；共享wgpu几何/材质打包与绘制管线，新增浏览器Surface异步初始化、缩放与真实显示，不把Native回读图片贴到画布。
宿主DOM画布绑定为基础设施接口；结构化帧数据采用HostFrameEnvelope(context=1, frame=30)，CommandEnvelope保留30，QueryEnvelope保留30。HostFrame含reference/camera/width/height/elapsed_nanos；ResponseEnvelope追加presented=14，包含当前SessionStatus、尺寸和未解析对象数。Capabilities追加browser_surface=4，只代表该编译目标含Surface支持，不表示运行设备或授权有效。通用24项操作不因此变成插件绘制权限。
宿主帧入口只给受信宿主，身份由闭包注入。仅Running可呈现；要求当前time_generation，可选Scene修订，尺寸1..2048、经过时间0..250ms，引用/相机预检失败不得推进时间；校验后调用Engine.advance_nanos并发布同一时刻FrameSnapshot。绘制失败不撤回已经提交的时间，返回结构化错误并由宿主停循环/查询；不假装跨GPU与时间原子事务。不占命令历史，不写业务提交事件，不隐式重试。
一次只允许一个在途GPU帧，等待提交完成后回收帧顶点/纹理临时预算，浏览器禁止同步GPU等待。Surface绑定时通过唯一Resources保守预留2048×2048×12=48MiB附件容量（两份颜色与一份深度），记录为容量预留而非实际显存测量；持有租约，Stop/实例释放时随Engine清理。Surface只保存GPU对象，不建资源注册表。本轮检测设备丢失并显式停止/清理；自动恢复与重建设计仍属M5。
React每次挂载创建独立canvas与Engine，异步初始化/呈现期间的输入串行执行；卸载取消RAF并移除所属canvas、等待在途操作退出，再Stop/free；迟到初始化不能重新挂到已卸载DOM。帧时间来自单调RAF时间戳，暂停不推进时钟，过长间隔限250ms；不创建JS权威仿真时钟。合成场景使用根系与相机局部偏移，避免把单时刻子采样当作永久参考系。
首个可运行宿主提供开始/暂停时间、相机偏航、状态/错误与挂载开关。验证实际Chromium WebGPU绘制像素、相机变化、暂停/播放、resize、卸载/重挂和不支持WebGPU路径；截图、生产构建、严格WASM feature编译和浏览器自动测试纳入检查。目标为M2首个增量，不声称NASA真实场景、拾取UI、完整控制台、设备恢复或硬件性能已完成。

M2-1补充：浏览器采用非映射流式顶点上传，并将顶点目标/上传暂存双份计费；Surface保留Instance，GPU完成后回收临时预算。WASM模块加载Promise共享而Engine实例独立，避免并发初始化替换运行时；设备丢失/验证/分配错误返回失败，初始化失败或卸载时显式destroy设备。

## M2-2 同帧拾取契约（0.0.1开发增量）
公开query.pick_presented使用最近成功呈现帧的frame_sequence和有限NDC坐标（x右正、y上正，范围[-1,1]）。Rust保留单个只读拾取视图与对象摘要；查询不创建新帧、不推进时钟、不消耗命令历史。摘要与几何来自同一帧；空白返回成功且无对象。帧不匹配、核心状态已变化或没有成功呈现帧时返回SNAPSHOT_EXPIRED；停机返回ENGINE_UNAVAILABLE；非法坐标返回INVALID_ARGUMENT。浏览器宿主自行将CSS点击坐标转换为NDC，不执行几何拾取。缓存仅在成功呈现后更新，Stop释放；旧视图不得冒充当前结果。宿主选择只作临时UI状态，摘要不包含未开放的科学属性。

## M2-3 相机聚焦与跟随契约（0.0.1开发增量）
Engine接受camera.focus（相机/目标ObjectId、正有限米制距离、follow），要求expectedSceneRevision及当前TimeGeneration；在当前时刻解析Spatial并经唯一Scene事务提交。聚焦沿目标参考系+Z放置、沿-Z观察；球体/标记取参考系原点，网格取引用顶点AABB中心。距离必须在当前相机near/far内，不自动修改投影。跟随保存在CameraState.tracking(targetId,distanceM)，每帧从同一FrameSnapshot求值目标位置及旋转，不累计运动、不写Scene。基础CameraState.position/orientation属于拥有相机的FrameId；tracking生效时派生视图使用目标参考系，基础位姿作为显式逻辑状态保留，不冒充当前世界位置。禁止自引用、相机目标与跟随链；被跟随对象删除/改成相机时事务拒绝，可先清除跟随再删除。参考系/时间覆盖缺失明确失败；Renderer不回退到原点。query.camera_state只读逻辑状态；旧SetCamera未提供tracking即清除跟随，旧wire字段编号不变。宿主不持有第二套权威相机，不基于Scene ParentId算坐标。

## M3-1a 分层资源预算契约（0.0.1开发增量）
ResourceManager为唯一总额及Cpu/Gpu/Staging类别额度权威，申请须同时满足类别与总额，计数和资源修订原子更新。Engine原型总256MiB、CPU128MiB、GPU128MiB、Staging32MiB；属于可配置原型限制，不是实测内存保证。纹理/网格/加载声明归Cpu，Surface附件容量归Gpu，帧GPU分配和CPU打包/上传/回读暂存分别归Gpu与Staging；成对预留失败不留下部分占用，完成或错误时释放。GPU/临时资源不得成为Scene资产引用，ProjectState只导出显式Cpu记录，恢复拒绝Gpu/Staging并采用目标宿主额度。query.resource_stats只读返回分项/总占用、上限与资源修订；不推进时钟、不占幂等历史，Stop后占用0。统计不覆盖全部旧快照、驱动内部开销或宿主长期输出副本；消息仍限1MiB，尚不宣称分块上传完成。SDK不能借统计查询提高权限或直接申请内部GPU/临时资源。

## M3-1b 有界资源上传（0.0.1开发增量）
公开操作resources.begin_upload/append_upload/finish_upload/cancel_upload及query.upload。单资源非空且最多16MiB，单块非空且最多256KiB，最多4个在途会话；还受宿主CPU/Staging及总额限制，消息上限仍1MiB。begin原子预留等长CPU目标和Staging，会话由Rust生成且绑定宿主注入principal，偏移必须等于已收字节，不接受重叠/跳块。申请源source_id最多256字节、source_version最多128字节，均非空；SHA-256必须32字节并对完整实际内容验证，标签/摘要不是科学认证。

格式仅Bytes（width/height/color_space均缺省）与RGBA8（显式宽高和Linear/SRGB，最多2048×2048，alpha=255）。finish缺块拒绝并保留可追加会话；完整内容摘要/类型失败自动取消并释放，成功变成Ready CPU资产且释放Staging；取消或Stop后迟到消息不能复活条目。源信息随完成资源记录保存，恢复重新验摘要；上传中记录和缓冲不导出。查询不返内容、不推进时间/命令历史。重试必须复用原请求ID及相同字节，不能换ID重复偏移；原ID重试得到历史回执，不意味着会话仍存活，应读query.upload。墙钟超时、网络/磁盘I/O、压缩解码、网格大包及插件整体所有权由M3后续实现。

M3-1b幂等清理约束：上传块历史只保留会话/偏移/长度/SHA-256指纹，拒绝和完成路径均不保留payload。正常历史耗尽仍阻止新业务写入，独立有界清理回执空间保留当前最多4个上传取消及一次Stop；失败清理不耗该空间，成功清理重试仍返回原回执。
