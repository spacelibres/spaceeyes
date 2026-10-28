# SPACEEYES Rust工程目录与模块依赖设计规范

版本：0.0.1｜状态：第11阶段设计草案｜日期：2026-10-27
范围：仅Markdown工程结构设计，不创建Cargo工程、Rust源码或测试文件。
依据：第08阶段对象模型、第09阶段Proto字段设计、第10阶段命令事件规范、已批准ADR-001至ADR-009。

## 1. 工程设计目标
Rust核心保持唯一源码，WASM和Native只承担不同编译目标与平台适配；Next.js/React/TypeScript为独立Web宿主。模块化与面向对象领域封装使用struct、impl、trait及组合。核心不依赖NASA DYN、具体天体目录、插件市场或AI模型。

## 2. 未来工程目录（规划，不创建）
```text
spaceeyes/
├── README.md
├── CHANGELOG.md
├── VERSION
├── docs/
├── proto/
│   └── spaceeyes/core/v1/
│       ├── common.proto
│       ├── time.proto
│       ├── spatial.proto
│       ├── scene.proto
│       ├── simulation.proto
│       ├── rendering.proto
│       ├── resources.proto
│       └── core.proto
├── crates/
│   ├── foundation/
│   ├── time/
│   ├── spatial/
│   ├── scene/
│   ├── simulation/
│   ├── resources/
│   ├── rendering/
│   ├── engine/
│   └── protocol-adapter/
├── adapters/
│   ├── wasm/
│   └── native/
├── apps/
│   └── web/
└── tools/
```
上述是目标结构，不要求所有逻辑对象各自形成crate；未来若拆分snapshot-types，必须保持其为无环的只读基础类型库。proto目录在设计阶段仅为路径约定。

## 3. crate职责
| crate | 负责 | 不允许负责 |
|---|---|---|
| foundation | ObjectId/FrameId/ResourceId、数学值类型、错误、不可变快照值类型 | 依赖上层引擎、NASA业务 |
| time | SimulationClock、TimeSnapshot、时间命令领域语义 | 轨道计算、UI系统时间读取 |
| astro | 历法、闰秒、UTC/TAI/TT/TDB、J2000 换算（纯值、无系统时钟） | 场景/渲染状态、宿主UI、网络与DYN文件读取 |
| dynamo | DYN v1/v2 解析、五类点、分段/覆盖、星历求值（纯字节与显式时间） | 网络/文件I/O、Engine/Scene 可变状态、宿主UI |
| spatial | ReferenceFrameGraph、TransformResolver、空间变换 | 场景对象所有权、DYN解析 |
| scene | Scene、SceneObject、SceneCommand事务、SceneSnapshot | GPU分配、星历计算 |
| simulation | SimulationScheduler、任务状态、依赖、结果校验 | 第二套Scene写入口 |
| resources | ResourceManager、资源租约、代次、配额、恢复元数据 | 插件身份授权、具体GPU绘制 |
| rendering | Renderer、相机派生视图、可见性、基础图元、GPU适配 | 修改Scene、推进Time |
| engine | Engine、CommandDispatcher、模块组合、FrameSnapshot原子发布 | 持有第二套Scene/Clock |
| protocol-adapter | Proto解码、版本校验、领域对象映射、错误编码 | 维护科学权威状态 |

## 4. 依赖方向
```text
foundation
  ├── time
  ├── spatial
  ├── scene
  └── resources
time + spatial + scene + resources ──> simulation
foundation + resources + snapshot-values ──> rendering
time + spatial + scene + simulation + resources + rendering ──> engine
engine + generated-proto ──> protocol-adapter
engine + protocol-adapter ──> wasm / native
```
箭头指向依赖方。若snapshot-values属于foundation，不必另建crate。scene只能保存FrameId值，不依赖Spatial的可变图。rendering只能读取FrameSnapshot值类型，不依赖Simulation的可变状态。

## 5. crate公开API与封装
每个crate对外只暴露稳定的领域接口、必要的只读值对象和结构化错误；内部registry、缓存、GPU句柄与状态机实现默认私有。跨crate调用通过明确trait和不可变输入/结果，不能将内部可变引用交给宿主或插件。
Engine是公开写命令的唯一协调入口；Scene的事务接口仅供受控核心调用，不向插件直接暴露。

## 6. 模块内对象组织建议
每个crate可按domain、interfaces、internal、errors、snapshot组织，但不强制复制相同目录层级。文件按职责拆分，禁止为每个struct机械创建单文件。trait放在拥有抽象需求的一侧，避免接口crate泛滥和循环依赖。
避免为实现面向对象而引入传统继承式层级；使用组合、封装与多态trait表达行为。

