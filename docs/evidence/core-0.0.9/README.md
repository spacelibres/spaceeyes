# 0.0.9 验证记录

完整集中脚本 tools/check-core.ps1 -Renderer -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets 已完成，日志 validation/results/core-0.0.9-delivery.log。97 项不同自动测试通过。默认字体与 SMAA/tonemapping 图片功能关闭，采用 Bevy KhronosPbrNeutral 算法，调色基线改变，完整 NASA 视觉校准仍待验收。

浏览器实际核验：总览请求轨道数据及外置字体，无行星贴图或姿态预取；选择地球后仅新增地球姿态及六张地球贴图，显示资源 ready。清单见 overview-assets.json、earth-assets.json，截图见 overview.png、earth.png。范围仅为本批流程复验，不代表完整 NASA 效果或性能通过。debug WASM 164197457 字节，尚非优化发布体积。
