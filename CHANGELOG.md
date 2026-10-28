# CHANGELOG

项目：SPACEEYES｜统一开发版本：0.0.1

## [0.0.1] — 2026-10-27


### 材质透明度与土星环（C13 切片）
- `Material` 新增 0–1 的 `alpha`（默认 1），Proto `Material.alpha=6`；渲染新增透明管线（AlphaBlending、关闭深度写入、在 opaque/线之后绘制，顶点携带 alpha）。
- 浏览器太阳系新增土星环网格对象 `solar:saturn-ring`（unlit、alpha=0.8）与中文名称。
- 验证：scene 1 项材质、rendering GPU 透明混合+线图元、Web 10 项 Chromium（对象数≥21）通过。


### 核心线图元（C13 切片）
- Scene 新增 `LinePrimitive`（2–4096 点、有限坐标、RGB）与 `SetLine`；渲染生成相机空间线段，不可拾取；GPU 新增 LineList 管线并共享材质布局与深度状态。
- Proto 新增 `LinePrimitive`、`SetLine`、SceneObject.line=11；能力新增 `scene.set_line`（总数 40）。
- 验证：scene 2 项、rendering CPU+GPU 真实像素、protocol-adapter 线往返边界测试通过。


### 权限扩大重授（P03/P08 切片）
- `PluginHost.expandGrant` 仅在插件停用时可用；请求必须是现有授权的超集，每项仍受宿主策略与上限约束，拒绝时保留原授权。
- 成功后需重新启用；撤权插件拒绝扩大；仍为同进程宿主，不构成沙箱隔离。
- 验证：plugin-host 10 项单测通过。


### 插件贡献点声明与生命周期联动（P03 切片）
- 清单新增可选 `contributions`（panel/layer/command，最多 16 项，标题与非控制字符受限，同一插件内唯一）；`activeContributions()` 以 `pluginId:contributionId` 命名空间暴露。
- 贡献点随启用出现、停用消失、撤权后不可恢复；不构成渲染或写入权限。
- 验证：plugin-host 9 项单测通过。


### 项目文件 v2 清单与 v1 迁移（C11 切片）
- 新增 v2 容器：清单长度/载荷长度、覆盖清单与载荷的 SHA-256、项目标识与墙上时钟纳秒；v1 文件仍可读取并映射为空清单。
- 浏览器保存写入 v2（`encodeProjectFileWithTime`，项目标识 `spaceeyes-browser`），打开兼容 v1/v2；清单篡改/越界/倒序时间拒绝。
- 验证：protocol-adapter 4 项容器测试、Web 构建与 10 项 Chromium 通过。


### 上传墙钟超时（C09 切片）
- 上传会话可记录宿主单调 tick；`expire_uploads` 取消超期会话并释放预留，tick=0 永不自动过期。
- 浏览器 WASM 注入 `performance.now()`、默认 15 分钟 TTL，在下一条命令前回收；Engine 提供显式过期入口。
- 验证：engine 2 项过期测试。


### 完整生命周期与两阶段初始化（C10 切片）
- `EngineState` 补齐 Created/Initializing/Stopping/Failed；`Engine::prepare` + `initialize(closure)` 支持初始化失败清理并进入 Failed；`begin_shutdown`/`finish_shutdown` 分离拒绝写入与资源释放，`shutdown` 幂等。
- 所有写入口统一为仅 Ready/Running 接受，Stopping 保留资源但拒绝新命令/任务。
- Proto `EngineLifecycle` 追加 CREATED=4、INITIALIZING=5、STOPPING=6、FAILED=7。
- 验证：engine 4 项生命周期测试与既有测试通过。


### 正交投影相机（C13 切片）
- `CameraState` 新增 `CameraProjection`（透视/正交），正交使用米制 `half_height_m`；`focus_camera` 保留原投影；Proto `Projection` 新增 `orthographic` kind=2。
- 渲染统一 `ViewProjection`：NDC、深度、clip 与拾取射线按投影分支，正交屏幕尺寸与距离无关。
- 验证：scene 正交校验、rendering CPU 拾取与 GPU clip 单测、相机 Proto 往返、SDK 互通 10 项通过。


### 参考系覆盖区间查询（C04 切片）
- `TransformProvider::coverage` 与 `ReferenceFrameGraph::coverage`：只返回动态提供者声明的同标度/历元区间；静态/提供者样本为 `None`，非法区间拒绝。
- Proto 新增只读 `query.frame_coverage`（31/22），`covered=false` 不推断覆盖，未知帧 `UNKNOWN_FRAME`；能力总数 39。
- 验证：spatial 3 项、protocol-adapter 20 项 session、SDK Native/WASM 10 项互通通过。


