# Spatial空间与参考系系统设计规范

版本：0.0.1｜状态：待审定草案｜日期：2026-10-27  
设计阶段：02｜上位规范：`docs/Rust核心引擎设计规范.md`  
前置规范：`docs/Scene场景系统与对象模型设计规范.md`

## 1. 目标与非目标

Spatial负责通用空间参考系的身份、关系、变换组合、有效时间与数值精度策略。它不包含地球/太阳/木星固定常量，不解析NASA DYN，不实现星历、多体动力学、光行时或天体物理模型。具体天文参考系的定义与时间相关变换由领域能力提供；核心只负责校验、组织与组合。

## 2. 核心概念

- `FrameId`：持久、稳定、可在Proto公开接口中引用的参考系身份。
- `ReferenceFrameGraph`：有向无环的参考系关系与变换查询管理器。
- `FrameTransform`：明确源、目标、历元、平移、旋转和有效区间的变换。
- `SpatialState`：指定FrameId和时间的空间状态；位置、速度、姿态等字段需明确单位及可用性。
- `LocalOrigin`：渲染相机相对局部原点；只影响渲染坐标，不改变科学权威状态。
- `TransformProvider`：经核心公开接口提供指定时间参考系变换的能力；来源可由未来插件实现。

## 3. 对象模型与职责

| 对象 | 职责 | 禁止行为 |
|---|---|---|
| `ReferenceFrameGraph` | 注册、查询、删除参考系关系；检查无环 | 直接计算NASA专用星历 |
| `ReferenceFrame` | FrameId、父参考系ID、元数据、有效性 | 暗含地心/日心默认值 |
| `FrameTransform` | 源/目标、时间、位置/姿态变换 | 缺失单位或时间时默认为有效 |
| `TransformResolver` | 沿图路径组合、求逆与查询 | 隐式使用过期缓存 |
| `SpatialPrecisionPolicy` | 选择局部原点与渲染精度策略 | 改写原始科学状态 |
| `TransformProvider` | 提供时间相关变换 | 越权直接修改Scene |

## 4. 强制不变量

1. FrameId唯一；引用的父参考系必须存在；不得形成环。
2. Scene的ParentId是组织关系，FrameId是物理空间关系；两者绝不自动互相推导。
3. 变换必须明确时间尺度、历元、参考系和单位；无有效变换时返回结构化不可用状态，不伪造零值。
4. 组合变换顺序固定且文档化；逆变换、非交换旋转、速度转换应分别验证。
5. 缓存键至少区分源、目标、仿真时间/有效时间窗、变换提供者版本及图修订号。
6. 渲染局部原点仅用于GPU精度优化；不得覆盖持久化的双精度科学坐标。
7. 所有公开空间查询和状态交换使用版本化Proto；Rust内部使用封装的数学类型。

## 5. 参考系层级（示例，不硬编码）

星系参考系 → 恒星系统参考系 → 天体中心参考系 → 天体固连参考系 → 局部观测参考系。核心只认识FrameId与变换关系，不要求每个天体都拥有表面经纬度或大气模型。参考系提供者需声明轴定义、中心、历元、有效区间与数据来源。

## 6. 变换语义

建议采用刚体变换 `p_target = R * p_source + t`；旋转组合必须保持次序。速度变换在参考系随时间旋转/平移时涉及变换导数与角速度，**不得只旋转速度向量便声称完整正确**。若提供者缺少导数，查询只能返回受限位置/姿态结果或显式不支持速度转换。姿态四元数内部字段顺序与NASA DYN磁盘WXYZ编码相互独立，转换由数据插件负责。

## 7. 多尺度精度

科学状态采用双精度及参考系分层；渲染使用相机相对坐标/局部原点和必要的高低位拆分。大尺度场景与近景细节分层调度，不能把星系和行星表面都压入单一float32世界坐标。需对太阳系远景、地月系统、木星卫星近景和局部相机跟随进行数值误差及抖动测试；目标误差阈值待硬件原型实测后冻结。

## 8. 与Scene/Time/Rendering的接口

- Scene保存对象的FrameId与状态引用，不自行计算参考系变换。
- Time提供权威仿真时刻，Spatial不得读取隐式系统当前时间。
- Rendering只消费指定时刻的变换快照与局部渲染坐标，不反向修改Spatial权威状态。
- 插件通过公开SDK注册TransformProvider或提交合法状态，不得绕过宿主权限代理。

