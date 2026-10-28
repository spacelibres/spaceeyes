# Rust 核心基础层

按平台架构书实现核心权威边界：宿主登记会话及批准能力，核心登记对象归属、核验聚焦意图，释放会话时清理其对象和失效焦点。停用的会话标识在当前核心实例内不允许复用；已使用标识集合会随实例存活，长期运行的容量策略尚需补齐。

当前没有自行实现三维算法，也尚未引入 Bevy 渲染依赖。聚焦仅记录经过验证的目标，真实相机移动、对象科学状态、Bevy ECS、WASM JS 导出及浏览器接线仍待实现。`register_object` 为宿主内部入口，不是可直接授予插件的数据发布 API。

验证：

```powershell
cargo test --manifest-path core/Cargo.toml
cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path core/Cargo.toml --target wasm32-unknown-unknown
```

WASM 目标编译仅证明基础库可面向该目标编译，不代表 JS 可以调用它或 GPU 渲染通过。TS 的 `platform/core-port.ts` 与本库职责对齐，但尚无跨语言适配实现，不能把两侧独立测试称为端到端测试。