### 恢复失败提示与当前会话保护（C11 切片）
- 新增 WASM `validateProjectFile`（容器/摘要/schema 完整校验，不创建会话）；浏览器打开项目前先校验，失败保留当前场景并显示可见错误。
- Playwright 覆盖：保存→打开成功后上传篡改文件，错误可见且场景继续运行。


### 编码图片上传的 Native/WASM 互通（C08/C09 补充）
- SDK 互通测试新增 2×1 PNG 上传：验证 `max_encoded_image_bytes`、PNG 受理、核心解码与按解码后字节计费，并与大纹理共存。
- Native 与真实 WASM 同一 TS 客户端响应逐字节对照。


### 受控磁盘来源加载器（C09 切片）
- 新增原生 `DiskSource`：根目录白名单、只接受根内相对路径、拒绝绝对路径与 `..`、读取后二次规范检查、文件大小上限与 SHA-256 校验。
- 通过既有 `begin/append/finish_upload` 发布，保持所有权、预算与修订原子性；校验失败零预留。WASM 目标不含该模块。
- 验证：resources 3 项磁盘测试。网络加载、墙钟超时与并发 I/O 仍未实现。


### 受控 PNG/JPEG 上传解码（C09 切片）
- 上传格式新增 `EncodedImage`（Proto PNG=3/JPEG=4）与 8 MiB 上限及 `max_encoded_image_bytes` 能力。
- 核心用 `image-import` 解码，声明 codec 必须匹配实际魔数，失败返回 `InvalidFormat` 并释放预留。
- 完成上传按解码后 RGBA 字节重新计费；超出 CPU/总额预算则取消并返回 `BudgetExceeded`，不只按压缩体积计费。
- 验证：resources 4 项编码上传测试、protocol-adapter 2 项 wire 上传通过。


### 项目文件容器与完整性校验（C11 切片）
- 新增 v1 项目文件格式：魔数、格式版本、载荷长度、SHA-256 摘要与 `ProjectSnapshot` 载荷，上限 16 MiB；截断、尾随字节、篡改与未知版本分别拒绝。
- 原始 protobuf 不再作为可信文件；`WasmEngine.from_project` 先校验容器，新增 `encodeProjectFile` 供浏览器保存封装。
- 浏览器保存→打开与 DYN 场景识别适配新容器。
- 验证：protocol-adapter 3 项容器测试、Web 构建与 10 项 Chromium 通过。


### 参考系导数与解析缓存（C04 切片）
- 新增 `FrameDerivative`/`FrameState` 与 `TransformProvider::derivative_at`（缺省无导数）；`resolve_state` 沿链合成变换与角速度/线速度，含 ω×r 与逆变换，缺导数返回 `DerivativeUnavailable`。
- `FrameState::point_velocity` 给出源系固定点在目标系的瞬时速度。
- `resolve` 增加按源/目标/显式时刻键控的 256 项有界缓存，图修订变化即失效。
- 验证：spatial 5 项导数测试与既有测试通过；覆盖区间/来源元数据、插值与科学参考系仍未实现。


### 有界事件流与游标重放（C12 切片）
- Proto 新增只读 `query.events`（`EventsQuery`/`EventPage`/`CoreEvent`/`CoreEventKind`），能力总数增至 38，SDK 响应映射同步。
- 事件序列单调递增，默认/最大页 128；高于当前序列的游标返回 `STALE_GENERATION`，溢出时以 `replay_from` 暴露丢失窗口。事件缓冲与命令幂等历史分开配置。
- 成功命令按类型产生 Scene/Clock/Frame/Resource 事件，宿主呈现帧产生 `FRAME_PUBLISHED`；失败、幂等重试与纯查询不产生事件。
- 验证：engine 4 项事件测试、protocol-adapter 19 项 session、SDK Native/WASM 互通 10 项通过。


