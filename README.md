# SPACEEYES

版本：0.0.1（原型持续开发）

开源许可：[MIT License](LICENSE)。项目自有源码、Proto定义、脚本及文档采用MIT；依赖和外部资产保留各自许可。

SPACEEYES太空之眼首期以NASA Eyes类太阳系三维探索为目标。Rust是唯一核心源码，已编译为WASM与Native；Web界面由独立宿主提供。NASA DYN是未来独立插件，不进入核心。

## 当前代码范围
已实现Scene/Time/Spatial/Simulation/Resources基础状态与事务、共享FrameSnapshot、内部项目状态恢复、Proto同步命令与幂等入口、wgpu球体/通用三角网格、纹理/基础材质与深度遮挡原型、Native示例及WASM字节适配。完整范围、未完成项及依赖见[开发进度与验收](docs/开发进度与验收.md)。已有浏览器最小宿主，仍不是完整太阳系应用，尚无NASA数据插件。

## 构建与测试
使用stable Rust及rustfmt、Clippy；WASM需要`wasm32-unknown-unknown`目标；统一检查还需Node >=22。仓库根目录执行：
```bash
source tools/dev-env.sh
bash tools/setup-sdk.sh
bash tools/setup-web.sh
cargo build --workspace --locked
bash tools/check.sh
```
检查脚本执行格式、全目标编译、严格Clippy、默认测试和WASM构建。M2-4本机Windows/Rust 1.96.0验收为119项默认Rust测试、130项含GPU Rust测试、9项TS互通、3项时间适配单测及9项浏览器测试；历史Linux证据与当前边界见开发进度。Cargo.lock固定已验证依赖，Proto生成使用vendored protoc。

### GPU原型与Native运行
需要Vulkan驱动（硬件或Mesa软件驱动）；已配置云环境可直接执行：
```bash
source tools/dev-env.sh
bash tools/check.sh --gpu
cargo run -p spaceeyes-native --features gpu --locked -- /tmp/spaceeyes-frame.ppm
```
示例从Scene持久相机生成视图，输出三个球体与一个通用网格四面体的PPM图片，带程序生成的棋盘纹理、基础明暗及深度遮挡。可在输出路径后传入相机偏航角（度）和局部X位置（米），例如`... /tmp/spaceeyes-camera.ppm 20 2`。GPU检查真实回读像素，不在缺少适配器时跳过。云环境首次安装可使用`bash tools/setup-cloud.sh`，在工作区准备Rust与Debian 13 Mesa软件驱动，不修改系统目录。

### 纹理与材质
支持Resources登记的原始不透明RGBA8纹理、明确Linear/SRGB色彩空间、网格/球体UV、Nearest/Linear采样及Clamp/Repeat寻址。材质为线性基色乘纹理，可选择Lit或Unlit；GPU实际采样并以线性RGBA8回读验证。现支持独立image-import模块解码PNG/JPEG并经同一Resources登记；不包含透明、mipmap或PBR。Scene只持有资源引用，纹理/网格由同一ResourceManager登记，GPU临时分配帧后回收。

### 时间与协议
`Engine::advance_nanos`由宿主提供非负单调经过时间，暂停时不变；`PlaybackRate`支持显式有理正负倍速，连续推进保留纳秒余数，不读取系统时钟。FixedStepper单独提供有界补步配置，不持有权威时间。
Host授权后通过ProtocolAdapter发送Proto Scene/Time/Resources/Spatial/Lifecycle命令及独立QueryEnvelope；身份不从载荷中自报授权。WASM适配复用同一契约，已通过Node互通与真实Chromium WebGPU/交互验收；仍无完整探索体验。

## 版本纪律
项目统一版本0.0.1。每次正式版本更新只递增最小位，100进1；所有受控代码、文档和规则必须同步版本，并更新CHANGELOG.md。详细规则见 `docs/项目文档与版本规范.md`。

## 架构依据
`docs/Rust核心架构设计基线.md` 已获批准；ADR-001至ADR-009已批准。未冻结的科学时间尺度、Proto字段、GPU产品后端仍在后续受控开发中明确（wgpu已获选择用于技术原型）。不得擅自把NASA DYN或插件管理放入Rust核心。

## 开源许可

SPACEEYES项目自有内容统一采用[MIT License](LICENSE)，包括Resources资源管理模块。所有Cargo包继承同一MIT声明，源文件使用`SPDX-License-Identifier: MIT`标识。使用、修改及再分发时保留版权与许可声明。

第三方依赖及外部数据不因本项目选择MIT而被重新许可。NASA数据、图像、模型和恢复源码的处理仍遵循[来源与许可台账](docs/第三方来源与许可台账.md)。MIT是开源使用许可；Resources中的资源所有者/租约是运行时设计，继续由Engine的唯一ResourceManager管理。

### PNG/JPEG文件导入
Native可追加第4个参数：`cargo run -p spaceeyes-native --features gpu --locked -- /tmp/import.ppm 0 0 /path/to/texture.png`（也支持JPEG，按内容识别）。输入最多8MiB，尺寸最多2048×2048；拒绝透明、16位PNG、动画PNG和损坏/截断图像，JPEG应用EXIF方向。宿主明确使用SRGB；库调用者可选择Linear或SRGB，不做ICC色彩转换。输入失败不登记纹理、不覆盖输出。压缩图像Proto接口仍待实现；输出仍为线性RGBA8的离屏PPM。

