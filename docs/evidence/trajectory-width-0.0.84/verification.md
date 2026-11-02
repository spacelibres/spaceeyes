# 轨道线宽分辨率补偿

本批仅修正已批准的NASA Eyes轨迹显示对齐，不改变科学位置、轨迹策略、拖尾时长、对象数量、相机操作、标签或品牌界面。

## 来源与差异

- 本地参考：C:/Users/stone/Documents/solarsystem/eyes/src/engine/managers/TrailManager.js。自然轨道基础宽1.2、悬停2；拖尾默认0→2、悬停2→4。本项目trajectory_render.rs已采用这些数值。
- 本地参考：同目录../core/LineShader.js，63—64行。实际宽度另乘`max(1, min(viewportSize.x, viewportSize.y)/800)`。
- 本项目web/resources/shaders/trajectory.wgsl缺少此因子。本批补齐同一公式。网格corner.x为±0.5，故传入全宽，不再重复除二。
- 短边720时因子1；1080时1.35，基础自然轨道1.62px；1440时1.8，基础自然轨道2.16px。公式作用于GPU视口像素，并非世界坐标半径。

## 验证

命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，退出0，完整日志checks.log。

Rust基础及154项原生渲染测试、TS平台/数据/网页/宿主测试、类型检查、Clippy、WASM发布构建、Next构建和离线资源核验通过。

实际浏览器1080像素高视口：太阳系彩色轨道可见，ISS 480×播放场景模型与拖尾可见；加号相机输入接受，控制台error及ERROR均为空。截图overview-1080.png、iss-1080.png。悬停宽度计算路径经源码核对，未单独完成指针悬停截图验收。

这不是全功能NASA对齐验收，也不是性能基准；本批未测GPU计时、显存或精确光栅覆盖差值。默认小视口因子为1，不会无依据增粗。
