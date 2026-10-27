# CHANGELOG

项目：SPACEEYES｜统一规划版本：0.0.0

## [Unreleased]

### 2026-10-27 — 双仓库审计问题整改（规划文档）
- 原因：正式仓库版本、DYN迁移范围、来源许可、跨仓库版本治理四项审计问题。
- 修改：架构书统一规划版本0.0.0；新增文档与版本规范、技术可行性方案、DYN迁移与验证规范、第三方来源与许可台账、双仓库整改台账。
- 证据：solarsystem的Dynamo、ephemeris、runtime、tests、docs；spaceeyes主分支架构书。
- 验证：完成GitHub源码静态审查；未运行Rust/WASM、浏览器或完整CI测试。
- 风险/待办：NASA资产许可待核实；Rust迁移、Proto Schema及自动化门禁尚未实现。
- 版本：保持0.0.0；此为规划修订，不构成软件发布。

- 2026-10-27：确定NASA Dynamo解析为独立TypeScript数据源插件 `spaceeyes.nasa.dynamo`；直接按需加载在线DYN，内部解析与求值，公开接口仍用Proto；新增插件设计规范并同步架构与可行性方案。仅文档规划变更，未编写插件、未运行测试、版本保持0.0.0。