### 原生工作池与严格来源策略（C06 切片）
- `crates/simulation` 新增原生 `WorkerPool`：有界队列、`TaskPriority` 派发顺序、单任务墙钟截止、协作取消、`WorkerOutcome` 回报与 `close` 清理；Engine 新增 `enqueue_task_with_priority` 与 `WorkerOutcome → ExecutorFeedback` 映射，结果仍经 token/代次/时刻校验。
- 新增 `SourcePolicy`（open/strict），在绑定与提交两处校验 provider 版本与覆盖范围；`Engine::set_source_policy` 由宿主配置。
- 超时只报告 TimedOut 并拒收迟到结果，不声称抢占阻塞线程；WASM 目标不编译线程池。
- 验证：simulation 5 项 worker + 2 项策略单测、engine 3 项集成；WASM 编译通过。


### 已发布快照、会话身份与 Stale 语义（C10 切片）
- `FrameAvailability` 新增 `Stale`（仅用于保留旧帧的视觉回退）；`FrameSnapshot` 携带 `session`，`SessionStatus` 携带会话并在 Proto 追加 `session_id=9`。
- `Engine` 一次性绑定宿主会话；`commit_frame` 原子替换已发布记录与保留帧并追加有界 `FramePublished` 事件；抓取失败保留最后一致帧并置 Stale，后续状态推进与 Stop 同样使旧帧变 Stale。
- `retained_frame` 返回显式 STALE 副本；`Pick::validate`、`PresentedSelection::pick` 拒绝 STALE、旧序号与其他会话。
- 验证：engine 7 项 frames 与 1 项跨会话拾取、rendering/snapshot/protocol-adapter 定向测试；完整生命周期状态与 STALE 宿主界面仍待后续。


### 资源 LRU 淘汰（C09切片）
- ResourceManager记录最近租用序并新增evict_lru(target)：仅淘汰已就绪、非上传中、无租约的CPU资源；旧帧/读取者持有的Arc副本不被强拆，管理器移除Id并更新字节/修订。
- Engine新增evict_resource_cache并跳过Stopped；Scene对象租约保持资源不可淘汰，删除对象释放后可回收。未新增Proto命令，淘汰由宿主策略显式调用。
- 验证：resources 2项cache测试（LRU顺序/租约/声明与加载跳过/原子修订/零目标）、engine 1项集成（Scene租约、删除后回收、Stop拒绝）；未逐次全量。

### 对象分页查询（C12切片）
- Proto新增ListObjectsQuery/ObjectPage，QueryEnvelope 28与ResponseEnvelope 20；按ObjectId字典序返回场景对象，支持0-256页大小与不透明page_token，返回next_page_token与scene_revision。
- ProtocolAdapter校验页大小/令牌长度，Stopped拒绝；查询只读、不推进时钟、不消耗命令历史。能力总数增至37。
- 验证：protocol-adapter 18项session（含分页稳定性/越界/删除令牌续读）、Native/WASM互通10项、生成类型无漂移；未逐次全量。

### 太阳系九大天体显示
- 太阳系模式扩展为太阳、水星、金星、地球、月球、火星、木星、土星、天王星、海王星；每个天体使用同一DYN提供者帧与显示轨道管，月球的轨道挂在地球参考系。
- 合成Chromium路径要求至少20个场景对象并验证水星/土星/海王星请求；不引入NASA夹具。
- 验证：Web生产构建与solar Playwright通过；真实纹理、行星环、科学尺度与真实数据仍待后续。

### 最小可信插件宿主与DYN授权接入（P03切片）
- 新增`packages/plugin-host`：严格清单校验、能力/网络主机子集授权、https origin归一化、相对路径与防穿越、响应上限、安装/启停/撤权、启动失败回滚与在途取消；插件无权直接fetch。
- DYN适配器把NASA来源与分段加载器接入宿主；浏览器太阳系数据源改经宿主context访问只读代理，卸载时停用插件并中止请求。
- 验证：宿主7项单测（越权主机/能力、路径穿越、超限、启停、撤权、在途中止、启动失败、DYN合成加载）、Web typecheck/生产构建与10项Chromium测试通过。
- 边界：同进程可信宿主，不是Worker/iframe沙箱；贡献点、对象/资源所有权、权限扩大重授、制品签名/版本锁与市场仍未实现。

