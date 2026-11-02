# 等离子体距离LOD验收

核心0.0.21 / 网页0.0.27，2026-10-30。

完整检查命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，退出0，原生渲染测试41项通过；其余结果见checks.log。

实际GPU：overview.png为初始总览；near.png为选择太阳靠近；far.png为近景滚轮向外拉远后无等离子体；reenter.png为再靠近恢复。浏览器error级日志及含ERROR的Bevy日志均为空，见browser-errors.json。

自动化生命周期测试验证远景零专用资产、靠近创建、8/10R滞回复用、离开销毁、再次进入、源天体移除后回收。以到中心距离/恒星渲染半径判定，小于8R创建，10R退出；6..10R渐隐。

保留共享球网格和Bevy初始化加载的着色器/管线缓存。停止绘制与回收专用材质、日珥网格不等于清空通用GPU缓存。本次不声明VR帧率或完整MHD模拟精度。
