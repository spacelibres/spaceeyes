# 0.0.16 场景一致性验证

2026-10-30，核心 0.0.15 / SDK 0.0.14 / 网页 0.0.16，当前规划分支。

完整命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`。最终本地日志 `validation/results/orbit-fix-0.0.16-final.log` 以 Core checks passed 结束；120 项不同自动测试通过，包含 24 项 native 渲染相关测试（去除跨模式重复）。检查包含 Rust、Clippy、TS、真实 WASM、宿主集成、Next 构建和固定资源。

## 数值与数据

- `measurement.json`：同一真实水星时刻，旧 128 点折线与天体相距约 22451.318 km（约 9.2 个水星半径）；新采样明确包含当前时刻，顶点距离为 0。测试同时覆盖反向时间、精确顶点和不强制闭合。
- `units.json`：DYN 半长轴数值与 km 一致；地球约 0.9994 AU、海王星约 30.2772 AU。总览统一采用 149597870.7 km/AU，不按对象单独压缩。单位参考 [NASA/JPL Astrodynamic Parameters](https://ssd.jpl.nasa.gov/astro_par.html)。
- 月球轨迹从相对地球的 DYN 记录采样，并平移到地球当前世界位置；测试区分历史日心路径与地心相对路径。无数据不补造，覆盖端点不伪闭合。

## 最终浏览器 GPU

生产构建运行于 http://127.0.0.1:3006/，1280×720 实际画布，鼠标拖动/滚轮操作。

- `saturn-front-final.png`、`saturn-back-final.png`：拖动穿过环平面，两面同纹理和透明间隙均可见；近景没有轨迹遮挡。
- `earth-near-final.png`：单一天体近景轨迹隐藏。
- `earth-moon-final.png`：滚轮拉远后月球轨道围绕地球，蓝色地球日心轨迹通过地球当前位置。
- `zoom-overview-final.png`：继续滚轮直接解除局部焦点；宿主显示“已拉远至太阳系总览”和 AU，太阳位于画布中心，轨迹按天体配色。
- `overview-final.png` 是同批较早的 AU 总览；`mercury-near.png`、`mercury-orbit.png`、`sun-centered.png` 为中间验证，早于最终渐隐；`saturn-edge.png` 保留黑环问题的中间对照，`saturn-lit-edge-final.png` 早于最终 16—128 半径渐隐调整，不作为最终环验收。
- 最终上述浏览器操作后 error 级日志为空。

WASM 原始大小 29099442 字节，SHA256 `bf6b7bec03ccaedd5ec10758db57b244c63190b3d2ffba4fddf1369be41d6f51`。纹理、字体及受控环 shader 独立发布，按资源需求加载。

## 边界

环材质是 Bevy PBR 下的显示近似，尚无土星投向环的阴影及标定粒子散射。实际轨道允许椭圆和透视扁平；源覆盖不足仍保留断口。金星/火星异常继续明确报告。未增加其他行星卫星或航天器。本次不是 NASA Eyes 全部视觉、科学精度与性能验收；CI 以对应提交的 gh 查询为准。