### 项目快照导出与恢复（C11切片）
- Proto新增`ProjectSnapshot`、`ProjectClock`、`ProjectFrameRecord`、`ProjectResourceRecord`与只读`query.project_export`；能力总数增至36项。
- ProtocolAdapter实现结构化编解码：校验schema版本、时钟模式/倍速、标识长度、32字节来源摘要与资源字节长度；场景对象按父级依赖恢复，未知版本/非法数据拒绝。WASM新增`WasmEngine.from_project(session, bytes)`，恢复创建新句柄/修订/任务代次，不恢复GPU句柄、任务或上传。
- 浏览器新增保存/打开项目：导出结构化字节下载，打开后重建会话并重新采样提供者帧；合成Chromium路径完成保存→打开→运行闭环。
- 验证：protocol-adapter 17项session、5项lib、workspace Rust测试、Web typecheck/生产构建与10项Chromium测试通过。尚未实现文件封装/manifest、格式迁移、增量保存、插件数据与恢复失败UI。

### 太阳系时间轴与星历摘要
- 浏览器时间轴按当前显式历元的天数偏移，暂停时可拖动并复用既有`time.seek`；不把偏移解释为UTC日期。
- 选中太阳/地球/月球/火星/木星时，资料面板显示来自DYN求值的距父级距离与速度；显示比例只影响渲染，不改变科学单位数值。
- 合成Playwright路径增加时间轴跳转断言；全部10项Chromium测试、Web typecheck与Next生产构建通过。仍不代表真实数据、科学时间换算或误差验收完成。

### 太阳系显示轨道线（M4前置）
- 宿主用距当前时刻最近的`orb`样本根数生成显示用轨道管（160段、4边），经既有`registerMesh`提交并挂在各天体父参考系，不新增核心图元。轨道明确是邻近历元根数，不是跨全时段传播或科学精度证据。
- 太阳系模式新增场景对象计数；合成Playwright测试升级为验证至少10个对象（5天体+相机+4轨道），仍不包含NASA夹具。轨道网格当前可被拾取，后续需按对象类型过滤。
- 验证：Web typecheck、Next生产构建及全部10项Chromium测试通过（演示、选择、设备丢失、时间与太阳系）。真实数据、权限沙箱与科学验证仍未完成。

### 太阳系星历浏览器接入（M4前置）
- 新增只读`/api/dynamo/[...path]`代理：仅允许合法控制器路径，20秒超时、16MiB上限、`no-store`，不打包或镜像NASA数据；许可未确认前不缓存。
- 浏览器新增`?scene=solar`：注册太阳/地球/月球/火星/木星提供者帧与球体，按核心当前TimeInstant提交DYN样本；播放时核心先推进时钟，宿主再更新样本并重绘，不建立JS时钟权威。显示比例固定为1 km=1e-6 m，明确不是科学尺度。
- 新增合成字节Playwright测试，拦截代理并验证四个天体路径请求、提供者帧呈现及运行状态；不包含NASA夹具。
- 验证：Next生产构建、Web typecheck、solar Playwright通过；真实NASA数据、插件权限沙箱、纹理/轨道/时间轴与科学精度仍未验证。按用户新指令未逐次全量。

### M4前置：提供者样本帧与公开契约
- Spatial新增`FrameSource::ProviderSample`：帧绑定provider_id/provider_version，宿主按当前显式时刻提交刚体样本；核心不插值、不算轨迹、不联网。首次更新前返回MissingTransform，恢复时缺失提供者建立占位并可由后续样本重新绑定。
- Engine新增register_provider_frame/update_provider_frame_sample并递增帧序列；更新仅接受提供者样本帧或恢复占位，先校验修订溢出再原子替换。Proto新增ProviderIdentity、RegisterProviderFrame、UpdateProviderFrameSample（oneof 4/5），要求expected_revision且限制来源标识长度。
- ProtocolAdapter映射并校验新动作，新增spatial.register_provider_frame/update_provider_frame_sample能力；生成TS类型与SDK技能书同步。错误映射MissingTransform→PROVIDER_UNAVAILABLE、InvalidProvider/非法标识→INVALID_ARGUMENT。
- 验证：Spatial 8项单测与1项祖先测试、protocol-adapter 16项session及相关集成测试、严格workspace check通过；TS SDK构建通过。补充Native/WASM互通测试实际发送两项新空间动作，能力总数同步35项。按用户新指令未逐次全量，整体回归由后续`tools/check.sh --gpu`统一完成；浏览器接入、导数/插值/覆盖缓存仍未实现。

