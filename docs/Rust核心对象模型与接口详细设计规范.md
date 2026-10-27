# Rust核心对象模型与接口详细设计规范

版本：0.0.0｜状态：待审定设计草案｜日期：2026-10-27
设计阶段：08｜范围：仅Markdown设计，不编写Rust实现
依据：Rust核心总规范、七项专项设计、已批准ADR-001至ADR-009。

## 1. 设计目标
把七大核心系统的逻辑对象统一为可执行的职责契约，明确状态所有权、公开方法、依赖方向、错误与Proto边界。Rust采用struct、impl、trait与组合，不要求传统类继承。核心不包含NASA DYN、天体专用算法、插件管理或AI模型逻辑。

## 2. 对象所有权总表
| 对象 | 权威状态 | 允许读取 | 禁止职责 |
|---|---|---|---|
| Engine | 会话生命周期、命令顺序、FrameSnapshot发布 | 各模块公开快照 | 直接存储第二套Scene |
| Scene | 场景对象、层级、通用状态、scene_revision | FrameId、资源引用 | 轨道计算、GPU分配 |
| ReferenceFrameGraph | 参考系关系、graph_revision | TimeInstant值 | 管理Scene父子关系 |
| SimulationClock | 仿真时刻、模式、rate、generation | 宿主单调elapsed | 自行读取NASA星历 |
| SimulationScheduler | 任务队列、依赖、状态、结果验证 | Time/Scene/Spatial快照 | 直接写Scene |
| Renderer | GPU渲染状态、相机派生视图 | FrameSnapshot、ResourceLease | 修改科学状态、推进时间 |
| ResourceManager | 资源ID、租约、代次、预算、释放 | 宿主授权上下文 | 自行授予插件权限 |
| ProtocolAdapter | 无科学权威状态；协议映射与校验 | Engine Facade | 持有第二套领域对象 |
| CameraController | 相机逻辑命令与持久状态（候选归Scene） | Spatial/Time快照 | 直接修改Renderer私有GPU状态 |

## 3. Engine
职责：创建与关闭会话、统一命令入口、模块协调、FrameSnapshot原子发布。
候选属性：session_id、lifecycle、command_sequence、frame_sequence、last_published_snapshot、module_refs。
候选接口：initialize(config)、submit_command(envelope)、query(request)、advance(elapsed_real)、latest_snapshot()、shutdown()。
不变量：一个会话只有一个权威Scene和Clock；关闭后拒绝写命令；命令按确定顺序处理；快照修订一致。
依赖：通过公开trait组合Scene、Spatial、Time、Simulation、Rendering、Resources；不依赖NASA或UI。
Proto：CommandEnvelope、QueryEnvelope、ResponseEnvelope、EventEnvelope、FrameSnapshot。

## 4. Scene与SceneObject
Scene属性：registry、hierarchy、object_states、scene_revision。
SceneObject通用属性：ObjectId、ParentId（可选）、FrameId（可选）、visibility、spatial_state_ref、resource_refs、lifecycle。
候选接口：create_object、get_object、set_parent、set_visibility、set_spatial_ref、remove_object、apply_transaction、snapshot。
不变量：ObjectId唯一、组织关系无环、Scene唯一写入者、ParentId不代表FrameId。内部ObjectHandle含代次，公开ObjectId稳定。
父对象删除：默认拒绝有子对象的删除；显式级联命令才可级联（依已批准ADR的设计方向）。Frame失效标记unresolved，不自动删除对象。
事务：单命令原子；批量默认全有或全无；错误不允许部分提交。
Proto：SceneCommand、SceneObjectRef、SceneSnapshot。

## 5. Spatial与ReferenceFrameGraph
属性：frame_registry、parent_edges、provider_refs、graph_revision、transform_cache。
候选接口：register_frame、unregister_frame、resolve_transform(source,target,instant)、get_frame、snapshot。
不变量：无环、FrameId唯一、时间/单位/参考系明确、变换覆盖有效。撤销Frame发布失效事件，Scene按命令处理关联状态。
TransformProvider为可替换能力接口，领域算法由外部提供；核心只做图组织、变换组合与合法性检查。
Proto：FrameRef、Transform、SpatialState、FrameGraphRevision。

