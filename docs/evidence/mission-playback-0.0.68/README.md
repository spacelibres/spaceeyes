# 网页0.0.68 / SDK0.0.42 / 核心0.0.54

基线9b444aaff，其CI41256944751已核验success。用户确认外部构图：卫星留前景，巡天背景朝深空、观测主星者背景朝主星。

## 修改前失败与回归

rate-before.log：每帧连续改倍率时lastFrame反复undefined，elapsed持续0，时间不前进。mission-before.log：LRO选中后没有初始任务方向意图。moon-surface-before.log：未先选Moon而直接选择LRO时，Moon未发布六面表面贴图。

最终完整checks.log exit0：177平台验证、16基础WASM、2真实DYN、67网页、60宿主、128原生渲染，加Rust/TS/clippy/ReleaseWASM/Next/资源检查。Native App验证首次朝target、手动拖动不回弹、新焦点sky、front预设持续优先；SDK权限/原子/冻结/注销清理与pause/resume时间基线均有回归。独立复审未发现明确缺陷。

## 实际GPU与时间推进

最终生产服务3006已重启，TDB846724000作为测试起点。

- lro-host-view.png：LRO外部前景、Moon真实表面背景；初次直接选择也按需升级Moon资源。
- lro-rate8.png：连续提高倍率后8 sec/s仍在播放。
- chandra-sky-rate2.png：Chandra外部前景、深空背景，2 sec/s播放。当前Earth系统82/86可用，4个真实覆盖缺项未伪造。
- playback-dom-timing.json来自可见时间栏DOM与工具墙钟采样，未读应用隐藏状态。1×约48.439墙钟秒推进48.411模拟秒；3×约39.659秒推进118.908秒；8×约56.346秒推进450.832秒；2×约145.039秒推进290.025秒。2×验证期间明确把焦点留在时间控件，未再次停住。DOM约100ms刷新，微小比率偏差不当作数值精度认证。
- 最终warn/error为空，见browser-logs.json。测试结束已暂停场景。

配置改为UI控件焦点与canvas焦点同样30fps目标reactive等待，128 native检查其配置，不宣称所有设备实际达到30fps或完成GPU长期性能量化。持续倍率回归涵盖每帧1/2/3/5/10/20/60切换；未将低倍率远距离视觉运动微小误当冻结。

本轮是任务初始构图，不是机载传感器第一人称，不声明真实仪器光轴；机身DYN与太阳翼仍由独立数据控制。仅首次focus自由环绕应用，手动环绕/缩放与明确预设之后不强行锁回。Moon背景分辨率仍受当前已有外置资源约束，不把六面贴图发布说成全级地形LOD完成。
