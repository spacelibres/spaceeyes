# 卫星系统取景中心（核心0.0.64 / 网页0.0.90）

依据NASA本地CameraViewBlock.js的卫星入口（约239行）调用system(parentEntityId)，以及CameraScripts._goToSystem的25度构图和getDistanceToFitEntities。选择对象与实际相机取景对象是两个角色；本批不将Dactyl改选为Ida。

## 修正链路

- 宿主通过既有systemId传所属主星，统一系统成员为主星、选中目标及当前就绪天然成员；nearby/follow不改。
- 核心选择保留在卫星，相机的浮动原点、系统拟合、碰撞历史和碰撞后朝向统一使用系统主星。nearby/follow回到原选中目标。
- 实际浏览器发现轨道仍按旧的“选中卫星近景”淡出，已将轨道可见性参考及距离同步为实际取景对象。标签仍用选中身份，避免因系统相机变化丢失选择语义。
- 全宿主回归发现已发布的选中对象会在并行刷新中短暂标记loading，系统成员不得因此漏掉必需目标；额外成员仍按ready筛选。

## 验证

新回归先失败再修复：旧原点为[100000090,200000000,300000000]，应为主星[100000000,200000000,300000000]；旧成员缺少Earth。测试包含选择不变、主星和卫星完整视锥包围、碰撞后的观察中心、系统→近景以及nearby/follow目标。

最终完整命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，设置CARGO_BUILD_JOBS=2仅限制本机编译并发，不改变产品功能或画质。退出0，含159项原生渲染、69宿主及全部适用Rust/TS/Clippy/WASM/Next/真实资源检查，checks.log保留输出。独立复审无阻断项。

GPU浏览器Dactyl：TDB846620500，system/orbit、shadow、FOV45、相同默认1280×720。dactyl-before.png为0.0.89主星裁切画面，dactyl-after.png为本批完整主星/卫星轨道；控制台error为空。主星仍是占位球，不能把该图宣称真实Ida材质/模型已通过。月球系统回归保存moon-system.png。

## 未完成项

已定位参考依赖主星模型未在宿主注册（例如Eros/Ida），部分模型资源也未进入锁定源表。NEAR着陆遮满需要在下一批接通真实模型后复测；不通过隐藏主星、放宽资源来源、删卫星或改时间解决。光照、材质、连续动画未夹带修改。全部NASA成对体验、GPU时间和显存仍未全量验收。CI提交后用gh非阻塞跟踪。
