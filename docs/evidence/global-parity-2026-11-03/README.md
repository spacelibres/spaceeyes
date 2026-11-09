# 本批验证及未完成边界

基线aabd4edf4，SDK0.0.51 / 网页0.0.89，核心0.0.63不变。全局报告见../../NASA-Eyes全局对照与细化对齐-2026-11-03.md。

## 实施范围

共享最后有效静态位置控制器选择器，贯通位置、速度、覆盖和来源。NASA依据Entity-62.js的getPositionAtTime/getVelocityAtTime按声明顺序覆盖查询输出；FixedController.js非空位置令速度为零；RotateByEntityOrientationController.js的rotatingPosition=false不修改位置/速度。

旧实现真实Pathfinder公共闭端点-78692826，位置仍取前一个固定值[1733.8045354970886,-3114.1893353832183,-682.0562165671394]，父体和覆盖已切至落地点。修正后局部位置/速度均为零。probe-pathfinder.ts直接求值真实已收录定义；该对象不在可浏览目录，所以没有将此脚本当作真实网络/浏览器端到端通过。此目录缺口保留A02。

复现固定/轨道元素相反声明顺序、仅旋转姿态误动位置/拒绝速度，以及旧DYN缓存在固定阶段返回[0,0.8775825618903728,0]而非零速度。新增回归先失败后修正；修正后的聚焦79项检查通过。velocity-before.log和position-tests.log保留失败及最后通过输出。旋转参考系的完整速度求值和DYN/静态全部声明混合顺序仍未全覆盖，不扩大本批结论。

## 实际检查

完整命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，最终退出0；含157项原生渲染、Rust/Clippy、平台与网页TS、WASM集成、发布WASM、Next及离线真实样本/模型/表面核验。日志checks.log。独立审查发现速度缓存关联缺陷后已修正，复审无阻断项。

51项能力JSON保留当前文件与NASA源SHA、原基线变化和未作成对验收标记。142条历史记录及26份NASA源引用校验通过，不能称为142个独立函数已验收。

## 浏览器发现：不可当成通过

- Dactyl，TDB846620500、system/orbit、shadow、FOV45：实际显示中主星裁切，见dactyl-system-finding.png，记录A20相机/系统取景缺口。
- NEAR，TDB35279033、nearby/orbit、shadow、FOV45：近景被白色表面遮满，见near-landed-finding.png；记录A23/A30的着陆近景及显示差异，尚未定位是否模型碰撞、材质或取景共同导致，不声称已修。
- Earth，同一TDB846620500、system/orbit、natural、FOV45：地月系统和关联对象完成渲染，见earth-system.png；浏览器控制台error为空。不把无错误日志写成与NASA画面一致。
- 旧Pathfinder共享链接会退到总览，目录没有该目标；不能把页面有画面当作该任务加载成功。

本次没有同姿态NASA在线成对截图、GPU计时、显存或整帧分位耗时；所有pairedRuntimeParity仍为false。上述视觉缺陷作为下一批定位项保留；本次数据修正不改变相机/材质实现，也不以本批宣称平台全部对齐。远端CI提交后通过gh跟踪。

后续分批记录：0.0.90修正卫星系统的主星取景中心；0.0.91补齐22个关联主星模型和实际几何取景范围；0.0.92修正NEAR/Eros平均球碰撞推远着陆镜头。证据分别见同级system-framing-0.0.90、parent-models-0.0.91、landed-surface-0.0.92目录。历史失败截图和本次JSON保留原样，不把新回归当作已完成全站成对验收。光照、材质、连续动画及Pathfinder目录缺口仍待推进。
