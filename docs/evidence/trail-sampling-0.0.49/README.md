# 0.0.49 航天器拖尾验证

2026-10-31，codex/bevy-planning。核心 0.0.41、SDK 0.0.33、网页 0.0.49。

## 集中检查

最终代码修改后执行 `pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，退出 0。日志 `validation/results/trail-sampling-0.0.49-final-checks.log`。

138 平台/验证测试、15 真实 WASM、2 DYN 样本、50 网页库、42 宿主集成和 94 原生渲染测试通过；基础 Rust 测试、Clippy、TS、发布 WASM、生产构建及离线资源检查通过。专项回归覆盖加速曲线、对象/父体内部覆盖缺口、八次折半后仍未解决的跳变、父体观察与航天器自身近景的拖尾显示区别。

独立只读审查未发现 P1/P2；按审查建议加强了缺口测试，直接断言任何未断开的相邻采样都不能跨越已知缺口，并将失败采样点扫描改为排序后单向扫描。

## 真实源数据

`real-source-audit.ts` 从本地已授权的 solar-dyn 接口获取 NASA 源数据，在 TDB 846690000 对五个代表航天器使用 24 点预算抽检。于项目根执行 `node docs/evidence/trail-sampling-0.0.49/real-source-audit.ts` 可重跑，输出 validation/results/trail-real-audit.json；本次结果另存 real-source-audit.json。

ISS 拖尾约 813 秒，Hubble 约 820 秒，Landsat-9 约 864 秒，TDRS-10 约 12730 秒，THEMIS-A 约 14325 秒。五项均为 24 点、无断点，四分点最大相对弦误差不超过 0.000339。采样与后续探针核验合计每项约 2—7.1 毫秒；这是单次 Node 抽检耗时，不是浏览器帧时，也未证明所有对象的长时性能。

## 实际 GPU

生产服务 127.0.0.1:3006 重启后，实际浏览器初始化地球场景，82/86 项当前可用；其余四项显示当前时刻无覆盖。地球近景退远、系统尺度退远、暂停、3 sec/s 播放及再次暂停均操作核验。earth-near-trails.png、earth-system-trails.png、earth-after-playback.png 记录可见渐隐曲线；没有通过关闭拖尾图层取得截图。线条仍有正常投影交叉，不能把真实前景轨迹穿过星球的屏幕投影区域一概认定为穿透。

浏览器 console error、Rust ERROR 查询均为空，退出显示工作区已释放。当前仍使用渐变线段，并未在本轮实现 NASA 的逐点可变线宽；四分点质量检查是有限探针，不是任意高频轨迹的严格全区间误差证明。
