# 太阳缩放配色与标签回归

核心0.0.27 / 网页0.0.33，2026-10-31，codex/bevy-planning。

根因与修复：太阳shader仍按距离在纯色和详细色阶间混合，远景标记及光晕另用旧金黄色。已删除距离配色分支，同一色阶只滤掉不可分辨的高频细节；标记及光晕读取当前太阳surfaceColor。总览连续放大还可能进入中心天体内部，只见红色日冕；现按科学半径限制相机在表面外，并按表面间隙设置近裁剪面。

用户明确确认“靠近或选中后自动隐藏”：选中标签立即为0透明度；未选中角半径超过0.12时淡出，低于0.10时恢复，区间使用滞回，保留遮挡与碰撞布局。选择状态由核心focused_object判断。

完整命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`。checks.log包含完整适用检查通过；原生渲染56项。新增标签选中/取消/近远测试，标记配色测试；真实App反复将总览距离设得极小，验证相机不进入中心科学球体且近裁剪面小于表面间隙。

GPU：IAB/WebGL2实际鼠标滚轮近、中、远缩放，near-selected.png、mid-selected.png、far-selected.png显示橙色配色且无SUN标签；far-overview.png取消选中后恢复SUN名称。截图间动画与投影自然变化，不是逐像素相等承诺。相机表面边界另有最终构建复验，错误日志见gpu-logs.json。日冕/日珥仍按距离独立显示，不宣称完整天体物理或稳定FPS。