### P04 NASA DYN插件核心与分段加载
- 新增`packages/nasa-dynamo`（`@spaceeyes/nasa-dynamo` 0.0.1）：按架构§15作为独立TS数据源，不进入Rust Core，不直接联网，不持有场景/时钟权威。
- 解析：v1/v2头、五类点、内联/索引/分段、小端f64、W在前四元数、严格字节数与分段表校验；求值：pos三次Hermite、lin线性、quat/ori SLERP、ori端点投影、orb椭圆/双曲线投影与重心质量比，明确越界/非法样本/非支持轨道。
- 加载：宿主注入transport，只取覆盖请求时刻的分段；索引与窗口有界LRU、覆盖段选择、AbortSignal检查及结构化加载错误，不隐式重试。
- 来源：按固定提交4a8a83b复用自研TS行为并保留署名；`eyes/`恢复源码与NASA夹具未复制、未入库、未进测试。
- 验证：包内24项合成字节测试、严格TS构建、prettier与policy通过；按用户新指令不作逐次全量，整体回归留待批量完成后统一执行，未声称全量或真实科学样本通过。

### P04参考DYN来源核验与合成黄金样本规范
- 固定参考仓库`spacelibres/solarsystem`提交`4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db`（0.2.73），逐文件记录SHA-256并分类：自研TS可按包级MIT复用并署名，`eyes/`恢复的NASA源码、真实DYN夹具、Starlink数据与模型不得复制。仓库根无`LICENSE`，仅`package.json`声明MIT，该缺失记为风险，不把仓库整体视为MIT。
- 规范记录五类点、v1/v2头、内联/索引/分段、WXYZ四元数顺序、求值区间与错误语义，并定义orb/pos/lin/ori/quat五类合成样本及容差；合成样本只验证机制，不证明科学精度，真实样本仅限贡献者本地差分，不入库、不进CI或插件包。
- 台账同步：P04由“只有规格”改为来源/格式证据已完成、插件未实现；P12记录参考DYN逐文件审查；修正M3-1b/2a与远端CI的陈旧状态，记录297cd83的run 40520802717经verify_remote_ci核验通过。
- 验证关联：本轮仅改文档，无Proto、SDK或核心代码变更；提交前在297cd83基线执行完整`bash tools/check.sh --gpu`通过，文档变更后重跑policy与格式检查。父基线297cd83，版本0.0.1；远端按本提交实际SHA另验，不沿用基线结果。

### M3-2a任务执行与目标隔离、非阻塞CI复验
- 根据全设计审计先补Simulation强制前置：每次入队签发不透明执行token，IssuedTask/结果/失败/取消/提交均绑定实例和序号；普通任务绑定Scene/Graph修订，显式对象任务捕获目标句柄、完整原始对象值及声明依赖，禁止借最新修订将旧结果写入重建对象。
- 原子性与清理：错误token不伤合法任务，目标/上下文失效Stale并传播依赖清租约；未声明写入及Scene事务错误可显式修复重试；Seek/Stop/遗忘收敛上下文。严格科学来源、确定并行提交及真实执行器仍未标完成。
- CI修复：8d239b1本地145/157 Rust及10项SDK、9项浏览器通过，但远端40517442667/40518362294的Rust1.99 Clippy拒绝固定chunks_exact；改as_chunks，不放宽警告或删测试，保留失败记录。.gitattributes固定文本LF，解决Windows自动CRLF检出后Prettier失败，真实checkout-index探针通过。
- 流程：用户明确改为本地完整通过后直接提交开发分支，提交后继续开发，在自然检查点gh追踪并修复远端错误；取消远端通过前阻塞合入的旧规则，AGENTS/版本规范/总验收台账同步。版本0.0.1，父基线8d239b1；新候选本地/远端结果按其实际SHA另验。

### M3-1b有界上传与全设计要求核对
- 核对全部设计文档族，新增要求—代码—测试—缺口台账，修正首页陈旧状态；明确M1/M2原型完成不等于M3—M7完整交付，任务实例/对象代次门控列为异步执行器强制前置。
- 资源：Rust持有16MiB Bytes/RGBA8顺序上传、256KiB块、4会话；CPU/Staging原子预留、owner/实例会话身份、SHA-256与来源版本、完成发布/取消/Stop清理。已完成资源来源随记录保存、恢复重验；上传中记录不持久化。
- 协议：只追加4项资源动作、只读上传状态及能力上限，消息仍1MiB；SDK生成类型/响应映射/技能书同步。幂等回执保存上传状态，重试不重传；越权、旧会话、错偏移和摘要失败不得发布内容。
- 验证关联：按本候选完整SHA运行本地全量与GitHub CLI双门控；测试覆盖超过1MiB纹理Native/WASM互通、真实Surface像素及Stop清理。父基线d4a8ac9，保持0.0.1；不把测试计划当成已通过结果。
- 边界：未包含网格大包、压缩解码、网络/磁盘执行器、墙钟超时、完整项目Proto、市场或模型；继续依照总验收台账分批实现。

