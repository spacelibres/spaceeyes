# 全局源码架构分析证据

2026-10-31，应用基线738a9c539（核心0.0.44、SDK0.0.35、网页0.0.52）。本次为分析和规则文档，无运行代码改动。

- source-inventory.json：本地恢复src全部1130个文件的路径、长度、行数、SHA256；233个引擎文件另记录相对导入和审查级别。索引不是逐行语义或运行验收。参考仓库HEAD4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db，实际字节以逐文件哈希为准。
- atlas-source-index.json：用户提供站点公开脚本的哈希及方法定位。只作静态分析，没有将其bundle、纹理或代码作为MIT项目资源提交。首次浏览器导航创建页面成功，但DOM/画面读取持续超时；未完成实际视觉对照，不用静态代码替代GPU验收。
- checks.log：本轮重新执行完整本地检查的输出，保存时仅去除行尾空格。命令如下，退出0。

`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`

142平台/验证、16真实WASM、2真实DYN样本、50网页库、50宿主集成、107原生渲染测试通过。Rust基础、Clippy、TS、发布WASM、生产构建及离线资源检查通过。此处没有新的太阳GPU效果通过声明。

应用基线的实际地月、木星、土星与悬停GPU证据保留于../nasa-framing-hover-0.0.52；其远端CI41177796388已由gh确认成功。文档提交自己的CI结果在提交后单独核对。

正式结论见../../NASA-Eyes源码全局架构分析与能力保持规则.md。按“证据E1/E2/E3→模块映射发现→分批实施路径”追踪，未识别模块和未逐项验收能力明确保留。
