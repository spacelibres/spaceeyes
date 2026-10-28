# SPACEEYES Rust核心会话引擎（Engine）设计规范

版本：0.0.1｜状态：受控规范（Engine 定义与所有权已冻结）｜日期：2026-10-28
项目：SPACEEYES｜阶段：已实现核心；本文件定义 Engine 边界，不表示 Engine 拥有全部核心能力
依据：`docs/太空之眼平台架构书.md`、`docs/Rust核心架构设计基线.md`、ADR-001/002/009、`docs/核心与宿主职责边界规范.md`

## 0. Engine 是什么（一句话，强制）

**Engine（`crates/engine`）是会话提交引擎（Session Commit Engine），不是游戏引擎、渲染引擎、物理引擎、任务调度器、数据解码器或插件运行时。**

它只拥有五件事：

1. **会话生命周期**：`Created → Initializing → Ready → Running → Stopping → Stopped/Failed`，只由 Engine 迁移。
2. **公开写命令的准入、排序、幂等与会话绑定**：唯一公开写入口；先拒绝未授权、重复、过代次请求。
3. **跨模块提交边界**：按固定顺序校验、暂存、提交、回滚；失败不得留下半提交状态。
4. **FrameSnapshot 原子发布**：只由 Engine 在一个提交点构造并发布一致帧，维护帧序号。
5. **执行上下文绑定**：把任务 token、租约、场景修订、时间代次等“绑定索引”关联到具体任务/对象。

Engine **持有**模块对象（Scene/Clock/Spatial/Simulation/Resources/Rendering），但**不拥有**它们的领域规则；规则仍归各模块。Engine 的字段是组合与索引，不是第二套权威状态。

### 0.1 术语禁用规则

| 术语 | 唯一含义 | 禁止用法 |
|---|---|---|
| 核心 / Core | 全部 Rust crates（含算法、编解码、状态、协议） | 不要用“引擎”代指整个核心 |
| Engine / 会话提交引擎 | `crates/engine`，只做会话/命令准入/提交/帧发布 | 不要称“渲染引擎/游戏引擎/物理引擎/调度引擎” |
| Dispatcher / 命令分发器 | `crates/engine` 内的命令准入与幂等边界，不含领域规则 | 不要把它当第二套状态或业务处理器 |
| ProtocolAdapter | Proto ↔ 领域映射、错误编码 | 不要让它直接改 Scene/Clock/Resources |
| Host | TS/Next.js、插件宿主、WASM 生命周期 | 不要称 Host 为“引擎” |
| Renderer / Rendering | `crates/rendering`，相机派生视图、拾取、GPU 绘制 | 不要让它推进时钟或写 Scene |
| Scheduler / Simulation | `crates/simulation`，任务队列、预算、结果校验 | 不要让它直接提交 Scene |
| Runtime | Native/WASM 平台运行时 | 不要与 Engine 混用 |

**文档与注释必须写“核心”或“Engine（会话提交引擎）”，禁止裸写“引擎”指代整个 Rust 核心。**

## 1. 设计目标与边界

Rust为核心唯一源码，WebAssembly和Native仅是不同编译目标。首期聚焦NASA Eyes类太阳系三维探索基础能力；长期不限制地球、太阳系或特定天体类别。核心不依赖Next.js/React、NASA DYN、天体目录、插件市场或模型供应商。

**核心职责**：基础值、通用数学、时间、天文算法、格式解码、场景状态、参考系与变换、仿真时钟、任务调度、渲染抽象、相机派生视图、资源管理、公开命令/查询/事件、快照与错误语义。

**Engine 职责**：会话生命周期、唯一公开写命令入口、跨模块提交与回滚、FrameSnapshot 原子发布、执行上下文绑定。

**Engine 非职责**：星历/轨道/时间尺度算法、DYN/图像等格式解码、Scene/Spatial/Time/Resources 的领域规则、任务调度算法、渲染/拾取/GPU 绘制、Proto 校验、插件与宿主 UI。这些分别归 `astro`/`time`/`codecs`、`scene`/`spatial`/`time`/`resources`、`simulation`、`rendering`、`protocol-adapter`、Host。

## 2. 不变的设计约束

