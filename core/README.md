# Rust 核心基础层

按平台架构书实现核心权威边界：宿主登记会话及批准能力，核心登记对象归属、核验聚焦意图，释放会话时清理其对象和失效焦点。停用的会话标识在当前核心实例内不允许复用。CoreLimits 默认最多 256 个活动会话、65536 个历史会话和 100000 个对象；原生宿主可配置，超额明确失败，不覆盖现有状态。历史标识达到预算后应在完成清理后创建新核心实例，不隐式复用旧标识。

已提供有权限检查的数据发布/更新与删除，以及对象状态、统一时钟和播放控制。状态为 ICRF 坐标、千米、J2000 起算的 TDB 秒，必须包含来源与覆盖范围。核心只接受确切采样时刻，不在覆盖内擅自插值或外推；换时后数据插件须重新提交对应样本。此版本的状态尚不包含姿态和轨迹。

时间支持暂停、继续、倍速、反向播放和跳转；负的真实时间增量、非有限值与溢出被拒绝。控制时间的会话被释放后暂停播放，保留当前时刻。宿主负责提供非负的真实时间增量，插件不直接调用 tick。多个已获授权会话按最后一条成功时间命令确定控制归属。

通过可选 `bevy-runtime` 功能接入 Bevy 0.19.1 的 ECS、Transform 和数学库，不自行实现渲染引擎。显示状态由核心采样推导：先在 f64 中减局部原点并缩放，再转 f32，轴向按 ICRF x/y/z → 显示 x/z/-y 显式映射。缺少当前时刻样本时移除显示实体并写入 SyncReport，拒绝以旧值冒充有效状态。

`browser-render` 启用 Bevy 内置三维渲染、共享球体网格/材质、方向光、聚焦、拖动环绕和滚轮缩放。当前球体是中性验证几何体，没有真实模型/贴图/轨迹/大气等 NASA Eyes 资源效果。选择的是 WebGL2 路径，其能力限制与浏览器证据见 `docs/evidence/core-0.0.4/README.md`；WebGPU 尚未验收。

`register_object`、`set_object_state` 为宿主内部入口；插件适配器必须调用会核验授权的 `publish_object` 和 `remove_object`，不能绕过它们。

验证：

```powershell
cargo test --manifest-path core/Cargo.toml
cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path core/Cargo.toml --target wasm32-unknown-unknown
```

已通过 wasm-bindgen 提供实际 JS 调用入口，TS 的 `WasmCorePort` 转发到 Rust。集中验证先安装锁定依赖 `npm ci --prefix platform --ignore-scripts`，再执行 `pwsh -File tools/check-core.ps1 -Samples validation/.cache`；需预装 wasm-bindgen-cli 0.2.129 和 wasm32-unknown-unknown 目标。脚本生成 Node/Web 胶水并运行真实 WASM 集成测试。生成物忽略，不提交到源码。

追加 `-Renderer` 会构建、检查并导出渲染版本，但不自动执行像素验收。浏览器宿主先初始化 Web 模块，构造 WasmCore 并交给 WasmCorePort，再由宿主调用 `start_renderer('#canvas-id')`。渲染器不自行推进科学时间：宿主按实际单调时间增量 tick，再由数据插件提交该核心时刻的样本；异步数据未就绪时明确报告缺失，不通过放宽采样时刻检查掩盖不同步。页面销毁时用 `await host.shutdown()` 清理插件，并在 finally 中 `stop_renderer()`、`free()`；Drop 也会请求停止。实例仅允许启动一次，单页多次重建与 GPU 内存释放量尚未验证。不得向插件暴露原始 WasmCore。