## 9. 错误与快照

至少区分：未知FrameId、参考系环、无有效时间覆盖、缺少变换导数、单位不兼容、提供者不可用、缓存过期、数值非有限。FrameGraph变更需提升修订号；查询快照记录时刻、图修订、提供者标识与来源。异常输入不能造成部分更新却返回成功。

## 10. 验收设计

- 注册多层Frame并验证无环；非法父级与环必须拒绝。
- 非交换旋转的组合和逆变换数值一致。
- 在指定时间切换Frame时结果可复现，超出覆盖返回不可用。
- 对旋转参考系的速度转换验证角速度项；缺失导数拒绝完整速度请求。
- 局部原点切换不改变科学坐标。
- Scene ParentId与FrameId不同也能正确运行。
- Proto Rust/TS往返不丢失单位、时间、参考系和错误状态。

## 11. 待审定决策

1. FrameId编码和命名空间；是否允许不同提供者注册同名Frame。
2. 变换缓存粒度与失效规则。
3. 速度/角速度等导数能力的最小接口。
4. 内部数学类型与四元数约定。
5. 局部原点切换阈值与渲染精度预算。
6. 动态参考系注册/撤销时的场景对象处理方式。

**本文件仅为设计规范，没有实现代码，也没有运行验证。**


## 12. 交叉审查整改对齐（待审）
FrameGraph修订参与一致FrameSnapshot；Spatial不拥有Scene或Time可变状态。Frame撤销发出失效事件，关联Scene对象标记unresolved而非隐式删除。时间相关变换需附目标时刻、代次、覆盖区间及提供者版本，提交前由Simulation统一校验。


> 版本同步记录（2026-10-27）：本受控文档随首次Rust核心开发启动统一升级至0.0.1；历史规划说明及原始批准日期保留为历史记录。实际实现范围以CHANGELOG.md为准。


## 13. 0.0.1 实现范围说明（2026-10-27）
已开始实现Rust Spatial基础：ReferenceFrameGraph、FrameId注册/删除、单父参考系关系、修订号、显式TimeInstant的刚体变换、四元数归一化、逆变换与链式组合、缺失时间样本拒绝，以及Engine受控参考系注册入口。当前仅支持**精确历元静态样本**，尚未实现TransformProvider、时间插值、速度/角速度导数、缓存和多尺度GPU精度策略。Scene ParentId与Spatial FrameId保持分离。新增测试源码不代表测试已通过；统一项目版本0.0.1。


## 14. 动态参考系提供者开发进展（0.0.1）
已增加Rust `TransformProvider` trait与`ProviderRef`，支持按显式`TimeInstant`查询动态参考系的刚体变换，并允许通过Engine受控注册或替换提供者；替换时FrameGraph修订递增。提供者身份与版本必须非空，返回的刚体变换重新校验。Simulation新增最小任务登记与generation、目标时刻双重有效性检查。当前没有时间区间插值、速度导数、异步调度执行、NASA DYN插件。上述是开发范围记录，不代表运行验收。

## M4前置：提供者样本帧（0.0.1增量）
新增`FrameSource::ProviderSample`：帧绑定provider_id/provider_version，宿主按当前显式TimeInstant提交刚体样本，核心不插值、不算轨迹、不联网。首次更新前解析返回MissingTransform；恢复时缺失提供者仍建立Unavailable占位，可由后续样本重新绑定。更新仅接受提供者样本帧或恢复占位，对根/静态样本/动态提供者拒绝；更新先校验修订溢出再原子替换，图修订与Engine帧序列递增。样本时刻不匹配返回TimeNotCovered，旧图修订的任务按既有规则Stale。

公开Proto新增RegisterProviderFrame、UpdateProviderFrameSample与ProviderIdentity；provider_id/provider_version非空且分别不超过256/128字节，写入要求expected_revision。Engine/ProtocolAdapter仅做授权后的校验与转发，不成为第二套科学时间或轨迹权威。尚未实现速度/角速度导数、覆盖区间缓存、插值或多尺度精度策略。

