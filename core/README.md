# Rust 核心基础层

按平台架构书实现核心权威边界：宿主登记会话及批准能力，核心登记对象归属、核验聚焦意图，释放会话时清理其对象和失效焦点。停用的会话标识在当前核心实例内不允许复用；已使用标识集合会随实例存活，长期运行的容量策略尚需补齐。

已提供有权限检查的数据发布/更新与删除，以及对象状态、统一时钟和播放控制。状态为 ICRF 坐标、千米、J2000 起算的 TDB 秒，必须包含来源与覆盖范围。核心只接受确切采样时刻，不在覆盖内擅自插值或外推；换时后数据插件须重新提交对应样本。此版本的状态尚不包含姿态和轨迹。

时间支持暂停、继续、倍速、反向播放和跳转；负的真实时间增量、非有限值与溢出被拒绝。控制时间的会话被释放后暂停播放，保留当前时刻。宿主负责提供非负的真实时间增量，插件不直接调用 tick。多个已获授权会话按最后一条成功时间命令确定控制归属。

当前没有自行实现三维算法，也尚未引入 Bevy 渲染依赖。聚焦仅记录经过验证的目标，真实相机移动、Bevy ECS、WASM JS 导出及浏览器接线仍待实现。`register_object`、`set_object_state` 为宿主内部入口；插件适配器必须调用会核验授权的 `publish_object` 和 `remove_object`，不能绕过它们。

验证：

```powershell
cargo test --manifest-path core/Cargo.toml
cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path core/Cargo.toml --target wasm32-unknown-unknown
```

已通过 wasm-bindgen 提供实际 JS 调用入口，TS 的 `WasmCorePort` 转发到 Rust。集中验证先安装锁定依赖 `npm ci --prefix platform --ignore-scripts`，再执行 `pwsh -File tools/check-core.ps1 -Samples validation/.cache`；需预装 wasm-bindgen-cli 0.2.129 和 wasm32-unknown-unknown 目标。脚本生成 Node/Web 胶水并运行真实 WASM 集成测试。生成物忽略，不提交到源码。

Node 的真实 WASM 测试不等于浏览器或 GPU 验收。浏览器宿主需先初始化生成的 Web 模块，再构造 WasmCore 并交给 WasmCorePort；页面销毁前先停用全部插件，再 free 核心实例。不得向插件暴露原始 WasmCore。
