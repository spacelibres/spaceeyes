# 0.0.50 完整解析轨道验证

日期：2026-10-31。核心 0.0.42、SDK 0.0.34、网页 0.0.50，分支 codex/bevy-planning。

## 本地 NASA 依据

本地 `solarsystem/eyes/src/engine/components/OrbitLineComponent.js` 的 `_updateMesh` 按 360 个一度区段投影瞬时轨道；当前位置插入对应角度区段。该完整轨道路径独立于 `TrailComponent` 的历史拖尾。本轮用同样的解析轨道/角度细分方法重新实现，保持本平台 TS 数据计算、受控 SDK 和 Rust 显示边界。

## 最终集中检查

最后一次代码修改后执行：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，退出 0。日志：validation/results/conic-orbits-0.0.50-final-checks.log。

141 平台/验证测试、16 真实 WASM、2 DYN 样本、50 网页库、42 宿主和 97 原生渲染测试通过。Rust 基础及预算测试、Clippy、TS、发布 WASM、生产构建、离线资产检查通过。

新增测试核验：稀疏输入仍携带完整解析描述；当前点、闭合、最大角步进、偏心和逆行几何；离开轨道面的当前点不拉扯模型；未知字段/非法基向量/非椭圆被 Rust 拒绝；SDK 到真实 WASM 透传；天然卫星携带解析描述、目录直接声明轨道根数的 Dactyl 同样生成解析轨道、航天器拖尾不携带；核心 256 条解析预算的拒绝、替换和清理复用。独立只读审查未发现阻断问题。

## 真实 DYN 与 GPU

`real-moon-audit.ts` 从本地 solar-dyn 接口取月球数据，固定 TDB 846690000。分配 24 点后实际返回 23 个科学采样点，同时具有地球为父体的解析参数；显示独立生成 360 段。结果见 real-moon-audit.json，重跑命令：`node docs/evidence/conic-orbits-0.0.50/real-moon-audit.ts`。

解析方程最大相对残差约 4.6e-16，用于核验参数展开的几何一致性，不是星历精度或 NASA 观测误差认证。

生产服务重启后，实际浏览器操作地球→System→暂停→缩放→俯视→太阳系总览。地球场景为 82/86 个对象当前可用，四个对象不在当前覆盖期；保留全部航天器与图层。earth-moon-system.png 和 earth-moon-top.png 中月球完整曲线不再退化成原图的二十多边形，未通过隐藏轨道或减少同屏对象取得截图。solar-overview.png 回归行星完整轨道。

浏览器 console error 和 Rust ERROR 查询均为空，退出显示工作区已释放。现有三维深度和渐隐仍保留；本轮未宣称完成 NASA 全部 LineMesh 抗锯齿、可变线宽或全平台交互验收。

最后一次补齐声明轨道根数路径后，重跑全部检查并重启生产服务；固定TDB846690000的最终地月截图为earth-moon-final.png，console/Rust错误均为空，退出再次确认释放。
