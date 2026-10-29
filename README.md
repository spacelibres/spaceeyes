# 太空之眼 · SpaceEyes

以 Rust/Bevy → WASM 为三维显示核心、TypeScript/Next.js 为宿主的可扩展仿真平台。架构以 [太空之眼平台架构书](docs/太空之眼平台架构书.md) 为准，第一版按 [规划与验收](docs/第一版规划与验收.md) 对标 NASA Eyes。

当前工作区仍是明确标识的技术验证：Juno 模型使用固定 NASA 资源包，位置与时间采样为合成数据；真实 DYN 可按需获取并检查结构，科学求值、参考系、多天体和完整视觉体验尚未验收。Nyx、STK、完整市场及大模型自动化属于后续范围。

## 运行与验证

需要 Node 24.15+、Rust 1.96、wasm32-unknown-unknown、wasm-bindgen-cli 0.2.129 和 PowerShell。依赖精确锁定于各清单。

```powershell
npm ci --prefix platform --ignore-scripts
npm ci --prefix web --ignore-scripts
pwsh -File tools/prepare-juno.ps1
pwsh -File tools/check-core.ps1 -Renderer -Workspace -NativeCamera -JunoAssets
npm --prefix web run dev -- --hostname 127.0.0.1
```

`prepare-juno` 首次下载固定资源；后续可用 `-Offline` 复核。`-Samples validation/.cache` 是已有科学结构样本的额外检查，缺样本时应失败而不是自动伪造。`-NativeCamera` 运行相机逻辑测试，不是离屏 GPU 测试；`-Renderer` 检查编译和绑定，浏览器实际画面、播放和释放必须另行验证。工作区构建不在 CI 自动下载 NASA 原始载荷。

真实 DYN 请求是服务器端的固定白名单入口，不是任意 URL 代理。上游不可达或内容散列改变会明确失败；本地网络需要代理时，在启动进程的环境中配置，不把本机代理写入仓库。详见 [网页说明](web/README.md)、[核心说明](core/README.md)、[实施进度](docs/平台基础功能实施.md) 和 [CHANGELOG](CHANGELOG.md)。

原创代码采用 MIT；第三方代码、资源和数据保留各自权利。冻结的 development/core-0.0.1 不参与当前实现。
