# NASA Eyes 背景星空实施计划

> For agentic workers: use subagent-driven-development；每项任务实施后专项审查，结束做全局审查。当前分支原地执行。

Goal：完整解析七个源点表，经插件 SDK 驱动 Bevy 合批背景星空。

Architecture：固定源服务器入口 → TS 严格解码与坐标标准化 → scene.visual 批量层 → Rust 验证归属/预算 → Bevy Mesh/Material 显示。原始文件与 shader 外置。

Tech Stack：TS/Next、Rust/Bevy 0.19.1、WGSL、现有 WASM 适配。

约束：八层、每会话五万点；输入赤道 J2000/ICRF km；不创建科学天体；不开任意 URL；保持已有 4096 轨迹点预算和冻结分支规则。

## Task 1：真实数据与资源

- [x] platform/starfield.ts + tests：头/23 字节记录、颜色、旋转和有限性，先失败测试再实现。
- [x] validation/eyes-stars.json：七文件 URL/字节/SHA256 固定；web/lib/starfield-server.ts 及受控路由，有界读取与取消/缓存。
- [x] 全量实际七文件复核 43878 点，异常源字段保留。

## Task 2：受控 SDK 和核心显示

- [x] 在 platform/{starfield-contract,core-port,wasm-core-port,plugin-host}.ts 添加 visual.starfield(layerId,spec|null)；spec 包含 frame、source、positionsKm、colorsRgb、magnitudes、absoluteMagnitudes 的平铺数组。原子校验、权限、归属、停用清理。
- [x] core/src/starfield.rs + wasm 绑定：同一契约再校验，source 不可空，合计五万点和八层限制；标识不重用科学对象。
- [x] core/src/sky_render.rs + 外置 WGSL：每层一个 mesh 和 material，屏幕朝向四边形、源光通量/渐隐/PSF，加法混合，背景深度，不遮住天体。
- [x] 摄像机 km 在核心统一求取；通过受尺度控制的相对位置避免巨大 f32 距离平方溢出；无每点实体。
- [x] Rust、TS、真实 WASM 测试覆盖非法参数、预算、旧会话与清理。

## Task 3：工作区与交付

- [x] 独立数据插件模块管理七层状态、两并发、AbortSignal、重试与缓存；先亮星层，后台补齐，不阻塞天体初始化。
- [x] visual 开关、7/7 与43878点计数、独立错误/重试；退出、取消、重入和快速切换回归。
- [x] 专项和全局审查；完整 check-core.ps1 检查、实际 GPU 对照、数据/资源证据。
- [x] 更新 SDK 技能书、设计状态、路线、CHANGELOG，递增本次修改包的补丁版本，提交推送并 gh 非阻塞跟踪 CI。