1. 模块化、面向对象领域建模、封装优先；Rust使用`struct + impl + trait`与组合，不强制继承。公开状态修改必须通过命令和校验。
2. 一个权威场景状态、一个权威仿真时钟；不得并行建立第二套对象模型。
3. 所有公开跨模块结构化数据交换遵循版本化Protobuf；核心内部热路径使用Rust原生结构和连续内存，不要求每次计算序列化。
4. Rust核心内部不依赖Proto生成类型作为领域对象；由协议适配层进行双向映射。
5. 不允许业务插件直接操作Rust内存或注入未经审核的渲染代码。
6. 文档与代码版本统一0.0.1；任何代码修改须有可追溯日志和验证记录；规则变更先于实现。

## 3. 依赖方向（组合，不是所有权）

```text
Host / TS SDK / UI（核心外）
             |
     ProtocolAdapter（仅 Proto ↔ 领域映射）
             |
     Engine（会话/准入/提交/FrameSnapshot）
       |        |         |          |
     Scene   Spatial     Time     Simulation
       |        |         |          |
       +--------+---------+----------+
                |
            Resources
                |
            Rendering ──> 只读 FrameSnapshot / Resources
```

通用算法与解码位于更下层，Engine 不依赖它们的细节，只通过领域接口/数据使用：

```text
math ──> astro ──> codecs/<format>
time ──> spatial/scene/simulation
```

- `engine` 负责组装和提交边界；不得实现 `scene`/`spatial`/`time`/`simulation`/`resources`/`rendering` 的领域规则。
- `rendering` 只读 `FrameSnapshot`，不反向写 Engine/Scene/Clock。
- `protocol-adapter` 依赖 Engine 公开接口；不得绕过 Engine 直接调用领域模块。
- 所有依赖单向、无环；禁止把 Proto、格式类型或宿主回调带入 Engine。


## 4. 核心对象模型

| 对象 | 主要责任 | 关键不变量 |
|---|---|---|
| `Engine` | **仅**会话生命周期、命令准入边界、跨模块提交/回滚、FrameSnapshot 原子发布、执行上下文绑定 | 生命周期单向；停机后不接受写命令；不持有第二套 Scene/Clock/Resources |
| `Scene` | 注册/查询/移除对象、对象关系、快照 | ID唯一；无父级环 |
| `SceneObject` | 通用身份、变换、可见性、资源句柄 | 不嵌入NASA或地球专用字段 |
| `ReferenceFrameGraph` | 层级参考系、变换组合 | 无环、参考系存在、变换时间有效 |
| `SimulationClock` | 时间、播放/暂停/跳转、固定逻辑步长 | 时间尺度与历元明确；步进单调规则明确 |
| `SimulationScheduler` | 更新阶段、任务预算、结果应用顺序 | 结果与目标仿真时间一致 |
| `Renderer` | 视图、相机、拾取、绘制提交 | 不修改科学权威状态 |
| `ResourceManager` | 句柄、配额、所有权、释放 | 句柄代次校验；释放幂等 |
| `CommandDispatcher` | 命令准入、授权、幂等、顺序；持有命令历史，不持有领域状态 | 未授权/重复/过期命令不能进入 Engine 提交窗口 |
| `Snapshot`（Scene/Frame/Project） | 局部只读视图、渲染一致帧、持久化投影；不拥有领域规则 | 版本可识别；Frame 只由 Engine 发布；Project 不含句柄/GPU |

宿主`PluginManager`不属于Rust核心对象。

## 5. 场景与对象生命周期

候选状态：Created → Attached → Active → Detached → Disposed。场景通过不可复用的代次句柄避免悬空引用；删除父对象必须明确定义子对象删除、转移或拒绝策略（待审定）。所有写入经 CommandDispatcher 准入并由 Engine 提交；Scene 是场景规则唯一权威。查询返回只读视图或快照，不返回可变内部引用。对象的渲染资源与业务身份分离。

## 6. 空间与数值精度

- 持久化位置采用双精度与明确参考系；禁止隐式地心、默认地球半径或裸坐标。
- 支持星系、恒星系统、天体中心、天体固连、局部区域的分层参考系；核心负责图关系与变换组合，领域插件提供物理定义与随时间变换。
- 渲染端采用相机相对坐标/局部原点和必要的高低位拆分；具体GPU策略需原型验证。
- 长度、速度、角度与时间必须在协议中声明单位；坐标转换需要有效历元与状态。
- 不能以单个浮点世界坐标同时解决星系尺度与表面厘米细节。

## 7. 仿真时间与调度