### M3-1a分层资源预算与只读统计
- ResourceManager增加总额及CPU/GPU/Staging独立逻辑额度；帧GPU/暂存成对原子预留与释放，保持租约代次保护。Engine原型额度256/128/128/32MiB，宿主可配置；Surface保守48MiB归GPU。
- Scene只引用CPU资产；项目记录排除运行时资源，恢复采用目标宿主额度。Proto追加query.resource_stats及实际额度发现，生成TS并同步SDK技能书；查询不推进时间、不占历史，Stop归零。
- 验证关联：覆盖分类/总额耗尽、原子失败、额外租约、旧令牌、恢复限制、只读协议、Native GPU拒绝及Browser Surface统计。完整本地和远端结果按本候选完整SHA核验，不以计划冒充通过。父基线aeba739，维持0.0.1开发版本。
- 边界：逻辑预留不代表RSS/VRAM测量。后续M3实现有界分块上传、摘要来源/取消及项目Proto文件，本次不标记完整M3。

### GitHub CLI严格交付门槛与CI可移植性修复
- 原因：用户要求每次交付必须同时通过本地与GitHub CLI远端严格验证。实际gh日志确认此前core作业在Proto生成处因runner缺少rg失败，不能把本机通过视为CI通过。
- 修复：Proto文件枚举使用既有Python依赖；SDK检查主动屏蔽rg，持续验证无需ripgrep也可生成一致类型。不减少任何原有检查。
- 治理：根AGENTS.md及版本规范要求先本地完整检查，再在development/verify-*建立候选；通过gh核验同一SHA的核心/GPU作业与必需步骤，才能以原SHA fast-forward交付。开发分支触发的CI也必须成功后才能报告完成。
- 门控：新增tools/verify_remote_ci.py，仅接受push事件，拒绝可能测试合并树的PR事件、错误SHA/工作流、未结束、失败、跳过、取消及缺少必需步骤；两项回归单测覆盖正向与负向矩阵，纳入本地完整检查和GitHub CI。门控只读，不修改GitHub保护或权限。
- 验证关联：本条记录随候选提交；本地完整检查与远端结果须按包含本记录的完整SHA查询GitHub Actions，不把计划执行写成已通过。父基线aede665，保持0.0.1开发版本，未创建正式发布。

### M2-4精确时间输入、步进与正反向倍速
- 原因/范围：按M2基本交互出口接续相机增量，用既有time.set_rate/step/seek增加正反向倍速、暂停±1秒步进和显式历元相对秒跳转，不新增核心时钟或Proto字段。
- 精度：输入最多64字符/9位小数，BigInt无损映射sint64秒与非负纳秒；拒绝科学计数法/溢出。修复负时间直接拼接floor秒导致的错误显示，例如(-1秒,500000000纳秒)正确显示-0.500000000。时间尺度/历元沿用Rust状态，不做UTC猜测。
- 宿主：处理时再次检查暂停状态，倍速修改不自动播放；成功后读取核心反馈，步进/跳转清除旧选择。无效输入或预期拒绝为非致命提示，既有相机/呈现/资源清理行为保持回归；侧栏控件沿用VI与键盘焦点样式。
- 验证：Windows/Rust 1.96.0/Node 24.15.0执行tools/check.sh --gpu退出0；119项默认/130项含GPU Rust、9项TS互通、3项新增时间适配单测、9项真实Chromium测试全通过，无失败/忽略/跳过。包括超2^53实际WASM跳转、负小数/纳秒、sint64边界、反向0.25倍速、暂停保持、非法输入保留状态、卸载重挂复位。新单测纳入check-web与既有CI；生产构建、格式、policy、Clippy、WASM及Native绘图通过，暂存资源0。独立审查与桌面/移动视觉复核通过。
- 阶段/边界：M2浏览器基本交互出口验收；不等于科学时间轴、UTC换算、数据覆盖、科学精度或整个平台完成。后续按M3先处理有界资源入口与项目恢复，不跳到市场或AI。
- 版本与提交关联：维持0.0.1开发版本，不创建正式发布；父基线4cfb33b，随development/core-0.0.1实现提交。

