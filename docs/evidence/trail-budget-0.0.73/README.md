# 轨迹策略与WASM帧预算验收（0.0.73）

## 环境与构建

生产 Next + Release WASM，固定FOV45；实际CSS视口846×858，DPR1.5，画布1269×1287；Intel Arc B390，驱动32.0.101.8724，Windows平衡电源。浏览器为桌面应用内嵌Chromium，前台RAF约144Hz。构建版本、WASM大小与SHA见build-artifact.json；该文件记录提交前候选构建，sourceBase不是候选代码最终提交SHA。

## 可复现检查

`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets` 完整退出0。211平台、17基础WASM、2真实DYN、92网页、65宿主、145原生渲染测试，另含Rust/TS/clippy/Next/资源检查，见checks.log。

`node web/scripts/verify-trail-policy.ts` 经本地生产服务器逐项获取真实数据，九对象共27个边界前/精确/后样本全部ready，无抛出错误，见real-policy-boundaries.json。空/静止窗口不伪造轨迹。28槽位的全部有限端点、相邻epsilon、正倒序与默认恢复由离线精确源hash回归覆盖；不把27次真实求值说成全部GPU边界截图。

## 测量口径

performance-samples.json保留整个调试历史；只把标有candidate的指定场景作为最终候选暖态，较早final/profile命名不是最终验收。每两秒读取有界滚动诊断，摘要取各采样窗口p95/p99最大值，不冒充合并原始逐帧分布。暖态要求至少60秒；长任务用窗口首尾累计计数差判断，初始化已有长任务不消失。core.rendered_frames计数为真正执行的Bevy渲染周期/提交，不是RAF次数，也不是GPU完成时间；gpu_ms=null。worst_one_second_frames是页面整个生命周期的最低提交数，包含冷启动/切换等待，不能作为单独场景暖态最低帧率。当前没有逐次GPU完成时间或上传字节仪表，不能宣称已测得。

先前reactive双重等待使30档p95约51ms；历史MRO高倍速窗口p99达66.4ms并新增长任务。修复统一调度、分片、主通道质量控制及目录/跟随列表缓存后，以最终candidate重新测量，不放宽40/50ms门槛。真实数据准备与首次上传仍可能产生长任务，单列而不掩盖。

## 边界

这批交付28个轨迹动作与帧预算，不代表所有NASA功能已经完全一致。其余13个有效Coverage槽位、Huygens额外约1.7m局部平移及未支持自转仍在函数级账本中。真实资源无覆盖/不可用按对象显式报告，不生成替代数据；场景中未选中对象的局部错误不暂停全局时间。部分场景既有自然光与近距离构图仍需继续视觉对齐，不以性能通过声称视觉完全等价。60为上限不是保证每台设备60；144Hz下受最短间隔约束可稳定在约48次提交/秒。30档恢复和分辨率逐级恢复独立，科学时间/FOV/逻辑视口不改。

## 本批实现约束

自然轨道与人造拖尾仍分别处理。显示窗口与缓存预取窗口分离；相对端点只随科学时间平移，绝对端点不动；始终与真实样本覆盖相交，缺口断线。SDK双端校验参考体/参考姿态及显示窗口，插件仍不能访问Bevy内部。任务最多2活动/64排队，每对象最新修订，单周期最多发布1结果；不可恢复的单对象错误有界记录。网格容量复用且同数据不重复上传。帧预算以单调墙钟运行，无忙等/sleep/逐秒补算。

30档采用CPU25ms/间隔40ms阈值继续降主通道质量，恢复质量阈值CPU20ms/间隔38ms连续10秒；完整质量后CPU8ms/队列<=2连续10秒才恢复60。允许0.5ms最短间隔调度容差，同时相位累计上限受测试约束。

## 最终候选暖态结果

|场景|采样跨度秒|窗口p95最大ms|窗口p99最大ms|新增>50ms长任务|门槛|
|---|---:|---:|---:|---:|---|
|overview-1-candidate|117.4|35.6|36.5|0|通过|
|earth-1-candidate|104.8|35.1|38.8|0|通过|
|jupiter-2-candidate|107.5|21.6|23.1|0|通过|
|iss-480-candidate|127.2|36.4|43.7|0|通过|
|lro-2-candidate|104.3|21.8|22.9|0|通过|
|mro-ui-candidate|113.1|34.9|36.3|0|通过|
|psyche-negative480-candidate|120.1|21.9|22.9|0|通过|
|juno-phase2-candidate|108.5|21.6|23.6|0|通过|

详见performance-summary.json。MRO在采样期间仍播放，随后长时间57600倍速越出覆盖后触发返回总览并暂停，这是覆盖保护而非暖态卡死。ISS截图存在近距主星构图/自然光既有视觉问题，不据此宣称视觉等价。总览仍有Europa Clipper/Juice/Lucy源不可用，地月关联ESCAPADE源不可用，保留明确错误提示，后续应独立修复。
