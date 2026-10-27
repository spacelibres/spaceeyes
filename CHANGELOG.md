# CHANGELOG

项目：SPACEEYES｜统一开发版本：0.0.1

## [0.0.1] — 2026-10-27

### 纹理采样与基础材质
- 原因/范围：在通用网格之后实现Resources统一管理的不透明RGBA8纹理和球体/网格基础材质，维持0.0.1开发迭代与统一MIT，不发布新版本或标签。
- 领域/所有权：TextureData校验宽高、精确字节数、opaque alpha和显式Linear/SRGB；Material保存线性基色、纹理ID、Nearest/Linear、Clamp/Repeat及Lit/Unlit。Scene只引用，纹理自动参与去重租约，类型错误/未就绪引用整批回滚；快照与内部项目恢复保留只读资产。
- 顶点/渲染：Vertex新增有限UV，旧构造器及旧Proto默认(0,0)，登记字节量计入UV；GPU顶点为52字节。按材质绑定真实纹理/采样器，透视正确插值，球体UV和网格法线遵循对象/参考系姿态；上传纹理及临时缓冲统一计费并回收，不创建第二套资源注册表。
- Proto：新增纹理登记、材质及采样/色彩空间枚举，未知值拒绝；旧基色与新Material同时出现必须一致。CreateObject.object改用生成器支持的Box布局避免大枚举，不改字节契约、不屏蔽Clippy。
- 验证：policy/MIT/版本/无环依赖、全目标检查、全feature编译、格式、严格Clippy、92项默认/102项含GPU测试、WASM构建及Native实际绘制通过，无失败/忽略。像素断言覆盖UV四角、nearest/linear、clamp/repeat、sRGB、基色乘法、倾斜平面透视插值和球体纹理旋转。
- 原生证据：程序生成8×8棋盘纹理由球体与四面体共享；绘制后保留资产976字节（网格720+纹理256），临时GPU占用0。测试使用Mesa llvmpipe软件Vulkan，不代表硬件/浏览器/远端CI通过。
- 风险/边界：仅原始不透明RGBA8，不支持PNG/JPEG解码、透明、mipmap、PBR或显示色调映射；离屏目标为线性RGBA8。配额仍不统计调用方无限期保留的旧快照全部CPU内存。
- 提交关联：父基线a6664682512c4f776c4e8188bc807d356a1f7bfa；以包含本记录的development/core-0.0.1提交追溯本次变更。专项规范先更新，原第三方许可和已批准ADR职责不变。

### 通用三角网格与资源引用贯通
- 原因/范围：在球体之后按规划增加通用不透明网格；保持0.0.1开发迭代，项目自有内容统一MIT，不创建发布或标签。
- 领域/所有权：新增仅依赖foundation的geometry crate，校验有限局部顶点/归一化法线、三角形索引、数量、退化面和局部坐标界限；Resources唯一登记与计费。Scene只存MeshInstance资源引用/基色，对象租约覆盖隐式网格引用并与显式引用去重；相机/球体/网格本轮互斥。
- 快照/绘制：FrameSnapshot共享只读MeshAsset，旧帧在对象删除后仍有效；刚体变换顶点/法线，通用网格与球体共用透视/深度/GPU预算与最近三角形拾取。Native实例展示三个球体及一个四面体，绘制保留624字节网格资产，临时GPU占用归零。
- Proto/恢复：新增网格资源登记和Scene set_mesh；ResourceResponse返回提交时的资源修订，幂等重试不读取后续修订冒充原结果。类型不符/非法索引拒绝且无部分提交；内部项目状态恢复typed网格，新会话重建租约，缺失几何不阻塞无关编辑。
- 验证：完整policy/MIT/依赖检查、全目标编译、全feature构建、格式、严格Clippy、85项默认/90项含GPU测试、WASM构建及Native真实绘制通过，无失败/忽略；GPU测试验证混合遮挡、绘制顺序独立及旋转法线。
- 风险/限制：配额当前统计登记资产与临时GPU占用，不覆盖用户无限期保留旧快照的全部CPU内存；尚无模型文件导入、纹理、透明、复杂材质或浏览器渲染。所有GPU证据来自Mesa软件Vulkan，未确认远端CI。
- 提交关联：父基线842335206480d7ccccb791a749abb502603b74ce；具体SHA由包含本记录的development/core-0.0.1提交追溯。专项规范先行更新，未改变已批准ADR或第三方许可。

