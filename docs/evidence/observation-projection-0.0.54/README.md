# 0.0.54 共享投影尺度与LOD更新顺序

2026-10-31，核心0.0.46、SDK0.0.35、网页0.0.54，基线ab9ab29a3。执行全局规则第一批的投影尺度子项，不宣称全部观察状态已重构。

## 问题、改动与依赖

原deep_lod将垂直FOV钳到至少10度，混用了宿主长轴FOV下限与Bevy实际垂直FOV。宽屏短视口可以合法小于10度：5度、物理高100px时应为第7层（内部6），旧逻辑算第6层（内部5）。先加回归确认旧实现失败5!=6，再修复。

新增内部observation模块校验有效Perspective和视口，统一逻辑/物理尺寸、环带射线、物体投影半径及深空采样密度。标签和标记继续用逻辑像素，纹理LOD用物理像素。保留Bevy实际world_to_viewport和近远裁剪，不重写投影矩阵或科学坐标。

LOD在PostUpdate等待CameraUpdateSystems与TransformPropagate后读取本帧投影；环境资源与星空材质在下一Update消费已完成帧的层级，仍渐进加载，不为资源等待暂停科学时间。没有把不同阶段伪装成全局原子帧；后续太阳/环境统一观察结果仍需逐步推进。

现有七层上限、滞回、资源预算、SDK权限、相机碰撞、宿主缩放、固定锚点标签和自然/人工轨迹分类保持。太阳外观和数值模型未修改。

## 集中检查

`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`

最终退出0，checks.log仅去除行尾空格。142平台/验证、16真实WASM、2真实DYN样本、50网页库、50宿主集成、111原生渲染测试通过。Rust基础、Clippy、TS、发布WASM、生产构建、离线资源检查通过。

新增覆盖有效低垂直FOV、非法FOV/空视口、DPI翻倍只改变物理采样密度而不改变逻辑投影半径和拾取射线、旋转相机及背后物体拒绝。独立审查未发现新增明确P1/P2；既有自定义子视口origin与光标归一化限制单独记录，不能据内部封装宣称已支持。

## 实际WASM/GPU

生产服务3006重启为0.0.54。地球System，TDB846690000、暂停、FOV45、shadow，全部对象图层开启。

- landscape.png / landscape-hover.png：默认1280×720构图，月球悬停只增强对应轨道，目标和时间不变。
- portrait.png：临时720×960观察构图，宿主缩小按钮可使场景拉远；portrait-canvas.json记录CSS720×960、背板1080×1440（该环境1.5倍像素比）。
- portrait-hover-attempt.png：尝试竖屏悬停，未取得有效高亮证据；不列为通过，也不据此判断实际用户设备行为。原生DPI单位测试不能替代该项端到端验证。
- landscape-restored-hover.png：恢复默认视口后，月球悬停再次正确；保留上一版宿主缩放后的状态。
- deep-space-diagnostics.txt：目标/就绪/当前层级7/7/7，33瓦片，17.62MiB/64MiB，资源错误无。此处是当前场景诊断，不是所有视角长期预算或FPS结论。
- errors.json：浏览器error与Rust ERROR为空。退出显示工作区已释放；临时视口设置已复原。

## 仍未完成

全局观察结果一次生成并供太阳、环境、标签等全部模块消费尚未完成；本轮统一投影单位及更新顺序。竖屏悬停的有效端到端证据、自定义子视口、轨迹逐顶点收尖和太阳分层组合继续按全局路线处理。
