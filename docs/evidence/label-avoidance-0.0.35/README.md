# 标签实时碰撞避让

核心0.0.29 / 网页0.0.35，2026-10-31，codex/bevy-planning。

用户纠正：不是总览隐藏其他行星名称，而是标签要实时碰撞避让。已撤回上一版只保留SUN的过滤，保留此前确认的靠近/选中隐藏与科学遮挡规则。

按真实字体包围盒加间隙做矩形碰撞；每帧在本帧相机矩阵更新之后投影，在附近52个行列候选位置中优先选离对象最近的可放位置。碰撞时移动名称，点击区域与移动后的文字一起更新。没有采用“原四个位置占满就隐藏”的策略。超出视口或实际尺寸无法放入视口的文字仍不强行堆到边缘；不承诺有限屏幕同时容纳无限数量标签。

命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，checks.log记录全量通过，原生62项。布局专项4项：12个同锚点标签全部保留且不重叠；10个密集行星名称连续60帧移动，全部保留、无重叠、不超边界；离屏及实际字体边界约束。

实际GPU：overview.png及top.png显示恢复后的各行星标签，改变相机视角后重新排布。gpu-logs.json记录捕获的error与Bevy ERROR为空。相机科学球体碰撞和0.6秒旋转惯性未撤回。
