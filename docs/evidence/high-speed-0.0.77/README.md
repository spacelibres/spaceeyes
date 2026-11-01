# 高倍速播放修正证据

## 范围

核心0.0.57、SDK0.0.48（不变）、网页0.0.77。对齐本地NASA Eyes源码中的百年UTC时间范围、边界内1ms暂停；修复低CPU成本时后台任务计数永久阻挡帧率恢复。不减画质、不缩尾、不改变科学样本或倍率。

## 失败到通过

- time-red.log：旧WASM宿主越过上限仍playing=true；新增测试先失败。
- recovery-red.log：4个后台任务、CPU5.7ms持续11s后旧实现仍30fps；先失败。
- recovery-green.log：修复后12项帧预算测试通过。
- host-green.log及checks.log：最终完整检查217平台/验证、17基础WASM、2真实DYN、98网页、66宿主、145原生渲染；fmt/clippy/TS/ReleaseWASM/Next/资源检查通过。第一次完整检查发现两个旧测试使用超出百年范围的日期，随后将日期移入合法范围，保留原先取消加载、过期维护和失败回滚的测试目的，再完整重跑。
- 新边界回归覆盖总览和选中地球，正向36000倍、反向86400倍，直接TDB/UTC越界跳时明确拒绝。

## 实际浏览器

原0.0.76测试页地球10hr/s记录earth-before.json；ISS记录iss-before.json。地球CPU p95约5.7ms、4个待处理任务、target30，呈现p95约35.2ms。

新0.0.77同机地球10hr/s记录earth-after.json：cpu_recovered，target60，resolution_scale=1。截图证明实际触上限后暂停在2049-12-30T23:59:59.999Z。不得把target60解释为实测恒定60fps；高刷量化、异步加载和实际GPU成本仍需持续验证。浏览器测试为功能和诊断验证，不是完整固定条件基准或NASA成对验收。

## 明确未完成

- 所有航天器、所有倍速的完全无抖动验收。
- 数据分段刷新、跨帧轨迹过期、独立宿主/渲染节拍的全面治理。
- GPU毫秒（当前null）及完整八场景CPU/显存对比。
- ESCAPADE/Chandra等现有源异常没有通过隐藏对象或取消功能处理。

浏览器反向-3yr/s触下限实测停在1949-12-31T00:00:00.001Z，见min-boundary.txt/png；正向10hr/s触上限见max-boundary.txt/png。
