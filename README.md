# 太空之眼 · SpaceEyes

以 Rust/Bevy → WASM 为三维显示核心、TypeScript/Next.js 为宿主的可扩展仿真平台。架构以 [太空之眼平台架构书](docs/太空之眼平台架构书.md) 为准，第一版按 [规划与验收](docs/第一版规划与验收.md) 对标 NASA Eyes。

0.0.7 主入口为太阳系工作区：目录搜索与关联对象选择、真实 DYN 位置和姿态求值、聚焦与跟随、观察视角、统一时间播放和图层控制在同一流程中接线。真实表面资源包含十个天体的六面纹理和土星环上下纹理。Juno 合成技术夹具与格式诊断集中于 `/diagnostics`。Nyx、STK、完整市场及大模型自动化属于后续范围。

实现不等于验收：近似星历的科学精度尚未验收；Mars/Venus 当前源样本时间逆序，明确报告 unsupported，不伪造可用轨道。本轮浏览器 GPU、效果和完整流程仍在集中验证，结果以实际验证记录为准。

## 运行与验证

需要 Node 24.15+、Rust 1.96、wasm32-unknown-unknown、wasm-bindgen-cli 0.2.129 和 PowerShell。依赖精确锁定于各清单。

```powershell
npm ci --prefix platform --ignore-scripts
npm ci --prefix web --ignore-scripts
pwsh -File tools/prepare-juno.ps1
pwsh -File tools/prepare-solar-assets.ps1
pwsh -File tools/check-core.ps1 -Renderer -Workspace -NativeCamera -JunoAssets -SolarAssets
npm --prefix web run dev -- --hostname 127.0.0.1
```

太阳系准备脚本获取固定 NASA 资源并记录独立面的来源、长度和 SHA256；缓存位于忽略提交的 `validation/.cache/solar-assets`。动态纹理服务先验证缓存；缓存缺失时仅获取 manifest 中的固定 NASA 来源并校验散列。不需要向 public 导出纹理。Juno 准备脚本支持 `-Offline` 复核固定资源。

`-NativeCamera` 检查相机逻辑，不是离屏 GPU 测试；`-Renderer` 检查编译和绑定，浏览器实际画面、播放和释放另行验证。工作区构建不在 CI 自动下载 NASA 原始载荷。`-Samples validation/.cache` 是已有科学结构样本的额外检查，缺样本应失败。

真实 DYN 与纹理服务均使用固定白名单，不是任意 URL 代理。上游不可达或散列改变会明确失败；代理只在启动环境配置，不把本机地址写入仓库。详见 [网页说明](web/README.md)、[核心说明](core/README.md)、[实施进度](docs/平台基础功能实施.md) 和 [CHANGELOG](CHANGELOG.md)。

原创代码采用 MIT；第三方代码、资源和数据保留各自权利。新增时间依赖 Hifitime 使用 MPL-2.0，单独保留许可证及对应源码获取说明，见 [第三方依赖说明](THIRD_PARTY_NOTICES.md)。冻结的 development/core-0.0.1 不参与当前实现。
