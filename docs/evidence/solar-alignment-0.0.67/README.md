# 网页0.0.67 / SDK0.0.41 / 核心0.0.53

基线d3b782bb8。上一版CI41253176788已核验success。本批176平台验证、16基础WASM、2真实DYN、65网页、57宿主、124原生渲染及Rust/TS/clippy/ReleaseWASM/Next/资源检查通过，完整exit0见checks.log。独立审查预算问题经剩余记录配额修正后复审无新明确缺陷；快切、取消、历史缺口及ORI段到期回归均包含。

solar-before.log记录返回总览日心飞船未恢复的失败；ori-expiry-before.log记录有效ORI缓存过期却不请求新段的失败。太阳启动和自动拉远回归使用真实基础WASM。

## 真实NASA数据

real-dyn-final.json由最终服务3006实际调取、解码并求值，不以合成样本冒充：

- TDB846724000，LRO位置Ready，实际ORI root已覆盖外，按有效实体控制器得到derived姿态Ready，四元数有限。
- Psyche实际quat在该时刻有效，DYN姿态Ready，两个对日关节可计算。此前报unsupported type已修复。
- Psyche当前段过去14421620秒，经独立历史分段扩展到95022377.45863秒（约1100天），183点、零断点；真实跨父体历史统一当前Sun参考系。当前科学状态/时钟不被历史加载替换。
- 离线quat原始样本及SHA位于web/lib/fixtures/quat，来源元数据保留。Psyche冲突重复时刻仅精确SHA原始连续块可用，冲突点拒绝；解码器没有放宽单调或未知类型检查。

## 实际GPU

最终生产构建重新启动后验证，TDB846724000暂停。太阳总览从原基础十对象补齐到23/23（8/8行星资源Ready）。太阳总览、Psyche选择、LRO选择、返回总览、缩放实际完成。

solar-overview.png记录启动太阳总览；psyche-attitude-wings.png及psyche-dom.txt记录DYN姿态可用和已启用两个对日关节，真实面板/模型都已核验。lro-derived-attitude.png记录派生姿态Ready。返回及局部缩放另存截图，最终浏览器warn/error日志另存。

截图不冒充所有机位NASA像素认证，数值窗口由真实DYN JSON证明。只对当前选中航天器启用独立历史缓存，普通未选中轨迹仍按当前可用数据窗口。32段/200000 decoded缓存记录预算不等于整个进程峰值内存上限；读字节16MiB/请求、网络共享四槽。真实历史缺口/预算失败保持当前主段可用，不暂停主仿真。

故事/比较/视线工具、全部目录/所有设备及长期性能仍未全部验收；未把本批三个基础修复说成全平台NASA对齐完成。
