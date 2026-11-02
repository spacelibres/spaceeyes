# 太阳实时调参实施计划

> 执行方式：subagent-driven-development，依照已确认《太阳特效实时调参面板设计》完成独立实现并审查。

**Goal:** 全部列出的太阳参数实时进入Bevy显示和Parker查表。
**Architecture:** TS受控SDK调参接口、Rust独立校验和材质更新；UI使用统一参数元数据。
**Tech Stack:** Next/TS、Rust Bevy0.19.1、外置WGSL。

## Global Constraints
当前codex/bevy-planning，不触碰冻结分支；场景资源不打入WASM；采样最多24、日珥顶点不超过50000；真实GPU检查后提交推送。

- [x] 契约与物理：platform/stellar-controls.json为字段顺序和范围；stellar-tuning.ts校验并生成64点Parker表；SDK stellar(targetId,tuning)需scene.visual和所有权。
- [x] 核心：core/src/stellar_tuning.rs和wasm入口独立校验；更新已有stellar参数不增加资源修订；stellar_render使用uniform与有界网格更新；WGSL读取具名参数槽与物理表。
- [x] UI：独立SolarTuningPanel，滑块+数字+颜色、组重置、暂停、开关、JSON导入导出、localStorage；WorkspaceRuntime受控调用，合并动画帧，几何拖动松开提交。
- [x] 验证：非法值/交叉约束/权限/冻结快照；WASM实际更新；所有元数据有核心用处；集中检查、GPU调节、负载证据、更新SDK技能与CHANGELOG、补丁递增、提交推送/gh核验。