### 公开会话与参考系（M1-1）
新会话可以经`submit_bytes`创建根参考系、显式时刻的子参考系采样、相机与球体，再Start；`query_bytes`读取会话状态或当前时刻的参考系变换。WASM分别暴露`submit`/`query`，宿主仍须认证和授权。图写入要求expected_revision，查询不消耗命令幂等历史；生命周期重试返回原提交状态，当前状态须查询。Stop终止会话并回收资源，不能重新Start；Paused是播放模式。采样仅在指定时间有效，Seek越出覆盖返回TIME_NOT_COVERED，不伪造位置。命令与查询使用互斥的payload标签，误用入口会拒绝。
该增量为TS SDK和浏览器画布解除前置阻塞；M1双语言互通与最小能力协商已由M1-2完成，M2-1基础浏览器链路已完成，M2基本交互已验收，科学探索体验仍待实现，下一步按[全局交付路线](docs/开发进度与验收.md)推进。

### TS SDK与能力发现（M1-2）
需要Node >=22（本轮24.19.0，见.node-version）。首次执行`bash tools/setup-sdk.sh`安装锁定npm依赖和与Cargo.lock匹配的wasm-bindgen-cli；完整云安装脚本也包含此步骤。`bash tools/check-sdk.sh`验证同源生成、严格TS类型/格式、Native与真实WASM互通；已纳入`bash tools/check.sh --gpu`。
SDK在packages/core-sdk，先读取[SDK技能书](packages/core-sdk/SKILL.md)。宿主创建`CoreClient(wasmTransport(engine, authenticatedPrincipal), sessionId)`后调用`await client.connect(requiredOperations)`；能力发现返回当前实际支持操作与限制，不授予权限。使用生成的oneof载荷发送`command`/`query`，写入由调用方提供requestId及修订/代次，64位整数使用bigint。SDK不隐式重试、不持有第二套场景，实例由宿主负责Stop/free。
运行`bash tools/generate-ts.sh`同步Proto生成文件，`--check`检查漂移；不要手改生成类型。M2-1已接通真实浏览器画布/基础交互；M2拾取/相机/时间基本交互已接通；后续按全局规划实现数据与项目，不把Node互通替代浏览器测试。

### 浏览器宿主（M2-1）
首次执行`bash tools/setup-web.sh`准备浏览器测试依赖；`bash tools/build-web.sh`生成browser-feature WASM/web绑定并构建Next.js生产宿主，`npm run start --workspace @spaceeyes/web`启动。验证使用`bash tools/check-web.sh`，已加入完整检查。详见[宿主说明](apps/web/README.md)。
实际WebGPU Surface与Native共享Rust绘制管线。页面提供合成球体/网格、视角调整、播放/暂停、resize、状态和卸载；宿主帧独立于命令历史，资源预算归Resources。自动测试采用真实Chromium软件GPU，包含可见像素、时间/相机、生命周期和设备丢失故障；不提供自动GPU恢复或NASA科学数据。

### 同帧拾取与对象信息（M2-2）
点击画面，经SDK的`query.pick_presented`读取Rust保留的最近成功呈现帧，显示对象ID、类型、参考系与选中帧；空白清除选择。查询不推进时间、不消耗命令历史；帧过期、对象删除或核心状态变化后明确拒绝。点击在宿主串行队列处理时选择最近完成帧，不保证鼠标事件发生瞬间的GPU画面。缩放、卸载重挂与设备丢失经过浏览器验证。M2-3已完成一次聚焦和目标参考系跟随；完整时间轴、科学数据、市场和AI仍未完成。

### 相机聚焦与跟随（M2-3）
选择对象后可聚焦、跟随或恢复演示视角。Rust按当前时刻计算目标显示中心，跟随视图随目标参考系旋转；query.camera_state返回逻辑状态，宿主不计算目标轨迹。相机引用通过Scene事务校验，被跟随目标不可直接删除或同ID替换。

### 精确时间控制（M2-4）
支持正反向倍速、暂停时±1秒步进和精确到纳秒的显式历元相对秒跳转。输入通过BigInt映射核心时间，支持负小数及超JS安全整数的秒值；错误输入不改变时钟或中断会话。M2基本交互出口已验收，下一步按M3推进有界资源与项目恢复；科学时间轴及UTC换算仍未实现。

### 全设计核对与M3资源入口
设计要求尚未全部实现，逐项状态、代码/测试依据、剩余工作和集中验收顺序见[全设计要求实现与集中验收台账](docs/全设计要求实现与集中验收台账.md)。已验收M3-1a总额/CPU/GPU/Staging逻辑预算；M3-1b追加有界Bytes/RGBA8上传、来源SHA-256与取消，不扩大1MiB消息边界。每个新增候选以自身SHA的本地完整检查与GitHub CI为准。完整项目文件、宿主执行器、受限插件、科学数据、市场与模型闭环继续按M3—M7分批实施。

### 提供者样本帧与NASA DYN插件核心（M4前置）
新增`spatial.register_provider_frame`/`update_provider_frame_sample`：宿主按当前显式时刻为数据插件帧提交刚体样本，核心不插值、不算轨迹；首次更新前及恢复缺失提供者时明确不可用。`packages/nasa-dynamo`实现v1/v2五类点解析、Hermite/线性/SLERP/二体轨道求值，以及只取覆盖段的有界分段加载；24项合成测试不包含NASA数据。浏览器`?scene=solar`经只读代理显示太阳/地球/月球/火星/木星，并用邻近`orb`根数生成显示轨道管；位置按显示比例压缩。数据源经最小可信插件宿主的清单/能力/网络授权访问代理，卸载时停用并中止请求。时间轴按显式历元天数偏移，选中天体显示DYN求值的距离与速度。浏览器支持保存/打开结构化项目快照，恢复时创建新会话并重新采样提供者帧，不持久化GPU句柄、任务或上传。真实数据、Worker隔离、UTC换算与完整项目文件封装仍未完成。
