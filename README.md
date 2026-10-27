# SPACEEYES

版本：0.0.1（Rust核心工程初始化）

开源许可：[MIT License](LICENSE)。项目自有源码、Proto定义、脚本及文档采用MIT；依赖和外部资产保留各自许可。

SPACEEYES太空之眼首期以NASA Eyes类太阳系三维探索为目标。Rust是唯一核心源码，未来编译为WASM与Native；Web界面由独立宿主提供。NASA DYN是未来独立插件，不进入核心。

## 当前代码范围
已实现Scene/Time/Spatial/Simulation/Resources基础状态与事务、共享FrameSnapshot、内部项目状态恢复、Proto同步命令与幂等入口、wgpu球体/通用三角网格、纹理/基础材质与深度遮挡原型、Native示例及WASM字节适配。完整范围、未完成项及依赖见[开发进度与验收](docs/开发进度与验收.md)。当前不是完整太阳系应用，没有浏览器界面或NASA数据插件。

## 构建与测试
使用stable Rust及rustfmt、Clippy；WASM需要`wasm32-unknown-unknown`目标。仓库根目录执行：
```bash
cargo build --workspace --locked
bash tools/check.sh
```
检查脚本执行格式、全目标编译、严格Clippy、默认测试和WASM构建。当前Linux/Rust 1.99.1默认107项测试通过；GPU功能开启时118项测试通过。Cargo.lock固定已验证依赖，Proto生成使用vendored protoc。

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
Host授权后通过ProtocolAdapter发送Proto Scene/Time/Resources/Spatial/Lifecycle命令及独立QueryEnvelope；身份不从载荷中自报授权。WASM适配复用同一契约，目前完成编译验证，尚未进行浏览器运行验收。

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
该增量为TS SDK和浏览器画布解除前置阻塞；M1双语言互通、能力协商与M2交互尚待实现，下一步按[全局交付路线](docs/开发进度与验收.md)推进。
