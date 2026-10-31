# 0.0.52 系统取景与轨道悬停核验

2026-10-31，核心0.0.44、SDK0.0.35、网页0.0.52。源代码依据为用户本地 solarsystem/eyes/src/engine 中 Cameras、CameraScripts、TrailManager；设计与源参数表见 ../../NASA-Eyes显示比例与轨道悬停对齐.md。

## 集中检查

最终源代码运行：

`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`

退出0，完整输出见 checks.log。142平台/验证、16真实WASM、2真实DYN样本、50网页库、50宿主集成、107原生渲染测试通过；Rust基础测试、Clippy、TS、发布WASM、生产构建与离线资源检查通过。

新增覆盖七项纯取景数学检查、系统进入/运动稳定/窗口重拟合、不改变科学坐标与半径、独立普通/悬停线宽组、悬停离开和拖动清除，以及透视环带、环孔和中心出屏命中。旧相机生命周期测试中固定4倍距离改为NASA的45度视场与1.3余量公式，模型替换、目标切换与科学半径断言保留。独立审查指出初版投影椭圆不能精确处理透视及中心出屏，已改为三维射线与环平面求交并复审。

## 实际GPU

重启3006生产服务，在1280×720浏览器中以TDB846690000、暂停、45度视场、暗面补光进入System模式。

- earth-normal.png、earth-moon-hover.png、earth-hover-cleared.png：月球标记悬停后只有月球轨道增强，移出恢复；地球仍是选中对象，科学时间仍为846690000。鼠标定位使用画布禁止菜单且不触发选择的右键点击，检查释放后的悬停。
- jupiter-system.png、jupiter-europa-hover.png：四颗主要木卫与木星共同构图，木卫二悬停仅增强自身轨道；没有修改半径或轨道距离。
- saturn-system.png：土星、星环与主要天然卫星共同构图。
- catalog-radius-audit.json：记录七组目录半径比例，证明当前取景使用的原始值；不代表独立天文学精度认证。

地球场景部分非选中航天器源请求暂不可用，截图保留真实提示；随后木星15/15、土星17/17可用。ISS代表模型载入后10个对日关节ready。浏览器error及Rust ERROR查询为空，退出工作区后释放资源。

## 边界

此处GPU证据覆盖三组系统构图和天然卫星悬停，不声称全633项目逐任务验收、固定FPS或全部操作已与NASA一致。人造卫星拖尾的独立悬停线宽组通过原生回归，未取得本轮实际拖尾悬停截图；后台验证中ISS缩放输入未产生可见变化，不能把该操作列为通过。NASA逐顶点拖尾线宽收尖与完整LineMesh抗锯齿仍待迁移。模型用有界投影拾取，星环用几何环带，未做逐三角形或贴图透明像素拾取。