## 7. Engine与协议适配边界
ProtocolAdapter依赖Engine Facade公开接口，不能直接持有Scene/Time/Resources可变对象。CommandEnvelope通过Host授权和ProtocolAdapter校验后进入Engine；Query读取一致快照；Event和Response按第10阶段规范产生。
Rust内部不使用Proto生成对象作为权威领域模型。未来同一Schema生成Rust和TS类型，WASM与Native复用协议语义。

## 8. WASM适配
adapters/wasm负责JS字节缓冲桥接、浏览器画布/GPU设备、单调elapsed输入、宿主回调和错误映射。不得复制Scene、SimulationClock或Renderer的业务逻辑。WASM线程、SharedArrayBuffer及WebGPU能力均由平台适配声明，不作为核心的必备假设。

## 9. Native适配
adapters/native负责本机设备、窗口或本地服务的启动与传输桥接，复用同一Rust领域核心、Proto消息及错误语义。Native不是第二套核心实现。桌面计算能力和服务运行模式属于未来部署设计，本阶段不增加混合架构。

## 10. Web宿主边界
apps/web为Next.js/React/TypeScript界面，可由服务器提供浏览器访问，也可通过localhost访问。宿主负责身份、插件权限、网络代理、UI和SDK，不持有第二套仿真科学权威状态。核心与宿主通过Proto适配通信。

## 11. 插件与NASA DYN边界
NASA Dynamo作为未来首个独立数据插件，其下载、缓存、DYN解析和星历求值不放入crates/engine、spatial或simulation。插件经公开SDK提交带时间、参考系、来源和有效范围的标准化结果；核心只校验和消费。
AI未来通过版本化SKILL.md与SDK开发插件，不能直接依赖crate私有模块。

## 12. 工程配置与版本规划
未来Cargo workspace统一管理依赖版本、工具链、features和编译目标。禁止不同crate自行引入冲突版本或复制公共领域类型。项目VERSION、Cargo包版本、文档版本及CHANGELOG在受控发布时统一，工程创建前的历史规划基线为0.0.0，当前实现统一版本为0.0.1。100进1规则为0.0.99→0.1.0。此处不创建Cargo.toml或CI配置。

## 13. 禁止的依赖关系
- foundation不得依赖engine、scene、rendering或宿主。
- scene不得依赖NASA、插件宿主、rendering或protocol-adapter。
- spatial不得拥有SimulationClock或Scene可变状态。
- rendering不得依赖simulation可变任务队列。
- resources不得依赖具体渲染后端业务规则。
- protocol-adapter不得成为第二个状态管理器。
- wasm/native不得复制核心领域算法。
- 插件不得访问Rust核心私有crate。

## 14. 与已批准ADR的对应
ADR-001：Engine负责一致FrameSnapshot发布。
ADR-002：Engine唯一命令入口，Scene事务封装。
ADR-003：TimeGeneration由Time维护，Simulation校验结果有效性。
ADR-004：Simulation任务预算与Resources字节配额分离。
ADR-005：公开ID与内部代次句柄分离。
ADR-006：时间尺度与单位显式，科学零点仍待定义。
ADR-007：相机持久状态经受控命令，Renderer仅派生视图。
ADR-008：WASM/Native共用核心和Proto契约。
ADR-009：crate依赖单向、无环、可追溯。

## 15. 设计尚待定稿
foundation中的FrameSnapshot只读值类型与engine发布行为的具体拆分；rendering GPU适配与resources接口的抽象trait位置；Cargo package命名；WASM/Native feature组合；多视口相机状态归属。均属于后续文档设计细化，不需要在当前阶段运行编译或创建验证文档。

## 16. 后续阶段
第12阶段设计核心生命周期、对象状态快照与恢复规则；保持第08至11阶段的对象、协议、命令及目录定义一致。当前只提交Markdown设计文档。


## 17. 第13阶段快照与依赖归属澄清
SceneSnapshot和FrameSnapshot的不可变值类型可以放在foundation或独立无环snapshot-types，Engine负责构造及原子发布FrameSnapshot，Renderer只消费其只读接口。ProjectSnapshot属于协议与项目持久化设计，不作为foundation中的GPU资源对象。协议适配层依赖Engine公开Facade，不能反向成为Engine的编译依赖。项目恢复由Engine协调，WASM/Native只提供平台I/O与资源重建适配。


> 版本同步记录（2026-10-27）：随首次Rust核心开发启动，本受控文档升级至0.0.1。历史规划记录不改写。

