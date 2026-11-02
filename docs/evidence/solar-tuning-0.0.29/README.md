# 太阳实时调参验收

核心0.0.23 / SDK0.0.22 / 网页0.0.29，2026-10-30。

完整集中检查：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，退出0；原生渲染45项通过。涵盖TS/Rust参数边界、非法配对、顶点预算、真实WASM权限/归属/失效会话、视觉修订不变，以及现有DYN/资源/工作区回归。完整记录checks.log。

## 实际GPU界面操作

- panel.png：58项分组入口和体积外流控件，实际更改材质而非静态表单。
- surface-off.png：仅关闭光球，保留三维外流和日珥。
- all-off.png：关闭全部特效，光球、外流和日珥均停止显示，科学对象及标签保留。
- paused-a/b.png：停止科学时钟时勾选特效暂停，间隔截图在[150,140,900,560]的315000像素区域变化为0；恢复running.png变化267207像素，见animation-comparison.json。
- parker.png：温度2MK、1AU参考电子密度10cm^-3，音速181.7km/s、临界半径2.89R、1AU速度752.2km/s。物理输入经过重新求解生成查表。
- 日珥弧束24改为12已在GPU执行；verified-config.json为导入后再次关闭/打开面板并导出的配置，保留windGain0.2、archCount12、temperatureMK2、densityCm3 10。
- 超预算sampleCount25的JSON导入被拒绝；保存配置后在独立新页恢复了原58项值。测试页未保存测试覆盖值，保留用户本机配置。
- 浏览器error及Bevy ERROR日志为空，见browser-errors.json。

默认物理表随外置WGSL在服务器生成；调整后的64点查表通过SDK运行时传入，未在WASM嵌入资源表。普通调参不增加资源修订，不重载表面贴图；几何参数原位更新专用Mesh。仍是程序日珥/体积噪声及Parker背景，非离散粒子或完整MHD。低采样有颗粒感；本次无头显稳定帧率结论。
