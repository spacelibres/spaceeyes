# 0.0.48 切换与标签验证

2026-10-31，当前规划分支，本地生产服务器 127.0.0.1:3006，实际浏览器 WebGL/GPU。

完整检查命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，最终退出 0。134 平台/验证、15 真实 WASM、2 DYN 样本、50 网页库、42 宿主集成、93 原生渲染测试通过；Rust 基础测试、Clippy、TS、发布 WASM、生产构建及离线资源核验通过。日志位于 validation/results/switch-labels-0.0.48-checks.log。

实际操作：初始化→地球→火星→木星→总览→暂停→俯视→放大→地球。目标数据就绪后控件恢复，木星贴图后续完成，未把贴图等待误报为目标数据阻塞。Console error 和 Rust ERROR 两组查询均为空，退出显示工作区已释放。实际 UI 操作没有构成受控首帧计时基准，不报告加速倍数或 FPS。

暂停俯视画面两次截图 overview-paused-a.png、overview-paused-b.png，中间无操作；中心标签区域 (520,260)-(810,415) 的逐像素差为零。缩放后的 overview-zoom.png 保留标签避让。earth-return.png 记录回切结果。动画过渡中的位置变化是相机运动，不视为静止标签抖动；密集场景的 120 帧扰动回归另外验证槽位稳定与无重叠。

独立只读审查未发现 P1/P2。首次完整检查发现异步诊断回归，已修复选中目标不可用时被背景加载覆盖的问题，并重新执行全部检查。当前证据不表示长时 GPU 预算和所有 NASA 操作均已验收。
