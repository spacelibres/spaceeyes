# 银河与恒星七级LOD验证

版本：core0.0.30、SDK0.0.25、web0.0.36。分支codex/bevy-planning。冻结分支未修改。

## 集中检查

最终命令：`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，退出0。包含Rust测试/Clippy、94项平台与校验测试、8项真实WASM边界、2项真实DYN、42项网页库、17项工作区集成、72项本地渲染测试、Next生产构建及62份固定表面/环资源核验。完整日志在本地validation/results/deep-space-lod-checks.log。

实际NASA资源另运行`node web/scripts/prepare-galaxy-lod-audit.ts`通过，版本化结果在validation/galaxy-hdr-audit.json。七级684张瓦片哈希/边缘/极区、实际立方体384方向样本及粗糙度变化均核验。源RGB实际范围[0,1]，没有虚构>1源值；合成测试验证半浮点HDR>1与精确黑保留。

## 实际GPU

最终生产构建运行于127.0.0.1:3006。浏览器报告Intel Arc B390集成显卡、ANGLE D3D11、WebGL2。1920×1080视口观察太阳系总览、土星近景和地球近景；旋转、45→100度视场、800×600响应式视口、银河关闭/重新启用、退出/重入均实际操作。

总览诊断达到第7层、过渡100%、69张驻留瓦片、预算36.19MiB/64MiB、无资源错误；小视口100度达到第6层、61张瓦片、32.06MiB。关闭银河后预算0.00MiB，恒星仍启用。控制台error与Bevy ERROR两路均无错误。overview.png、saturn.png、earth.png为真实页面截图。

## 边界

显存数字是被准入的纹理载荷预算，不是驱动瞬时峰值。64MiB超限自动选择完整低级的路径由确定性测试覆盖，未声称测得驱动全部内存或跨设备固定帧率。低级资源结构均核验，实际浏览器主要验证第6/7层，未把资源生成当作每级GPU逐像素验收。银河为无限远方向场；太阳系内不伪造明显视差。星点源位置保留，迟到点层短渐入；完整三维银河和VR不属于本次验收。
