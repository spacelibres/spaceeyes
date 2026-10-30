# 统一太阳显示回归

核心0.0.26 / 网页0.0.32，2026-10-31，codex/bevy-planning。

根因：宿主初始stellarSettings未赋值；打开太阳面板自动发布另一份配置；近景程序化表面退出距离后恢复StandardMaterial/NASA六面贴图。三个入口不是同一显示路径。

修复：工作区创建前读取并规范化本机配置，首次绑定太阳即经SDK发布；选择和升级重用配置。面板打开不发布。工作区只用观测太阳，兼容模式留给旧SDK调用；面板仅显示33个当前有效参数。太阳使用同一材质，远景平滑降低细节并跳过噪声，不换NASA照片；日珥/日冕仍按距离启停和回收。便宜的表面材质保留到关闭/源移除，业务贴图不预载。

验证命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，完整日志checks.log。原生54项、真实WASM宿主13项、新存档测试及完整适用检查通过。新增断言首选太阳之前已发布配置，初始化/选择/总览/地球/再选太阳配置一致，太阳不绑定faceAssets；v1/v2保留手调数值并统一模式。真实App断言8/10R前后同一个表面实体/材质。

浏览器实际验证初始化、选择、打开面板、回总览；initial/selected/panel/returned.png记录画面。捕获的error级及Bevy ERROR均为空。表面动画会随时间变化，远近细节变化不等于切换另一种太阳；未以截图宣称科学精度或稳定FPS。