区分`simulation_time`、`real_elapsed`和`render_frame_time`；时间跳转使旧计算任务结果失效。固定逻辑步进与渲染帧分离，暂停只停止仿真推进而不停止界面渲染。时间基准、历元、TDB/TT/UTC转换边界待正式协议审定；不得默认为同一种时间尺度。结果按时间戳、请求代次和任务状态应用，迟到结果丢弃或明确等待，不静默覆盖新状态。

## 8. 渲染与GPU抽象

核心提供相机、基础图元/材质、渲染调度、拾取和资源句柄。渲染只读取Engine原子发布的FrameSnapshot（其中包含一致的Scene、Time、Spatial只读状态），不反向推进科学仿真。WebGPU/Rust图形后端及降级策略待技术原型比较；不得先承诺特定浏览器兼容。GPU设备丢失须停止提交、重建可恢复资源并报告不可恢复对象。领域显示通过组合公开图元；新增渲染原语经核心版本审定。

## 9. 资源与错误

资源句柄包含类型、所有者和代次；定义CPU/GPU预算、引用释放、取消与崩溃清理。错误类别至少有参数非法、状态冲突、引用失效、资源不足、能力不支持、时间/参考系不匹配、设备丢失、任务取消。核心错误结构化返回，禁止将接受任务当作完成任务。

## 10. Protobuf边界

公开接口：Command、Query、Event、Resource、Snapshot；协议具有版本、请求ID、项目ID、对象ID、时间、参考系、错误码。协议Schema独立于Rust内存布局和编译目标；适配层负责消息校验及领域对象映射。二进制资源可采用批量缓冲和句柄，元数据仍通过Proto。未来gRPC可以复用消息，但不提前实现服务网络栈。

## 11. WASM与Native编译

`core`无浏览器全局依赖，WASM适配负责JS边界、画布和浏览器GPU；Native适配负责操作系统窗口或本机服务的运行时桥接。首期先验证WASM的最小可运行闭环，Native保留同源编译与依赖检查的设计空间。统一Web UI位于宿主，不进入Rust核心。

## 12. 测试与阶段门

| 阶段 | 必须提供的证据 |
|---|---|
| C0 设计冻结 | 对象关系、模块依赖、Proto边界、ADR无冲突 |
| C1 纯Rust核心 | 场景创建/删除、时钟步进、参考系图、资源代次的单元测试 |
| C2 WASM适配 | 浏览器创建场景、相机控制、拾取、基本绘制及资源释放 |
| C3 多尺度 | 指定尺度与相机距离下位置精度、抖动、裁剪验证 |
| C4 协议闭环 | TS→Proto→核心命令→Proto结果/事件的契约测试 |
| C5 插件可接入性 | 用模拟宿主通过公开接口驱动核心，不实现真实DYN插件 |

性能阈值、误差预算、设备矩阵必须在C1/C2实测后冻结，不预先编造FPS或精度承诺。

## 13. 必须审定的设计决策

- 场景对象身份与代次句柄格式；父对象删除语义。
- 核心参考系图的时间相关变换输入与缓存策略。
- 时间尺度、历元及Proto单位规范。
- Rust渲染后端、WASM图形能力与降级策略。
- SceneSnapshot数据布局、渲染读取与更新同步机制。
- 命令事务与批量操作原子性、事件顺序。
- Native首期是否仅编译检查，或需要最小运行验证。
- **已冻结（2026-10-28）**：Engine 术语=会话提交引擎；所有权矩阵、提交/回滚、快照边界、API 禁止项见第0/16–24节。

## 14. 与后续插件和AI目标的关系

核心只提供稳定可发现的能力和协议。NASA Dynamo是未来首个数据插件，不得反向影响核心对象模型。每项公开SDK能力必须配套版本化技能书，支持最终AI在不修改核心的前提下生成、测试、安装插件。**本阶段不实现插件、市场或AI开发流水线。**


## 15. 第13阶段统一设计语义
Engine 是**会话提交引擎**：唯一公开写命令入口、生命周期协调、跨模块提交/回滚和 FrameSnapshot 原子发布；不拥有领域规则。Scene 是场景唯一权威，Time 是时钟与时间尺度唯一权威，Spatial 是参考系权威，Resources 是资源/上传权威，Rendering 是相机派生视图/拾取/GPU 权威，Simulation 是任务调度权威；Simulation 可并发计算但不得直接写 Scene。Paused 是 Time 播放模式而非 Engine 生命周期。SceneSnapshot 是局部只读状态，FrameSnapshot 是渲染一致帧，ProjectSnapshot 是项目持久化，三者不得互换。以上遵循 ADR-001 至 ADR-009；实现范围以 CHANGELOG 为准。


