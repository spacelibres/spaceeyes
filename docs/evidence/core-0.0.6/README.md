# 0.0.6 集中验证

2026-10-29，Windows / Rust 1.96 / Bevy 0.19.1 / wasm-bindgen 0.2.129，Next.js 16.4.3，Node 24.15。当前规划分支，不依赖冻结分支。

最终命令完整退出 0：

```powershell
pwsh -File tools/check-core.ps1 -Renderer -Workspace -NativeCamera -Samples validation/.cache -JunoAssets
```

本地日志 validation/results/core-0.0.6-final.log（忽略目录）；16 项 Rust（14 基础/运行时及 2 原生相机）、39 项 TS、4 项真实 WASM、2 项真实 DYN 样本、10 项网页测试，共 71 项不同测试。WASM 测试分别在基础和渲染导出上运行，未将重复执行另算。另通过格式、strict 类型、Clippy、两类 WASM 构建/绑定、生产 Next 构建、7 项原样本及 11 文件资源包复核。NativeCamera 是无 GPU 的相机逻辑测试，不是离屏渲染。

core/pkg-web 与 web/public/wasm 的最终 WASM SHA-256 均为 ad1db6ac6bf61322fa6b497ba149ad70ea52ca1a041ce055756d72c0d4c118fb。网页依赖和二进制缓存不提交。

## 浏览器实际结果

- 01-reverse-boundary.png：同一最终核心二进制下，播放、暂停、跳至 100 秒、-10 倍反向播放，到 0 秒自动暂停并保留 ready 模型。此图先于最后的 fetch 上下文修复，仅证明核心/时间流程。
- 02-live-ori.png / 03-live-orb.png：最终页面真实按需调用固定 NASA 来源，校验散列/长度并解析 ori 3 条、orb 429 条，原始 ET 覆盖 -3155716758.816 至 3155716869.184；未发布到 Rust 科学状态。服务器不设置本机代理的启动方式已实际成功，两请求均 200。
- 04-workspace-model.png：最终页面启动、模型 ready、环绕观察；播放到约 32 秒再暂停，资源保持 ready，未复现旧版浮点导致的重新加载。
- 05-narrow-workspace.png：窄屏布局复核，工具设置 390px、DOM 实测有效宽度 375px，scrollWidth 与 clientWidth 均为 375，无横向溢出；模型、控制和 DYN 结果可读。检查后恢复默认尺寸。
- 06-released.png：最终停止并释放，交互停用，画布隐藏，不把旧 GPU 帧当作运行对象。没有测量显存完全即时回收。
- console.json：上述最终页面的 error/warn 捕获为空。它不是完整网络抓包。

测试中额外发现并修复浏览器 fetch 接收者错误，默认 fetch 绑定 globalThis，并有回归测试；独立审查发现的服务器无限等待风险由 15 秒总 deadline 和注入取消测试覆盖。

## 验收边界

网页里的模型使用合成位置与时间，不是 Juno 任务仿真。真实 DYN 目前贯通获取、结构解析和反馈；严格时间映射、生产求值、姿态、轨迹、多天体及完整 NASA Eyes 配对效果仍未验收。原始 DYN 轨道端点与 Horizons 有方向/尺度对照，但段中差异也已记录；参见 DYN科学语义核对与真实地球场景实施设计，不能用端点结果替代全覆盖精度验收。
