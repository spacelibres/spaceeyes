# 数据预算与回滚0.0.41验证

2026-10-31，生产构建127.0.0.1:3006。完整日志validation/results/nasa-budget-0.0.41-checks.log通过：109项平台/格式、12项真实WASM、48项web lib、30项宿主集成、82项原生、真实DYN与62个表面环资源及Next构建。

- 真实浏览器地球场景→总览→退出；earth-cache.png/earth-diagnostics.txt与overview-cache.png/overview-diagnostics.txt记录缓存计数。总览回到728 records、9位置+1姿态、10来源，退出后全部0。不是JavaScript堆内存测量；快照与在途临时分配仍可能额外占内存。
- 最终总览不再显示已移除任务旧告警；如果基础天体仍失败则保留提示，真实WASM覆盖该回归。浏览器console error与Bevy ERROR为空。
- Rumba当前时刻覆盖外，通过“前往有效观测时间”到TDB19105315，恢复位置ready/模型资源ready，hash3213e6aff4ae与真实有效范围有记录；姿态502单独明确提示，不冒充真实朝向。其近景取景仍异常，保留下一批调查，不把数据ready称为视觉通过。
- mock与真实WASM验证预算、来源有界、hash取消、回滚清除事务新增对象、恢复旧场景、discard和dispose。应用接入快照finally释放，活动依赖闭包含父体和姿态参考。
- 长时GPU/堆峰值、全目录逐项科学精度与全部模型姿态仍未完成，不借本版勾选全部第一版验收。