### M2-3相机聚焦与目标参考系跟随
- 原因/范围：按M2路线接续同帧选择，增加camera.focus及query.camera_state；Scene持久CameraTracking，Engine当前时刻聚焦与唯一事务提交，Rendering按同帧目标参考系派生跟随视图。公开操作27项，保持旧Proto字段编号与统一0.0.1开发版本，不发布新版本。
- 约束：目标必须存在、有参考系且不是相机；删除/同ID替换/改成相机均原子拒绝，先清除跟随才能删除。距离有限、在现有near/far内；不自动调裁剪面。网格取引用顶点AABB中心，ParentId不影响物理位置。缺失参考系、资源或时间覆盖明确失败，内部项目状态保留跟随配置。
- 宿主：选择→聚焦/跟随→恢复视角，模式和目标来自Rust查询；旧Scene修订的选择不直接执行写入，预期命令拒绝展示非致命提示。桌面固定视口、侧栏独立滚动，移动上下布局，保持正式VI。
- 验证：Windows/Rust 1.96.0/Node 24.15.0执行tools/check.sh --gpu退出0；119项默认/130项含GPU Rust、9项跨端互通、8项真实浏览器测试通过，无失败/忽略。涵盖大坐标和目标旋转、时间分片一致、网格偏移/未引用顶点、删除/重建、缺时间覆盖、幂等/代次/修订与旧wire兼容。格式/policy/Clippy/全目标/全feature/WASM/Next生产构建与Native绘图通过，暂存资源0；视觉复核与独立代码审查通过。
- 边界：跟随为目标参考系相对视角，并非惯性稳定、平滑动画或真实物理航行；相机查询返回逻辑基础位姿及tracking，不宣称是每帧世界位置。时间控件、完整M2、科学数据、市场/AI和远端CI仍未由本次验收覆盖。
- 提交关联：父基线965cb73；随development/core-0.0.1实现提交。

### M2-2同帧拾取与对象信息闭环
- 原因：按全局交付路线补齐浏览器探索的选中对象与反馈，不跳过M2进入市场或AI。
- 范围：Rust保留一个成功呈现帧的拾取视图；新增query.pick_presented及同帧对象摘要，生成TS类型、SDK响应映射和技能书同步。空白成功无对象，旧帧/核心状态变化拒绝，查询不推进时间、不占命令历史；Stop释放视图。
- 宿主：串行处理点击时读取最近完成帧，排队期间画布尺寸变化要求重选；显示对象ID/类型/参考系/帧号，空白清除选择，卸载移除监听与清理。应用指定VI正式白色单色SVG和electric-orbit配色，来源记录在许可台账。
- 工具：Git Bash/Windows使用Proto生成器.cmd入口，Python脚本显式启用UTF-8；Windows浏览器测试使用可用默认WebGPU后端，Linux保留SwiftShader路径。不改变依赖版本或Proto既有编号。
- 验证：Windows、Rust 1.96.0、Node 24.15.0、wasm-bindgen 0.2.129，执行tools/check.sh --gpu退出0。113项默认/124项含GPU Rust测试、9项TS/Native/WASM互通、7项真实Chromium浏览器测试全部通过，无失败/跳过；格式、policy、严格Clippy、全目标/全feature、默认及browser WASM、生成漂移、Next生产构建与Native真实绘图通过。Native使用Intel Arc B390，绘制后暂存资源0；检查桌面/移动截图及SVG源文件摘要一致性。独立代码审查未发现阻止提交的问题。
- 边界：选中帧是宿主处理点击时最近完成的帧，不保证鼠标事件发生瞬间的画面；面板是该帧摘要。只保留单帧缓存，不承诺全历史回放、硬件性能、跨浏览器或科学精度。完整M2仍缺相机聚焦/跟随及更完整时间交互；资源/项目、真实科学数据、市场与AI尚未完成。
- 版本与提交关联：遵循当前已批准版本治理，保持0.0.1开发增量，未创建正式发布或标签；父基线bd51060，本记录随development/core-0.0.1实现提交。