### 统一MIT开源许可
- 原因/决定：项目负责人明确选择MIT License，要求Resources与其它模块保持许可一致。
- 范围：新增标准根LICENSE（Copyright 2026 SPACEEYES contributors）；workspace声明MIT，所有12个Cargo包继承相同许可/仓库元数据；项目自有Rust/Proto/WGSL/脚本添加MIT SPDX标识，脚本shebang保持首行。
- 规则/边界：README、项目规则、Resources规范及来源台账同步。MIT只适用于项目自有内容；第三方依赖和NASA等外部内容保留自身许可。本次不修改运行时资源所有权，不改变仓库可见性，不创建发布或标签。
- 验证：全部版本/依赖/许可检查、编译、格式、严格Clippy、76项默认/80项含GPU测试、WASM构建及Native真实绘制均通过，无失败或忽略；Cargo metadata确认12个包全部报告MIT。许可继承与源码SPDX一致性已纳入现有policy检查。
- 版本/提交关联：维持0.0.1开发迭代，父基线cf40412f8992aa6573be20bc523349586f9ff89e；由包含本记录的开发分支提交追溯本次许可变更。

### 球体网格、深度遮挡与提交规则核查
- 原因/范围：替换纯标记示例，落实球体基础显示与逐片元遮挡；保持当前0.0.1开发版本，本次不是正式版本发布，不递增版本或创建标签。
- Scene/协议：新增只读Sphere组件、SetSphere命令与Proto字段，校验正有限米制半径和有限RGB；相机/球体互斥、显式参考系、事务回滚、快照及内部项目恢复均验证；字段增量不复用既有编号。
- 渲染：有界32×16 UV球体网格、真实透视裁剪坐标、Depth32Float写入/比较、基础方向光明暗；保留标记兼容，球体拾取与绘制使用同一网格。临时颜色/深度/回读/顶点占用纳入Engine唯一ResourceManager。
- 规则核查：正常crate依赖保持单向无环；移除Native第二套资源注册表；补齐三份历史文档的当前版本声明，历史批准/规划/许可状态不改写。新增可执行版本与模块依赖核查。
- 验证：默认76项、全功能80项Rust测试通过，无失败/忽略；包含真实GPU像素回读、交换球体提交顺序后输出逐字节一致、近面裁剪、预算/长期资源保留、网格法线及Proto负向测试。编译、格式、严格Clippy、wasm32构建与Native三球体运行均通过；远端CI状态单独核对，不提前宣称。
- 风险/限制：GPU证据来自Mesa llvmpipe软件Vulkan，非硬件性能或浏览器验收；未实现完整纹理/材质、透明/LOD、科学光照、NASA数据或市场/AI功能。尚未正式冻结产品深度方案。
- 提交关联：本条目与下列基础/相机迭代一起纳入development/core-0.0.1开发提交；共同父基线为09018022b2f9954d58124f51fad175eff037bfc4，具体SHA由包含本记录的Git提交唯一追溯。

### Scene持久相机与任意姿态透视视图
- 原因：旧渲染只接收临时固定朝向View，未完成Scene相机状态的受控管理。
- 实现：新增CameraState与SceneCommand::SetCamera，校验有限参数、单位四元数、FOV及裁剪面；CameraState纳入只读快照与内部项目恢复，Engine校验相机参考系，事务失败不改变状态。
- 渲染：prepare_camera从同一FrameSnapshot组合参考系与局部相机姿态，f64相机相对计算后转换GPU坐标；相机不作为标记绘制，缺失姿态明确拒绝。临时aspect独立于持久相机参数。
- 协议：新增spatial/rendering Proto值类型，SceneCommand字段6实现set_camera，SceneObject字段8保存组件；沿用已有Engine事务/幂等入口，不增加平行写入口。专项规范已先更新。
- 证据：新增6项测试；默认70项、含GPU71项测试全部通过，无失败/忽略；编译、严格Clippy、格式与WASM构建通过。Native示例使用Scene相机，支持偏航角/X位移参数，真实wgpu输出像素。
- 风险/边界/关联：只实现基础透视相机；跟随/聚焦、多视口、正交投影与浏览器交互尚未实现。本轮保持0.0.1开发迭代，提交关联见本节首条记录；沿用09018022b2f9954d58124f51fad175eff037bfc4基线，保留此前工作区改动。

