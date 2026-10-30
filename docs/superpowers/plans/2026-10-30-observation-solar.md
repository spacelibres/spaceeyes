# 观测约束太阳重建实施计划

> 执行：subagent-driven-development，独立实现后审查，集中验证后提交。

**Goal:** 按已确认《太阳观测约束与三维重建设计》阶段A完成动态分级表面、局部三维日珥和有界透射。

**Architecture:** TS插件/SDK提供配置，Rust校验、生命周期和几何，外置WGSL显示；完整NLTE/MHD不在本轮。

**Tech Stack:** Bevy0.19.1/Rust/WASM、TypeScript/Next、WGSL。

## 约束

当前codex/bevy-planning；冻结分支不改。保留旧58项配置与旧SDK调用。新元数据索引0..57不移动，新增58..73，uniform扩为19个vec4。新观察模式与旧风体积模式分开。聚焦30Hz/失焦5Hz、距离滞回、最多50000顶点。

## 实施

- [x] 契约与UI：platform/stellar-controls.json追加16项；TS/Rust对严格旧58项补默认且observationStyle=0；新配置74项严格验证；旧JSON/localStorage v1兼容。新增观察效果预设与说明。
- [x] 表面：core/src/solar_surface.rs + web/resources/shaders/solar-surface.wgsl，局部活动区与多尺度纹理，4级强度映射。读取StellarEmitter.current_settings和clock；PostUpdate排在sync_stellar_lod之后；近景创建、远景回收，隐藏旧表面像素但不隐藏其子实体。
- [x] 日珥与日冕：stellar_render.rs、stellar.wgsl、prominence.wgsl。current_settings缓存19vec4；旧模式维持行为，新模式局部带下凹曲线、km尺寸/弧长流速、premultiplied透射，近表面有限日冕替代全屏风。物理帧仍为示意。
- [x] 集成：renderer.rs注册新材质与系统，lib.rs声明，prepare-runtime复制shader；SDK技能书、设计状态与CHANGELOG同步。
- [x] 验证：迁移/非法值/权限、辐射透射极限与合成次序、输运与几何尺寸/收敛、资产创建释放；完整集中检查；可见GPU截图、旋转、远近、暂停及负载采样；补丁版本、提交推送与gh核验。

## 索引约定

58 surfaceContrast，59 surfaceDetail，60 surfaceSpeed，61 activeRegionGain，62 activeRegionSize，63 limbGlowGain，64 prominenceHeightKm，65 prominenceWidthKm，66 prominenceLengthKm，67 prominenceFlowKmS，68 prominenceTau，69 prominenceSource，70 prominenceTimeScale，71 coronaExtent，72 observationStyle，73 coronaGain。

StellarEmitter由stellar_render负责扩展：pub current_settings:[Vec4;19]，clock维持现有flowSpeed/paused时钟，供表面同步系统读取。表面子实体使用自己的材质，不操作日珥生命周期。原表面材质由表面系统在近景观测模式下用alphaMask隐藏，离开/禁用还原；必须在stellar_lod之后执行。

验收证据和限制：docs/evidence/solar-observation-0.0.31。完整 MHD/NLTE、真实磁场外推与VR仍不在本轮。