> 版本同步记录（2026-10-28）：本受控文档定义 Engine 会话提交边界；历史规划说明保留为历史记录。实际实现范围以 CHANGELOG.md 与验收台账为准。

## 16. Engine 所有权矩阵（强制）

### 16.1 两层“唯一写入口”

1. **外部写入口唯一**：Host/插件只能经 `ProtocolAdapter → CommandDispatcher → Engine` 提交；不得直接调用 Scene/Spatial/Time/Resources/Simulation 的写 API。
2. **模块语义唯一**：每个模块仍是自身规则的唯一权威；Engine 只能调用模块公开的事务/命令 API，不能直接改其内部字段，也不能在 Engine 里复制一份规则。

### 16.2 状态归属表

| 状态/能力 | 唯一权威 | Engine 可以做什么 | Engine 禁止做什么 |
|---|---|---|---|
| 会话生命周期 | **Engine** | 迁移 Created/Initializing/Ready/Running/Stopping/Stopped/Failed；拒绝写命令 | 把 Paused 当生命周期；让模块自行切换会话状态 |
| 公开命令准入/幂等/顺序 | **Dispatcher（engine 内）** | 校验 requestId、授权、expectedRevision、timeGeneration；保存命令历史 | 在 Dispatcher 里实现 Scene/Time/Resource 规则 |
| 场景对象/层级/事务 | `scene` | 调用 Scene 事务；在提交点取只读快照 | 维护第二份对象表；直接改对象字段；绕过 Scene 事务 |
| 参考系图/变换 | `spatial` | 调用注册/更新/解析接口；校验修订 | 自己算变换；复制参考系图；伪造缺失覆盖 |
| 时钟/时间代次 | `time` | 委托 advance/seek/rate；读取 TimeSnapshot | 自己换算 UTC/TAI/TT/TDB；自己推进时间；把标签当换算 |
| 任务队列/预算/结果状态 | `simulation` | 创建执行上下文；启动/取消/接收结果；提交结果 Scene | 自己维护任务状态机；自己调度 worker；把“接受任务”当“完成” |
| 租约/配额/上传状态 | `resources` | 把 leaseId 绑定到 task/object；路由 begin/append/finish；在停机时请求释放 | 复制配额/租约表；自己计算资源占用；绕过 ResourceManager 释放 |
| 相机派生视图/拾取/GPU | `rendering` | 调用 prepare/present/pick；发布只读 FrameSnapshot 给渲染 | 实现聚焦/跟随几何；实现拾取算法；持有 GPU 绘制代码 |
| FrameSnapshot | **Engine** | 在一个提交点从模块快照组装并原子发布；维护 frame sequence | 局部修补已发布帧；让 Renderer 反向写；把 GPU 句柄放进项目快照 |
| ProjectSnapshot | Snapshot/Engine 编排 | 从模块导出值组装持久化投影；恢复时先全量校验再一次性替换 | 保存可变内部引用/执行栈/GPU 指针；恢复一半状态 |
| 科学算法（时间/星历/轨道） | `time`/`astro` | 只接收结果值/调用查询 | 在 Engine 写 Kepler、插值、闰秒、J2000 换算 |
| 文件格式解码 | `codecs/<format>` | 只接收解码后的中性数据 | 在 Engine 解析 DYN/PNG/JPEG/星表 |
| 协议校验/错误编码 | `protocol-adapter` | 只处理领域对象/错误 | 在 Engine 引入 Proto 类型或 wire 字段 |

### 16.3 Engine 允许持有的数据（仅这些类别）

- 生命周期状态、session 标识、帧序号。
- 最近一次原子发布的 `FrameSnapshot`/`FramePublished`。
- `taskId → TaskExecutionToken / TaskContext / 目标修订` 绑定索引。
- `objectId → leaseId[]` 绑定索引。
- 任务预算、来源策略等**配置**（执行/校验仍归 Simulation/Resources）。
- 命令历史与幂等记录（Dispatcher 持有）。

**禁止**：第二份 Scene 对象表、第二份 Clock 值/代次权威、第二份 Resource 配额/租约表、第二份 Spatial 图、第二份任务状态机、渲染缓存或 GPU 资源所有权。

