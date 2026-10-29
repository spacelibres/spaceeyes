# Rust 核心基础层

按平台架构书实现核心权威边界：宿主登记会话及批准能力，核心登记对象归属、核验聚焦意图，释放会话时清理其对象和失效焦点。停用的会话标识在当前核心实例内不允许复用。CoreLimits 默认最多 256 个活动会话、65536 个历史会话和 100000 个对象；原生宿主可配置，超额明确失败，不覆盖现有状态。历史标识达到预算后应在完成清理后创建新核心实例，不隐式复用旧标识。

已提供有权限检查的数据发布/更新与删除，以及对象状态、统一时钟和播放控制。状态为 ICRF 坐标、千米、J2000 起算的 TDB 秒，必须包含来源与覆盖范围。核心只接受确切采样时刻，不在覆盖内擅自插值或外推；换时后数据插件须重新提交对应样本。状态可选 `orientationWxyz` 单位四元数（w、x、y、z），表示 body-local 到 ICRF，有限性及平方模误差不超过 1e-6 由核心校验；省略时不附加旋转。显示旋转使用同一坐标基变换。轨迹通过独立受控显示接口提交，不把轨迹点作为当前科学状态或自动传播结果。

时间支持暂停、继续、倍速、反向播放和跳转；负的真实时间增量、非有限值与溢出被拒绝。控制时间的会话被释放后暂停播放，保留当前时刻。宿主负责提供非负的真实时间增量，插件不直接调用 tick。多个已获授权会话按最后一条成功时间命令确定控制归属。宿主 `utc_to_tdb(unixSeconds)` 与 `tdb_to_utc(tdbSeconds)` 使用独立 Hifitime 4.3.1，在 UTC Unix 秒与 J2000 TDB 秒之间换算，不改变仿真时钟；输入须有限且绝对值不超过 1e12 秒。未来闰秒依赖库内表维护，不把浏览器日期直接当 TDB；未链接 Nyx，也未据此完成整个数据链的科学精度验收。

通过可选 `bevy-runtime` 功能接入 Bevy 0.19.1 的 ECS、Transform 和数学库，不自行实现渲染引擎。显示状态由核心采样推导：先在 f64 中减局部原点并缩放，再转 f32，轴向按 ICRF x/y/z → 显示 x/z/-y 显式映射。缺少当前时刻样本时移除显示实体并写入 SyncReport，拒绝以旧值冒充有效状态。

`browser-render` 启用 Bevy 内置三维渲染、共享球体网格、StandardMaterial、方向光、聚焦跟随、拖动环绕和滚轮缩放。`camera.view` 支持 overview、top、front、side、orbit；overview 对当前有效对象实际位置、科学半径及环的显示范围求包围范围，并考虑视场角。聚焦跟随也考虑模型已加载包围范围和环，显示范围不改写科学半径。仅目标或视角切换执行 0.35 秒平滑过渡，首次显示不做动画，同目标播放不增加相机滞后；旧相机位置先恢复为 f64 物理位置再投影到新局部原点。预设角度仅切换时应用，随后允许拖拽。未设置资源表示时使用中性验证几何体；真实模型和贴图通过下述受控目录加载。选择的是 WebGL2 路径，其能力限制见 `docs/evidence/core-0.0.4/README.md`；WebGPU 尚未验收。

`register_object`、`set_object_state` 为宿主内部入口；插件适配器必须调用会核验授权的 `publish_object` 和 `remove_object`，不能绕过它们。

## 受控模型和贴图

宿主通过 register_asset 登记固定资源标识、种类及相对资产根目录的路径；目录最多 4096 项，实例内不覆盖同名项。路径拒绝远程 URI、绝对地址、目录越界和标签。宿主还必须验证文件内容及 glTF 依赖图，目录检查不代替不可信资源包审计。

插件通过 scene.visual 权限给所属对象设置模型、球体颜色/自发光、表面及环纹理；Rust 再检查归属、资源种类和参数。模型单位到千米的比例与科学半径分离，前者决定模型几何缩放；科学半径仍保留，模型实际取景可使用加载后包围范围。Bevy AssetServer/WorldAssetRoot 负责加载与实例化，不自写 glTF 或图像解码器。加载器禁用 glTF 摄像机和灯光导入，模型资源不能改变平台相机或照明控制权。

