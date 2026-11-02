# 太空之眼网页工作区

0.0.7 的 Next.js 主入口承载太阳系完整用户流程：总览、目录搜索和关联对象选择、聚焦/跟随与视角切换、统一时间暂停/正负倍速/跳时/返回当前时间、科学来源与覆盖信息、轨迹与标签图层、退出和重新进入。宿主持有 WasmCore，经 PluginHost 批准的 SDK 发出意图；Rust/Bevy 保持场景权威，不用 TS 渲染器替代。

真实 DYN 数据源插件负责获取、解码和求值位置/姿态并经 SDK 发布。目录、对象来源、覆盖和加载失败在界面反馈。近似星历科学精度尚未验收；Mars/Venus 当前源时间逆序明确 unsupported。旧 Juno 合成验证与独立 DYN 格式诊断位于 `/diagnostics`，不冒充任务轨道。

## 启动

从仓库根目录执行：

```powershell
pwsh -File tools/prepare-juno.ps1
pwsh -File tools/prepare-solar-assets.ps1
pwsh -File tools/check-core.ps1 -Renderer -Workspace -NativeCamera -JunoAssets -SolarAssets
npm --prefix web run dev -- --hostname 127.0.0.1
```

先安装根 README 列出的锁定工具和 npm 依赖。准备脚本下载十个天体共六十个真实面纹理与两张土星环纹理到 `validation/.cache/solar-assets`，元数据见 `validation/solar-assets.json`。动态资源服务优先读取并验证缓存；缺缓存时按固定 NASA 地址获取，验证长度与 SHA256。资源只使用这条服务路径，无需 public 导出。生成资源和 node_modules 不提交。

打开首页即自动启动三维工作区，无需点击进入；退出和路由卸载撤销数据请求、插件会话与渲染资源。重新进入创建新会话，旧请求不得恢复已释放对象。资源 ready 仅表示加载状态，不能代替 GPU 效果验收。

DYN 服务端采用固定白名单、拒绝重定向、16 MiB 大小限制与格式/覆盖校验；每次获取有 20 秒超时，最多递归 8 层并传递请求取消，客户端单次读取有 25 秒超时。动态 DYN 的响应散列用于来源记录；固定表面资源才按已提交散列校验身份。格式变化或上游失败明确反馈，不以伪造状态继续显示。

`test`、`typecheck`、`build` 分别检查逻辑、类型与生产构建。核心集中脚本还检查 Rust、WASM 与资源完整性。浏览器基础流程和响应式证据见 docs/evidence；完整 NASA Eyes 效果、科学精度和性能仍待验收，不将编译通过或资源可加载视为这些验收已经通过。

## 资源加载边界（0.0.9）

打开首页自动进入总览，加载总览位置和轨迹所必需的 DYN。总览只用运行时基础几何表示，不提前下载所有星球表面；选择地球才请求地球六面，选择土星才请求土星六面和上下环。未选择的天体不请求高清纹理，已访问的表示复用；退出销毁会话，缓存由 Bevy/浏览器各自生命周期管理，不声称退出立即清除浏览器 HTTP 缓存。

字体源文件独立位于 web/resources/fonts/FiraMono-subset.ttf，准备脚本复制到 public/assets/fonts/FiraMono-subset.ttf，首次显示标签才请求。prepare-runtime 检查字体不内嵌 WASM，固定长度和 SHA256 见 docs/资源外置与按需加载.md。模型和科学数据同样从服务器按已触发的功能需求加载，新增功能禁止整目录预取。

## WASM 发布构建（0.0.10）

开发快速检查可沿用默认 debug。发布验证使用：

```powershell
pwsh -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets
```

发布配置位于 core/Cargo.toml 的 wasm-release，继承 release，使用 opt-level=z、fat LTO、codegen-units=1、strip=symbols、panic=abort。首次需重新编译依赖；不需要重复安装引擎或添加新工具。生成器从 wasm-release 目录导出，网页准备阶段继续核验外置字体，不再把 debug 目录当作唯一产物来源。CI 同样使用 -ReleaseWasm。

优化编译不能替代实际浏览器 WebGL2 回归，也不等于资源已内嵌；资源仍由服务器按需求提供。
