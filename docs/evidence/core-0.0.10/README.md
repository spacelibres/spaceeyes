# 0.0.10 发布构建验证

2026-10-30。完整命令：pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets，退出 0，日志 validation/results/core-0.0.10-release.log。97 项不同自动测试通过，另有格式、类型、Clippy、WASM/Next 构建、样本契约、模型和表面资源检查。

发布 WASM 28891934 字节，SHA256 见 build.json，较此前 debug 164197457 字节减少约 82.4%。gzip 6971313 字节为本地压缩测量，未部署传输压缩，不以此宣称实际下载量。未使用额外 wasm-opt。

真实浏览器加载新发布 WASM，自动进入总览，选择地球后纹理和外置标签可见，状态 ready；截图 release-earth.png。性能、冷启动时间和完整 NASA 效果不因体积减少而自动通过。
