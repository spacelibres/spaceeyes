# 关联主星模型 0.0.91

根因：模型资产仅为发现目录注册，43个依赖对象中的22个带模型主星未完整接入；其中12个独立模型未在资源白名单。set_visual失败后仍保留占位球。修正注册范围并补齐严格锁定的NASA资源，不删除主星或修改科学半径。

`model-conversion.json`记录22项受控服务转换后的GLB字节数、SHA及耗时。合计82,640,296字节为服务端缓存产物，不代表浏览器初始化下载量。生产仍按场景请求，不将二进制资源提交或嵌入WASM。

`validation/eyes-parent-framing.json`通过`node web/scripts/audit-parent-framing.ts`重建。使用实际转换顶点和层级矩阵求相对原始实体原点的半径，绑定转换器文件SHA、原始模型/几何缓冲区SHA和描述变换。拒绝蒙皮/形变包围范围猜测。NASA显式包围半径优先。

验证命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，编译并发CARGO_BUILD_JOBS=2。最终退出0，日志checks.log；另执行新增资源与包围范围来源测试及网页类型检查。独立代码审查无阻断项，补强完整geometrySources键集合检查。

浏览器：Dactyl，TDB846620500、system/orbit、shadow、FOV45，真实Ida及完整Dactyl轨道同时入镜，见dactyl-system.png。NEAR，TDB35279033、nearby/orbit、shadow、FOV45，真实Eros已加载但着陆镜头仍遮满，见near-collision-unresolved.png。两个场景控制台error为空。

着陆剩余根因：NEAR落点相对Eros中心约6.42km，Eros科学平均半径8.42km，球体碰撞不能代表不规则实际表面。下一步需保留实体碰撞并采用实际几何边界；本版未改碰撞。无NASA同姿态成对像素/GPU耗时/显存或整帧分位验收，不宣称全部对齐。核心0.0.64、SDK0.0.51保持。
