# 受控模型与贴图验证

## 2026-10-29 最终复验（替代下文此前的阻塞状态）

`tools/check-core.ps1 -Renderer -Samples validation/.cache -JunoAssets` 已完整退出 0，本地日志为 validation/results/core-0.0.5-final.log，包含格式、13 项 Rust、25 项 TS、3 项真实 WASM 集成、类型、Clippy、两类 WASM 构建/绑定及资源包复核。未借用冻结分支脚本。

最终构建浏览器截图 07-final-model.png 显示 Juno 模型 ready；08-final-texture.png 显示 JPEG 球体贴图 ready；09-final-released.png 显示独立延迟加载在 loading 时释放后，资源返回仍为空画布。final-console.json 是该正常流程捕获的错误/警告列表，结果为空。关闭 `.meta` 探测后该流程未捕获此前的 404。此列表不是网络请求完整抓包。

缺失模型和缺失场景是明确标识的预期错误测试。本轮未重新执行缺失场景、科学状态失效后恢复、模型内相机/灯光样本及全部材质扩展测试；没有离屏 GPU 自动测试。模型默认取景仍未使用模型包围范围，下一里程碑按规划书补齐取景，不能声称相机基线完成。下文早期截图和中断记录保留为历史，最终结果以本节为准。

环境：2026-10-28，Windows 内置 Chromium 浏览器，Bevy 0.19.1，Rust 1.96.0，wasm-bindgen 0.2.129，WebGL2 后端。

本轮验证的是平台通用资产入口，而不是新增 Juno 专用核心。核心代码不包含 Juno 路径；宿主夹具登记资源目录，插件接口只引用标识。模型来自 NASA Eyes 的 Juno 资源包，位置为合成值，尚未接入轨道、姿态或 NASA 原始交互。球体使用太阳能板图片只是测试图像和材质管线，不代表任何真实天体。

## 复现

```powershell
npm ci --prefix platform --ignore-scripts
pwsh -File tools/prepare-juno.ps1
pwsh -File tools/check-core.ps1 -Renderer -Samples validation/.cache -JunoAssets
node tools/serve-core-fixture.ts
```

打开 http://127.0.0.1:4173/，启动后依次测试模型、球体贴图、缺失模型、缺失场景、清除、延迟替换及延迟释放。资源清单 `validation/juno-assets.json` 固定 11 个文件的来源、长度和散列；缓存数据不提交。延迟路径是同一资源包的受控测试副本，每次请求延迟 2 秒，不属于生产服务策略。

## 证据

以下截图来自本轮早期浏览器实测。此后增加了禁止导入 glTF 相机和灯光的加载配置，并通过了编译及静态检查；最终浏览器复验因自动化连接连续超时未完成。因此这些截图不能作为最终代码完整 GPU 验收通过的依据。缺失场景及独立延迟释放入口也尚未完成浏览器复验。当前没有离屏 GPU 自动测试，不将此项记为通过。

最终补跑再次通过 13 项 Rust 测试、25 项 TS 测试、3 项基础真实 WASM 集成，以及渲染版 WASM 构建和 Clippy；渲染版绑定生成耗时过长后人工中止，此次补跑不计作集中检查完整通过。此前完整检查日志保留在本地 validation/results/core-0.0.5.log。用户最新指定的 tools/check.sh 在当前分支不存在，系统 bash 入口还因 WSL 缺少 /bin/bash 失败，不能将现有 PowerShell 检查等同于该 GPU 门槛。

| 检查 | 证据 | 结果 |
| --- | --- | --- |
| 真实 glTF 模型与贴图就绪 | 01-juno-model.png | 出现三片太阳能板与天线，状态 ready |
| 球体基色贴图 | 02-textured-sphere.png | 图片显示，状态 ready |
| 缺失模型 | 03-missing-failed.png | failed 并显示路径错误，画布不显示替代球体 |
| 清除资源表示 | 04-cleared-default.png | 恢复明确的默认验证几何体，状态 default |
| 加载中释放 | 05-delayed-loading.png、06-late-result-cleared.png | loading 时释放会话，延迟返回后画布仍为空 |

资源 ready 不等于所有材质细节或科学语义正确。每贴图 UV 变换、完整 glTF 扩展、实际姿态、照明及 NASA 对标仍需逐项校准。GLB 入口已实现，本轮真实模型样本为 glTF。底层请求可能继续填充 Bevy 缓存，不据对象消失声称网络和 GPU 内存已全部即时回收。