## M1-1 公开会话与参考系贯通（0.0.1增量）
状态：本轮实施规范；保持ADR-001至009职责不变。Engine仍唯一写入者，ProtocolAdapter负责校验/映射，WASM与Native复用同一字节协议，不引入第二套状态。
新增LifecycleCommand.start/stop、SpatialCommand.register_root/register_child_sample（要求expected_revision）；子变换为米制、wxyz四元数、显式TimeInstant的单时刻采样，绝不解释为永久静态变换或科学时间转换。根可在Ready准备；start仅Ready→Running；stop调用既有shutdown，释放资源并终止会话，不能重新start；Paused仍只是播放状态。相同请求重放返回原始提交结果，不表示当前生命周期；以查询读取当前状态。
CommandEnvelope追加spatial=8、lifecycle=9，旧字段保持不变；ResponseEnvelope追加spatial=10、session=11、frame=12。SpatialResponse返回提交时图修订；SessionStatus包含生命周期、精确ClockState、四类修订/序列、对象数与资源登记字节。ClockState追加rate_numerator=6/rate_denominator=7以免只读double丢失有理倍速。错误新增ENGINE_UNAVAILABLE=15、TIME_NOT_COVERED=16。
新增独立QueryEnvelope（context=1，session_status=20或resolve_frame=21），通过ProtocolAdapter.query_bytes与WasmEngine.query读取；复用RequestContext的会话、版本、宿主principal校验，最大1MiB。CommandEnvelope保留20/21，QueryEnvelope保留2至9，防止误用入口时把查询解析为写命令；查询不消耗命令幂等历史、不写事件、不推进时钟/代次/修订；相同查询ID允许读取最新状态。可选expected_scene_revision/time_generation作为读取前置条件；查询错误使用ResponseEnvelope结构化返回。resolve_frame使用当前显式时刻，返回source/target/instant/变换/图修订；Stopped只允许状态查询，拒绝参考系解析。尚无对象分页、事件订阅、动态提供者或跨会话查询。
参考系写入先检查图修订，再调用现有Engine接口；非法变换、父节点缺失、重复ID、过时代次/图修订不得改变图、Scene或资源。所有公开ID限制256UTF-8字节；旧协议幂等记录保存规范化领域命令，四元数按已有领域构造器归一化。不新增混合Scene/Spatial原子批次；现有SceneTransaction仍原子。
验收须从全新会话只经公开字节命令创建根/采样子系、相机与球体，查询位姿/状态，构造可绘制一致帧，再验证暂停/Seek、重试、非法输入、停机/资源清理、查询不消耗容量。Rust/WASM编译及全部严格回归必需；TS往返和浏览器画布属于后续M1/M2，不因本轮通过就宣称完成。

## C04 参考系导数与解析缓存（0.0.1增量）
新增`FrameDerivative{linear_velocity_m_s,angular_velocity_rad_s}`与`FrameState{transform,derivative,point_velocity}`；`TransformProvider`增加可选`derivative_at`，缺省返回`None`表示不支持速度变换，绝不假定零速度。`ReferenceFrameGraph::resolve_state(source,target,instant)`沿链组合刚体变换与导数：旋转项ω×r、平移项、旋转参考系下的角速度合成与逆变换均按明确次序计算；跨过静态样本、提供者样本或无导数提供者时返回`DerivativeUnavailable`，位置解析仍可单独成功。`point_velocity(p)`给出固定在源系中的点在目标系的瞬时速度。
`resolve`增加按（源、目标、显式时刻）键控的有界memo（最多256项），图修订变化即整体失效；只能缓存纯函数式提供者结果，不缓存导数轨迹，也不代表覆盖区间或来源元数据。测试覆盖角速度合成与逆变换、ω×r速度项、缺导数显式错误与修订失效。尚未实现：覆盖区间/来源元数据公开、插值、科学参考系与多尺度场景；不宣称C04全部完成。

## C04 提供者覆盖区间公开（0.0.1增量）
`TransformProvider::coverage`可选声明`(start,end)`；`ProviderRef`校验同时间标度/历元且start≤end，`ReferenceFrameGraph::coverage`只对动态提供者返回`FrameCoverage{provider_id,provider_version,start,end}`，静态样本与提供者样本返回`None`，未知FrameId返回`UnknownFrame`。Proto新增只读`query.frame_coverage`（QueryEnvelope=31，ResponseEnvelope=22）：`covered=false`表示未声明区间，绝不推断；错误区间返回INVALID_ARGUMENT。能力总数39。区间是提供者声明，不代替求值覆盖校验，也不转换时间标度。