### 基础模块贯通与wgpu技术原型
- 原因/范围：依照规划将基础模块贯通为可验证链路，保持Engine唯一提交与无环依赖；新增snapshot crate、Native/WASM适配，受控版本仍为0.0.1，不构成正式发布。
- Scene/Spatial：对象注册表身份与代次句柄、资源引用及事务联合租约；Frame绑定校验、撤销后unresolved；静态四元数规范化、共同祖先路径解析。
- Time/Simulation/Resources：有理倍速、纳秒余数和有界FixedStepper；依赖失败传播与终态回收；CPU资源异步反馈状态机、不透明加载代次、迟到完成拒绝和停机清理。
- Engine/Protocol：共享一致FrameSnapshot及Partial、内部ProjectState恢复、新句柄/新任务代次；Scene/core Proto与同步命令、会话/版本/大小/存在性校验、有界幂等及提交事件。
- Rendering：用户选择wgpu技术原型；相机相对投影、层级可见性与裁剪、三角标记和精确形状拾取；离屏绘制、像素回读和资源预算回收。Native示例创建三个标记，WASM复用核心字节契约。
- 验证：tools/check.sh --gpu执行通过，默认64项/全功能65项测试，零失败、零忽略；全目标编译、格式、严格Clippy及wasm32构建通过。驱动为Mesa llvmpipe软件Vulkan，不等于硬件或浏览器验证；远端CI尚未执行。
- 复现：更新Cargo.lock、CI与云开发脚本，新增逐项开发进度表。后续相机、完整图元/材质、GPU恢复、项目Proto文件、完整SDK/Query、Web宿主、NASA插件、市场及AI功能仍未完成；详见原专项规范与进度表，不以原型冒充全部实现。
- 来源/风险/关联：新代码独立实现，未复制solarsystem参考代码或NASA资产；逐文件许可及科学时间仍待核验。改动基于09018022b2f9954d58124f51fad175eff037bfc4，提交关联见本节首条记录。

### 基础功能迭代：恢复工程基线与宿主时间推进
- 原因：开发分支的Spatial重复derive导致整个工作区无法编译，且Playing状态尚不能消费宿主经过时间。
- 范围：去除FrameSource重复Clone/Debug派生，将TaskStatus导入限制在测试模块，并按现有rustfmt门禁统一Rust代码格式；其余模块格式调整不改变行为。
- 功能：Time与Engine新增advance_nanos，宿主传入非负纳秒，播放时1倍速推进、暂停/零时长不变，不读系统时间、不增加TimeGeneration；时刻、修订及新入口快照序列溢出均在写入前拒绝。
- 验证：新增6项播放/暂停、零时长、累加一致性、溢出原子性、关闭与过期结果提交测试；工作区45项单元测试全部通过，0失败、0忽略；严格Clippy通过。Rendering和doc-test为零用例，不能作为功能验证。
- 复现：纳入本轮生成的Cargo.lock，更新README及Time专项规范。Rust 1.99.1/Linux Native；未验证WASM、GPU、浏览器、倍速/补步或科学时间换算。
- 版本/提交：0.0.1开发迭代，不构成正式版本发布；基于09018022b2f9954d58124f51fad175eff037bfc4，提交关联见本节首条记录。此前条目的“未运行”描述保留为历史事实。

- 2026-10-27：强化Rust Core CI，增加rustfmt与Clippy严格检查，保留workspace编译和单元测试。CI是否通过仍需GitHub执行确认；统一版本0.0.1。


- 2026-10-27：首批Proto实现：新增common.proto、time.proto及Rust生成与适配代码。新增单元测试源码，尚未运行Cargo/CI；其它Schema待开发。版本0.0.1。


- 2026-10-27：Simulation新增TaskProvenance（Scene/FrameGraph修订、提供者ID及版本、显式同尺度时间覆盖区间），支持任务派发前绑定和Engine最终Scene提交前复核；拒绝覆盖区间及修订不匹配。为兼容现有基础任务，未绑定来源的任务仍按旧规则处理，此严格校验尚未强制适用于所有任务。新增单元测试源码，Cargo/CI尚未验证。版本保持0.0.1。



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
