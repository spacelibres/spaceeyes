# 0.0.17 轨道闭合验证

2026-10-30，SDK 0.0.15 / 网页 0.0.17，Rust 核心保持 0.0.15。

完整集中检查命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`。最终日志 `validation/results/orbit-closure-0.0.17-final.log`，退出 0，124 项不同自动测试通过（基础 Rust 27、额外 native 14、平台 TS 51、网页 TS 17、WASM 5、宿主集成 8、样本 2）。包含 Clippy、构建和资源检查。

先运行新增短覆盖圆轨道回归得到首尾不相等的失败，再实现通过；覆盖外科学求值仍拒绝。补充偏心/倾斜/逆行闭合、退化/无效状态、速度和地月层级检查；真实 Rust WASM 宿主确认闭合几何和目标切换预算。

`measurement.json` 是实际同源资源求值结果：七个可用运动对象均为闭合模型、包含当前时刻、最多 256 点，月球 originId 为 earth。海王星旧窗口仅 156.470 年，瞬时模型周期约 166.554 年；两者含义不同。

`overview-closed.png`：最终生产构建 http://127.0.0.1:3006/ 实际 GPU，1280×720，选取俯视后海王星外圈无缺口，太阳居中，颜色与统一尺度保留。该浏览器 error 日志为空。此批 GPU 直接观察总览；聚焦/拉远/地月自动回归通过，但不声称重新完成所有相机视觉验收。

仍显示金星/火星源时间异常，按用户后续要求在下一批定位并修复。闭合轨道是有效当前状态的瞬时二体示意，不扩展科学覆盖、不代表多年实测轨迹或 NASA Eyes 全部验收。远端 CI 以对应提交的 gh 查询为准。