## 6. Time与SimulationClock
属性：instant、time_scale、epoch、playback_mode、rate、generation、revision、step_accumulator。
候选接口：play、pause、seek、set_rate、set_live、step、advance_elapsed、snapshot。
不变量：唯一权威时间；Seek/Reset/Live源切换增加generation；连续播放不逐帧增加generation；非法时间或速率不得改变状态。
科学时间尺度和J2000零点尚未冻结；时间消息必须显式标识尺度、历元和精度。
Proto：TimeInstant、TimeCommand、ClockState、TimeSnapshot。

## 7. Simulation与SimulationScheduler
属性：task_registry、dependency_graph、queue、task_budget、result_buffer。
候选接口：enqueue、cancel、poll_ready、validate_result、propose_scene_commands、snapshot。
不变量：计算可并发但场景单逻辑提交；结果校验generation、requested_instant、coverage、provider_version、object_handle、scene_revision与frame_revision。旧结果可缓存但不能错误提交。
预算：仅任务队列、并发、CPU时间和优先级；CPU/GPU资源字节由Resources管理。
Proto：TaskRequest、TaskStatus、TaskResult、SimulationSnapshot。

## 8. Rendering与Renderer
属性：render_backend、render_scene_cache、camera_view、pass_graph、device_epoch。
候选接口：initialize_device、render_frame(frame_snapshot)、pick(screen_point,frame_revision)、resize、device_status、shutdown。
不变量：只读一致FrameSnapshot；不拥有Scene科学状态；不推进Time；GPU设备丢失不改变科学状态。
CameraController的持久逻辑状态建议归Scene受控命令，Renderer仅计算view/projection和临时GPU状态。
Proto：CameraState、RenderPrimitive、PickRequest、PickResult。

## 9. Resources与ResourceManager
属性：resource_registry、lease_table、generation_table、cpu_budget、gpu_budget、cache_index。
候选接口：request、lease、release、status、evict、recover_device、snapshot。
不变量：唯一逻辑资源所有者；共享租约不意味着共享最终释放权；过期代次句柄无效；插件权限由宿主授予。
Proto：ResourceRef、ResourceDescriptor、ResourceStatus、ResourceLease。

## 10. ProtocolAdapter
职责：唯一Proto消息入口的结构校验、版本兼容、领域对象映射与错误编码。
候选接口：decode_command、validate_envelope、map_to_domain、map_from_domain、encode_response、encode_event。
不变量：不持有权威Scene/Time状态；不信任消息自报权限；Rust内部领域对象与Proto生成类型分离。
WASM与Native共享Schema与语义，只有传输和设备适配不同。

## 11. 统一接口调用顺序
Host授权 → ProtocolAdapter校验 → Engine命令入口 → 对应领域模块校验 → Simulation结果校验（若异步） → Scene事务提交 → Engine原子发布FrameSnapshot → Renderer只读消费。
所有写入不能绕过Engine；Scene内部事务方法仅通过受控核心接口调用，不对插件公开。

## 12. FrameSnapshot设计
候选字段：session_id、simulation_instant、time_generation、scene_revision、frame_graph_revision、resource_epoch、frame_sequence、availability、scene_state_ref、spatial_state_ref。
FrameSnapshot不可变；发布需保证时间和修订一致。旧帧可作为视觉回退但必须明确stale，不能标记为当前科学状态。

## 13. 模块依赖规则
foundation提供ID、数学值、时间值和错误等只读类型；time、spatial、resources、scene依赖foundation；simulation依赖各模块公开接口；rendering依赖只读快照和resources；engine负责组合；protocol-adapter依赖engine facade与生成的Proto；wasm/native仅为外层适配。
禁止foundation反向依赖上层、Scene依赖插件、Rendering持有Simulation可变状态。

## 14. 设计尚需细化的事项
ObjectId/FrameId/ResourceId编码细节、TimeInstant科学时间尺度和零点、CameraController多视口归属、批量事务错误语义、快照内存共享策略、资源租约的并发边界、具体Proto字段号。它们留在对应设计规范中继续明确，不在文档阶段创建编译或测试计划文件。

## 15. 后续设计阶段
下一阶段为09：Proto数据结构与消息字段规范。必须复用本文件对象职责，不再建立第二套DTO或命令入口。NASA Eyes首期体验优先、最终AI通过SDK技能书自主开发插件的产品目标保持不变。
