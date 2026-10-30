# 0.0.8 首页自动进入验证

2026-10-30，普通 URL http://127.0.0.1:3006/，Next.js 生产构建及真实 Bevy WASM。

刷新后没有点击进入按钮，页面自动经历“正在进入太阳系工作区”并出现真实三维画布、8/10 数据可用及退出按钮。保留加载取消、失败重试和退出后手动重入；自动启动仅在组件挂载时调度，StrictMode 清理撤销尚未执行的定时器。

完整命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，退出 0；本地日志 validation/results/core-0.0.8.log。96 项不同自动测试通过，另有格式、严格类型、Clippy、WASM 与 Next.js 构建、真实样本契约及固定资源检查。

本次只改变入口时机，未扩大 NASA Eyes 效果、科学精度、性能及鼠标完整自动化的验收声明。金星/火星源异常边界沿用 0.0.7。