## 17. 提交协议与原子性（强制）

每次公开写命令必须按以下顺序：

1. **准入**：Dispatcher 校验 requestId 幂等、授权、session、expectedSceneRevision、timeGeneration；失败在触碰状态前返回。
2. **绑定**：Engine 绑定 session 与执行上下文（任务 token/目标修订/租约）；异步任务还必须绑定目标对象或场景修订。
3. **校验**：Engine 调用模块只读校验（引用存在、时间覆盖、空间覆盖、资源就绪、预算）。
4. **暂存/提交**：单模块命令直接调用该模块事务；多模块命令先完成所有可失败校验，再按固定顺序提交。
5. **回滚/补偿**：任一提交失败，必须回滚已暂存修改或执行明确补偿；不得暴露半提交状态。
6. **发布**：全部提交成功后，Engine 才组装并发布新的 FrameSnapshot，递增帧序号。
7. **回执/事件**：响应与事件只引用已提交的修订/代次；失败返回结构化错误。

### 17.1 原子性矩阵

| 场景 | 规则 |
|---|---|
| 单模块命令 | 由该模块事务保证全成/全败；Engine 只在成功后发布帧 |
| 同步多模块命令 | 先做全部可失败校验；提交顺序固定；后续失败必须回滚/补偿已提交部分，否则整批拒绝 |
| 异步任务结果 | 校验 token、时间代次、目标 Scene 修订、时间/空间覆盖、来源；通过后用一个 Scene 事务提交；迟到/代次不符丢弃，不覆盖新状态 |
| 资源上传 | Resources 先预留；Engine 只做会话准入与路由；finish 成功后才可被 Scene 引用；失败取消预留 |
| 项目恢复 | 先在临时模块集合中全量校验/构造，再一次性替换；失败保留旧状态，不进入半恢复 |
| 停机 | 先拒绝新写，再取消/等待任务、释放租约、清理上传，最后进入 Stopped；期间不得发布新帧 |

## 18. 三类快照（不得互换）

| 快照 | 生产者 | 内容 | 使用者 | 禁止 |
|---|---|---|---|---|
| `SceneSnapshot` | Scene | 场景对象/关系的局部只读视图 | Engine/查询 | 当渲染一致帧；当项目文件 |
| `FrameSnapshot` | **仅 Engine** | 同一提交点的 Scene/Time/Spatial/Resource 修订与帧序号 | Rendering/查询 | 局部修改；包含可变引用/GPU 句柄；由 Renderer 发布 |
| `ProjectSnapshot`/`ProjectState` | Engine 编排 + Snapshot | 可持久化的场景/时钟/参考系/资源值 | 项目保存/恢复 | 保存句柄、执行栈、GPU 指针；直接当运行时状态 |

## 19. 生命周期与停机

- 状态只由 Engine 迁移；模块不得自行切换 Engine 状态。
- `Paused` 是 Time 播放模式，不是 Engine 生命周期。
- Engine 进入 `Stopping` 后：拒绝新写；取消或等待任务；释放任务/对象租约；取消未完成上传；禁止发布新帧。
- `Failed` 后只允许状态/诊断查询；不得继续写；恢复必须新建 Engine 或从已验证 ProjectSnapshot 全量恢复。
- `Stopped/Failed` 不得伪装成 `Ready`；错误必须可查询。

## 20. Engine API 规则

允许公开：

- 生命周期：initialize/start/stop/shutdown/status。
- 命令入口：由 Dispatcher 统一接收领域命令；Engine 只做绑定/提交。
- 只读查询/快照：EngineSnapshot、FrameSnapshot、模块只读视图。
- 帧发布：只有一个发布方法，且只能在提交成功后调用。

禁止公开/禁止实现：

- 领域算法 API（时间换算、Kepler、插值、轨道采样）——去 `time`/`astro`。
- 格式解码 API——去 `codecs`。
- Proto 类型、wire 字段、错误码——留在 `protocol-adapter`。
- 可变模块引用、模块内部字段、可直接改 Scene/Clock/Resources 的通道。
- 宿主回调、DOM/网络、插件运行时。
- 第二套状态缓存或“临时方便”的镜像表。

## 21. 测试与审查归属

