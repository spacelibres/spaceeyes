# 参考照片太阳配色验收

核心0.0.24 / SDK0.0.23 / 网页0.0.30。仅颜色和光球亮度配置，不调整几何、动画、Parker输入或采样预算。

完整集中检查命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，退出0，原生渲染45项通过，详见checks.log。

实际GPU太阳近景见solar.png。新版“应用参考图配色”从白色光球恢复#FF4400及亮度1.05，保持自定义flowSpeed0.35以及全部非配色字段不变，见button-result.json。浏览器error和Bevy ERROR日志为空。

颜色表见palette.json；当前用户配置已通过既有JSON界面应用六项配色并本机保存，原有图层开关、形态、速度与物理参数保留。用户的光球/外流/日珥开关当时均关闭；截图使用独立临时页开启显示进行GPU验收，未保存覆盖这些开关。临时预览页已关闭。
