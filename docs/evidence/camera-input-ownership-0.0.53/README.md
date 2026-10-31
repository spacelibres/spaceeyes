# 0.0.53 相机输入所有权

2026-10-31，核心0.0.45、SDK0.0.35、网页0.0.53。执行《NASA-Eyes源码全局架构分析与能力保持规则》第一批的输入子项，基线3e2508758。并非宣称整个第一批或全部NASA功能完成。

## 影响和保持规则

只改变Rust相机输入缓冲的所有权。宿主受控缩放使用独立host_zoom平滑状态，在update_focus中每帧消费；原生鼠标惯性仍由orbit_input处理，失焦立即清理。目标/视图变化、原生新按下清理旧宿主缩放；窗口失焦不能清掉有效宿主指令。保持SDK权限和参数、原有平滑时间常数、科学时钟、FOV、相机碰撞、真实半径、轨迹、标签、hover和光照路径。未增加第二台相机或新的平台接口。

原问题中apply_controlled_input将宿主zoom写入motion，下一帧orbit_input在失焦时先清motion并返回，导致指令已取走但距离不变。新增真实App链测试先在旧实现出现focused=false/hz=30失败，随后修复。不是关闭失焦保护来让测试通过。

## 集中检查与审查

`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`

最终退出0，输出checks.log仅去除行尾空格。142平台/验证、16真实WASM、2真实DYN样本、50网页库、50宿主集成、108原生渲染测试通过。Rust基础、Clippy、TS、发布WASM、生产构建与离线资源检查通过。

新增回归覆盖focused/unfocused、30/60/120Hz下相同一次缩放意图的总位移；预置失焦前鼠标拖动/滚轮残余，验证其被清除，重新入焦不会回放；同时断言选中对象、科学时间与物理半径不变。现有Follow、长边FOV、相机碰撞、取景、悬停线组和环带拾取回归保持通过。独立只读审查未发现明确P1/P2；补充目标切换尾段与fresh press独立清理断言为后续测试建议，未冒称本轮新增覆盖。

## 实际WASM与GPU

3006生产服务重启为0.0.53。地球System，TDB846690000、暂停、FOV45、shadow，全部对象图层开启。

earth-before.png与earth-after-zoom.png：未点击画布，仅通过宿主“缩小”按钮连续三次，UI只读相机诊断由Y=81659593.75415862km变为80804373.13167785km，其他位置分量、focusedId=earth及科学时间不变；原始UI记录见camera-observations.json。

moon-hover-after-zoom.png：缩放后的月球标记仍命中自身轨道并高亮，当前目标和时间没有变化。earth-nearby.png：System切换Nearby重新取景，地球表面恢复近景，名称随近景隐藏。该截图不代表全部轨迹深度/遮挡已达到NASA标准。

浏览器error和Rust ERROR查询均为空；退出后界面显示工作区已释放。此处没有新增帧率结论，也没有声称后台浏览器的原生滚轮/拖动行为全部验收；这些仍受窗口焦点约束。实际验收的是受控宿主按钮、模式切换及缩放后hover。

## 后续

按照统一规则继续最终相机/原点/投影半径的复用与可见性协同；再进行太阳分层组合和轨迹线网格。当前没有删除旧能力或修改太阳效果来完成输入修复。
