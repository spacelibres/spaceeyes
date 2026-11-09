# 网页 0.0.11 加载与恢复验证

本批只修改网页宿主，核心维持 0.0.10 发布构建。完整检查 tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets 退出 0，日志 validation/results/web-0.0.11-final.log；98 项不同自动测试通过，另含严格类型、Clippy、构建和资源校验。

新增真实 WASM 边界测试先复现失败（取消导入后仍初始化一次），修复后确认初始化次数为零。动态 import 或已开始的 WASM 初始化本身不能中断；本批在阶段边界拒绝继续，不宣称取消能终止已发送的全部模块下载。

浏览器确认下载/初始化阶段提示、自动进入总览、退出后单次操作创建新文档并重新进入。页面一次观察值 4.07 秒，计时从 createWorkspace 调用至 start_renderer 返回，包含初始数据加载，不包含导航、首帧与贴图就绪；不是冷启动性能验收。loading.png 和 ready.png 为初轮浏览器记录，final-ready.png 为修正退出状态误判后的最终界面。