球体 `textureAsset` 与六项 `faceAssets` 互斥。六面按已恢复 NASA CubeMap 的 +X、+Y、-X、-Y、+Z、-Z 面序及实际 U/V 基映射，并核对 ImageBitmap 上传路径，重采样到 2048×1024 的 Bevy UV Sphere 纹理。64 组有界缓存复用结果，每帧六面转换系统共推进一个任务的最多 16 行，优先当前聚焦且源图已就绪的对象；暂存像素与下一行保存在待处理实体中，全部 1024 行完成才发布纹理和完成状态；不自行实现网格或渲染引擎。`colorRgba`、`emissiveRgba` 通道均须在 [0,1]。

`ringAssets: [topId,bottomId]` 同时要求 `ringInnerRadiusRatio` 与 `ringOuterRadiusRatio`，满足 1≤inner<outer≤10。按恢复 RingsComponent 的径向条带采样展开为 1024×1024 透明中心纹理，两片 Bevy Plane3d 各自背面剔除并跟随父对象姿态；每帧环转换系统共推进一个任务的最多 16 行，全部完成才发布纹理和完成状态；修订失效、失败或对象释放时丢弃暂存数据。Rgba8UnormSrgb 源图直接读取原 RGBA 字节，其余格式保留 Bevy 像素访问转换。上下纹理、表面纹理仍须经宿主登记。

`visual.trajectory(id, points)` 接受有限的 ICRF 千米三元组，每会话合计最多 4096 点；空数组清除。`visual.label(id, text)` 最多 256 Unicode 字符，拒绝控制字符，空串清除。`visual.layers({labels,trajectories})` 仅控制调用会话所属对象的对应显示层。Rust 核验 scene.visual 权限、对象归属及预算，Bevy Gizmos 画轨迹，原生 UI Text 按相机投影显示标签。移除对象或释放会话会清理附属显示状态；默认字体的非拉丁字符覆盖未保证。

对象表示带独立递增修订，替换、清除和会话释放后，旧完成结果无效。各待加载部件在就绪前隐藏，失败明确上报；已完成部件可能先显示，但总状态仍等待其余部件。ready 需要资源及依赖就绪，模型还需收到 WorldInstanceReady；球体表面与上下环按同一修订聚合，全部完成才 ready。同修订任一部件 failed 后，后续 loading/ready 不得覆盖；设置新表示产生新修订才重置。此状态不代表最终 GPU 像素或材料还原准确。晚到请求可能继续填充 Bevy 缓存，当前不保证底层网络请求全部中止或 GPU 字节数即时回收。

Juno 资源验证先运行 `pwsh -File tools/prepare-juno.ps1`，固定来源清单为 `validation/juno-assets.json`。缓存不提交。集中检查加 `-JunoAssets` 只验证现有缓存，不隐式下载；之后运行测试服务并使用模型/贴图/失败/延迟加载按钮。该 Juno 验证页仍使用合成坐标夹具，其证据不代表真实轨道/姿态数据链。整体浏览入口可接入科学样本、可选姿态、轨迹、真实表面及土星环，但 NASA 视觉对标、GPU 地标/极向/接缝、阴影与材质一致性及科学精度仍须按各自验收项核对，不能用编译或资源下载成功替代。

验证：

```powershell
cargo test --manifest-path core/Cargo.toml
cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path core/Cargo.toml --target wasm32-unknown-unknown
```

已通过 wasm-bindgen 提供实际 JS 调用入口，TS 的 `WasmCorePort` 转发到 Rust。集中验证先安装锁定依赖 `npm ci --prefix platform --ignore-scripts`，再执行 `pwsh -File tools/check-core.ps1 -Samples validation/.cache`；需预装 wasm-bindgen-cli 0.2.129 和 wasm32-unknown-unknown 目标。脚本生成 Node/Web 胶水并运行真实 WASM 集成测试。生成物忽略，不提交到源码。

追加 `-Renderer` 会构建、检查并导出渲染版本，但不自动执行像素验收。浏览器宿主先初始化 Web 模块，构造 WasmCore 并交给 WasmCorePort，再由宿主调用 `start_renderer('#canvas-id')`。渲染器不自行推进科学时间：宿主按实际单调时间增量 tick，再由数据插件提交该核心时刻的样本；异步数据未就绪时明确报告缺失，不通过放宽采样时刻检查掩盖不同步。页面销毁时用 `await host.shutdown()` 清理插件，并在 finally 中 `stop_renderer()`、`free()`；Drop 也会请求停止。实例仅允许启动一次，单页多次重建与 GPU 内存释放量尚未验证。不得向插件暴露原始 WasmCore。