| 测试 | 归属 | 必须覆盖 |
|---|---|---|
| Engine 编排 | `crates/engine` | 生命周期、准入/幂等/顺序、回滚、帧一致性、租约绑定、迟到结果、停机 |
| 模块规则 | 各模块 | 该模块事务/不变量/错误 |
| 协议映射 | `protocol-adapter` | 字段/错误码/wire 兼容 |
| 解码 | `codecs/<format>` | 字节边界/损坏/长度 |
| 算法 | `astro`/`time`/`math` | 数值/边界/覆盖 |
| 用户路径 | `apps/web` | 只测 UI/交互/展示，不复刻科学公式 |

禁止用 TS 测试替代 Engine/模块规则；禁止在 Engine 测试里重写算法来“验证”。

## 22. 归属判定清单（新增代码前逐条回答）

1. 这是领域规则（Scene/Spatial/Time/Simulation/Resources/Rendering）吗？→ 归该模块，不进 Engine。
2. 这是时间/星历/轨道/数学算法吗？→ `time`/`astro`/`math`，不进 Engine。
3. 这是文件格式字节吗？→ `codecs/<format>`，不进 Engine。
4. 这是 Proto/错误码/授权映射吗？→ `protocol-adapter`，不进 Engine。
5. 这是 UI/网络/插件/DOM 吗？→ Host，不进核心。
6. 这是会话生命周期、命令准入、提交顺序、回滚、帧发布、执行上下文绑定吗？→ 才可进 Engine。
7. 去掉所有领域模块后，这段代码还能独立存在吗？不能则说明它属于领域模块。
8. 它是否复制了某个模块的状态/规则？是则删除副本，改为调用模块。

**Engine 体量检验**：把 Scene/Clock/Spatial/Simulation/Resources/Rendering 全部替换为 trait 假实现后，Engine 应只剩会话/准入/提交/帧发布/绑定代码；若仍包含相机、拾取、轨道、时间换算、格式解析，则边界已泄漏。

## 23. 现状偏差与迁移项（必须消除，不得当先例）

| 现状 | 问题 | 目标归属 | 迁移要求 |
|---|---|---|---|
| `engine/src/camera_control.rs` 的聚焦/跟随几何 | 相机策略属于渲染/相机域，不是会话提交 | `rendering`（相机服务）或 `scene` 相机命令服务 | 迁移前只允许作为临时 facade；不得再向 Engine 增加相机几何 |
| `engine/src/selection.rs` 的拾取视图 | 拾取属于 Rendering 只读能力 | `rendering` | 迁移前只允许只读转发；不得在 Engine 实现拾取算法 |
| `engine/src/upload.rs` | 若只是会话准入/路由则允许；若增长为上传状态则越界 | `resources` 持有上传状态；Engine 只做 facade | 保持无状态转发；出现第二份 upload 状态即迁移 |
| `engine/src/dispatcher.rs` | 允许：准入/幂等/历史 | Engine 层 | 不得加入 Scene/Time/Resource 规则 |
| `EngineSnapshot`/`ProjectState` | 允许：聚合投影 | Engine/Snapshot | 不得变成权威状态；恢复必须全量校验后替换 |
| `source_policy`/`task_budget` | 允许：会话配置 | Engine 持有配置，Simulation/Resources 执行 | 不得在 Engine 实现调度/预算算法 |

> 本表是“规则先于代码”的强制项：后续任何提交不得扩大这些偏差；迁移时先改规则/测试，再移动实现。

## 24. 与其他规范的关系

- ADR-001（Engine 统一提交者/FrameSnapshot）与 ADR-002（唯一公开命令入口/Scene 事务）继续有效；本节把“提交者”限定为会话提交，不授予 Engine 领域规则所有权。
- `docs/Rust工程目录与模块依赖设计规范.md` 第0/3节定义层级与目录；本文件定义 Engine 的语义边界。
- `docs/核心与宿主职责边界规范.md` 定义 Rust 与 Host 的边界；Engine 只是 Rust 核心的提交门面，不是 Host 的“总引擎”。
- 与旧版“核心引擎”泛指整个核心的表述冲突时，以本节术语规则为准；历史段落保留但不得据此扩大 Engine 职责。

> 规则变更记录（2026-10-28）：Engine 正式定义为“会话提交引擎”；新增术语禁用、所有权矩阵、提交/回滚协议、快照规则、API 禁止项、测试归属、判定清单与现状偏差。仅文档变更，未修改代码。
