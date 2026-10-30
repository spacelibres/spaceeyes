# 深空交互与视觉 0.0.21 验证

分支 `codex/bevy-planning`；核心 0.0.17、SDK 0.0.19、网页 0.0.21。NASA 原图、外置 WGSL、真实 DYN 和父体层级保持独立；不操作冻结分支。

## 自动化

完整命令：

```powershell
pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets
```

结果见 `checks.log`；编译通过不代替实际 GPU。源 EXR 与派生图的字节、哈希、尺寸和本机转换耗时见 `galaxy-conversion.json`，源白名单见 validation/galaxy-assets.json。派生 WebP 3,275,502 字节，原图 36,436,668 字节；资源不嵌入 WASM。浏览器构建包检索 EXRLoader 无匹配，Three 仅在服务器解码 EXR。

## GPU 回归中发现并修复

1. WebGL uniform 需 16 字节对齐，银河 intensity 改为 Rust/WGSL 一致 Vec4。
2. Bevy 0.19 透明距离升序排列，背景使用负排序偏置：银河先于恒星，恒星先于透明环。
3. 隐藏标签先排队删除后又插入透明度导致实体错误；透明度更新移入保留标签分支。回归覆盖透明度、删除和后续更新。

必须同时检查 error 级日志和 Bevy 以 log 转发的 ERROR；不能仅用 error 日志空数组判定通过。

## 范围

惯性确定性测试验证帧步长、反向制动、释放限幅、失焦和重入保护；实际画面用于核对交互连续性，不宣称精确鼠标延迟基准。银河为 ICRF 方向背景，没有近距离平移视差；星点保留距离。日冕为视觉模拟，不是实时太阳观测。当前未实现 WebXR 双眼入口或头显验收，VR 只保留按视图投影和姿态输入隔离边界。


## 本次实际结果

完整检查退出0，原生渲染库39项测试通过。实际GPU确认太阳贴图、表面锚定弧形日珥、拖动环绕遮挡、银河/星点叠加及返回总览；截图见 sun-prominences.png、galaxy-overview.png。浏览器日志见 browser-errors.json。

银河当前为1024×512预览→4096×2048高清两级渐进加载，高清待加载时保留预览；尚未实现按视野高清瓦片调度。冷缓存服务器仍需先获取并转换固定EXR才能生成预览，不宣称冷启动转换成本消失。

日珥为单mesh合批的24组五股弧线，外置shader驱动流动；几何锚点/半径/数量有测试。当前仍偏细线状，未达到用户参考图的浓密体积等离子体质量。后续要补局部喷发、细丝密度和体积层次，不能将本阶段宣称为参考效果全部完成。
