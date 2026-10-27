# SPACEEYES

版本：0.0.1（Rust核心工程初始化）

SPACEEYES太空之眼首期以NASA Eyes类太阳系三维探索为目标。Rust是唯一核心源码，未来编译为WASM与Native；Web界面由独立宿主提供。NASA DYN是未来独立插件，不进入核心。

## 当前代码范围
- `foundation`：ObjectId、FrameId、ResourceId、错误与修订值类型。
- `scene`：最小对象注册与唯一ID约束。
- `time`：显式时间尺度/历元的基础值类型、时钟跳转代次。
- `engine`：最小Ready/Running/Stopped生命周期。
- 其它核心crate：已建立边界占位，**尚未实现功能**。

## 构建与测试（开发环境具备Rust工具链后）
```bash
cargo check --workspace
cargo test --workspace
```
以上命令为运行说明，尚未在本次提交中执行。当前环境无Cargo，不能宣称通过。

## 版本纪律
项目统一版本0.0.1。每次正式版本更新只递增最小位，100进1；所有受控代码、文档和规则必须同步版本，并更新CHANGELOG.md。详细规则见 `docs/项目文档与版本规范.md`。

## 架构依据
`docs/Rust核心架构设计基线.md` 已获批准；ADR-001至ADR-009已批准。未冻结的科学时间尺度、Proto字段、GPU后端仍在后续受控开发中明确。不得擅自把NASA DYN或插件管理放入Rust核心。
