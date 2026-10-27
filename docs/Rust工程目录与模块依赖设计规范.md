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