## 0.0.1 geometry实现切片
新增geometry crate仅依赖foundation，提供通过构造器验证的不可变TriangleMesh/Vertex领域值。Resources拥有网格，snapshot共享只读值，Rendering只消费它们，Engine统一协调。geometry不依赖Proto、渲染器、宿主或NASA数据；Protobuf适配仍留在外层，正常crate依赖保持无环。

## 图像文件导入增量（0.0.1）
外层image-import模块接受最多8MiB的PNG/JPEG字节，解码尺寸最多2048×2048，仅支持8位不透明图像。调用方显式选择Linear/SRGB，不做ICC色彩转换；JPEG采用严格解码并应用EXIF方向。解码失败不得登记Resources。Native宿主负责有界文件读取，成功后通过现有Engine接口登记TextureData，核心不依赖文件或编解码器。本轮先交付库与Native文件导入；Proto压缩图像命令后续扩展。输入不可信时解码库的内部内存限制不能等同于进程级隔离。

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

## M1a Rust科学时间（0.0.1实施增量）

新增`crates/astro`，仅依赖`spaceeyes-time`，保持无环：提供严格公历校验与日数换算、1972–2100 UTC 闰秒表、UTC↔TAI、TT/TAI（同一J2000事件零点，常量32.184s由历元定义吸收）、TT↔TDB两项近似、J2000整数纳秒与`TimeInstant`（TAI/TT/TDB，epoch=J2000）无损往返。UTC超出1972–2100或表后日期必须显式`UtcOutOfRange`/预测标志，不静默近似；TDB近似仅为传输/显示模型，测试限定约1.8ms幅度，不宣称最终科学精度。

本轮只交付核心值与测试（8项单元+12项集成），不新增Proto、不修改浏览器；宿主仍不做任何时间换算。依赖方向为`foundation ← time ← astro`，astro不依赖scene/spatial/simulation/rendering/engine或宿主。

与第96行“DYN解析/求值不放入核心”的历史表述冲突处，按`docs/核心与宿主职责边界规范.md`执行：DYN解析/求值/分段是Rust核心能力（规划`crates/dynamo`），只读取字节与显式时刻，不拥有Scene/Clock可变状态；插件仅取字节并调用核心。


## M2a DYN 解析（0.0.1）

新增`crates/dynamo`（仅std，无网络/文件/宿主依赖）：严格小端读取v1/v2头、orb/pos/lin/ori/quat五类点（W-first四元数）、内联点块、索引段表、无头续段；所有长度在切片/分配前校验，负计数、非法类型/标志、名称越界/非ASCII、截断、块/段表大小不符均返回结构化`DynError`，不产生部分`DynFile`。解析不计算轨道、不插值、不读系统时钟。

验证：9项Rust测试（1单元+8集成）覆盖五类步长、v1/v2索引端推导、续段、空块、畸形输入与损坏尾随；M2b求值、M2c与TS合成黄金对照仍待完成。

## M2b DYN 求值（0.0.1）

`crates/dynamo`新增纯Rust求值：`evaluate(header, points, interval, time, body)`严格校验窗口（至少2点、同类型、时间严格递增、有限字段、覆盖区间），二分定位区间后在`pos`上做三次Hermite、`lin`上做线性、`quat`上做最短路径SLERP、`ori`上按`q*conj(axisAngle(ω,dt))`投影再SLERP并旋转负角速度、`orb`上做开普勒迭代（20次/0.1°容差，椭圆与双曲）并按重心质量比输出主/次天体因子。越界、非有限、重复/乱序、类型混用、抛物线与非法质量比分别返回`OutOfRange`/`InvalidSamples`/`UnsupportedOrbit`，不外推、不回退。

验证：10项Rust求值测试（圆轨道端点/中段/四分之一、重心因子、Hermite、线性、±四元数SLERP、ori投影与非退化插值、异常窗口、抛物/零轴/负质量比、双曲轨道）与解析9项合计19项通过；M2c将与TS oracle做同字节黄金对照。

## M2c TS oracle 黄金对照（0.0.1）

`packages/nasa-dynamo/scripts/emit-golden.mjs` 用固定TS参考生成23个合成案例（圆轨道、重心主/次、Hermite、线性、±四元数SLERP、ori投影/插值、双曲、越界、重复、抛物、零轴、负质量比、NaN），输出`crates/dynamo/tests/golden/synthetic.tsv`。Rust `tests/golden.rs` 对同一字节、时刻与body参数执行`evaluate`，逐字段比较（位置/速度或姿态/角速度，绝对容差1e-9，四元数按±等价）；所有23例通过。夹具为合成数据，不含NASA资产；仅当参考实现有意变更时运行`npm run golden --workspace @spaceeyes/nasa-dynamo`重生成。