### M2-1浏览器Surface与宿主帧闭环
- 全局目的：让M1公开协议创建的场景在真实浏览器持续显示，复用同一Rust引擎/绘制管线和Resources；补齐宿主帧与时间、预算及卸载的生命周期链。
- 范围：异步WASM/WebGPU Surface、独立Proto宿主帧入口、保守附件容量/单在途帧预算、Next.js/React最小宿主、相机/播放/状态与卸载；先更新相关规范。
- 验证：110项默认/121项含GPU Rust、8项TS互通、5项真实浏览器测试；Next生产构建、严格WASM browser Clippy、类型/格式及原有完整回归。包含实际像素、相机/时钟、缩放、迟到初始化/卸载、帧预检/历史及设备丢失清理。MIT和0.0.1一致，不复制外部视觉/NASA素材。
- 边界：合成场景；浏览器软件GPU不代表硬件性能，完整拾取UI/科学数据/设备恢复仍待后续。
- 提交关联：父基线696584f；随本development/core-0.0.1实现提交。

### M1-2能力发现与TS/Native/WASM互通
- 全局目的：把M1-1公开能力交给真实TS客户端使用，为浏览器宿主提供同源生成的协议、能力协商、错误/整数/资源契约；不新建仿真状态。
- 范围：只读能力发现、共享执行上限、生成式TS SDK、Native字节测试宿主、实际WASM运行与跨端互通；安装/生成漂移/类型检查/互通接入严格检查和CI。
- 规则：规范先行、MIT/0.0.1一致、第三方保留上游许可。未实现能力不宣传，能力不替代授权；64位整数bigint，客户端不隐式重试，宿主负责身份及实例释放。
- 验证/边界：109项默认Rust/120项含GPU Rust与8项TS/Native/真实WASM互通，另有生成漂移、严格类型/格式、全目标/全feature/Clippy/WASM及Native烟测；Node WASM不等于浏览器/WebGPU画布验收，NASA科学来源仍为独立前置核验。
- 提交关联：父基线ca6f0e5；本记录随development/core-0.0.1实现提交。

### M1-1公开会话与参考系链路
- 全局目的：解除浏览器/SDK无法独立创建参考系或查询会话状态的前置阻塞；先贯通公开边界，不追加局部渲染特性。
- 范围：生命周期/根与单时刻子参考系命令、图修订前置条件、独立只读状态/位姿查询与WASM入口；准确有理倍速与原始提交回执；构建脚本追踪外部proto目录，防止跨语言生成漂移。Engine保持唯一写入者，查询不消耗命令历史或产生事件。
- 规则：先修订Proto/空间/命令/生命周期规范，保持MIT、0.0.1和已批准ADR；既有wire字段不重编号。单时刻采样不冒充全时段静态或科学转换，停止会话不可重启。
- 验证：新增9项端到端协议/失败清理与跨模块测试；107项默认/118项含GPU测试、格式/严格Clippy/全目标/全feature/WASM构建与Native烟测。TS互通/浏览器画布仍未验收，M1不标整体完成。
- 提交关联：父基线caf623e；本记录随development/core-0.0.1实现提交。

### 全局交付路线校正
- 原因：用户要求通盘考虑；此前按渲染/导入模块追加功能，未把浏览器、公开契约、科学数据与资源生命周期作为完整交付链排序。
- 范围：核对平台架构/可行性G0—G5与实际WASM、Proto、Native、Engine和CI，改写开发进度中的执行路线；记录公开参考系/Query缺口、跨端验收缺失及1MiB消息与大纹理入口不一致。先M1公开契约、M2浏览器、M3数据/项目，再真实太阳系；来源/科学基准核验提前，稳定性按阻断风险贯穿，市场和AI依赖后置。
- 边界：仅文档调整，不改变已批准ADR、Proto字段、运行时代码、MIT或版本；阶段出口均为后续验收要求，不宣称已实现。
- 验证：提交前运行完整tools/check.sh --gpu，并核对待提交树；运行证据不代表浏览器或科学验证通过。
- 提交关联：父基线27358f8；由包含本记录的development/core-0.0.1提交追溯。

### PNG/JPEG纹理文件导入
- 范围：外层独立导入模块与Native有界文件读取；Resources仍唯一保存验证后的TextureData，核心不引入编解码依赖。保持0.0.1与MIT，第三方保留自身许可。
- 约束：8MiB输入、2048×2048、8位不透明；显式色彩空间，无ICC转换；严格JPEG与EXIF方向、PNG校验，失败不登记。Proto压缩导入后续实现。
- 验证：98项默认/109项含GPU测试、严格Clippy、格式/全目标/全feature编译、wasm32与Native真实绘制；新增6项解码与1项宿主GPU集成测试，零失败/忽略。软件GPU不代表硬件性能或远端CI。
- 提交关联：父基线16b4ff3；本记录随development/core-0.0.1实现提交，测试结果见开发进度。

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
