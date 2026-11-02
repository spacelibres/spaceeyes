# 0.0.7 整体工作区验证

日期：2026-10-29。分支：codex/bevy-planning。记录本批实际检查，不代表第一版 NASA Eyes 全部效果、性能或科学精度验收。

## 运行对象

Next.js 生产服务、真实 Rust/Bevy 0.19.1 WASM、TS PluginHost 和 SolarSystemData。浏览器使用本机内置 Chromium 的 WebGL2 路径，最终运行 WASM 身份见 browser-wasm-final.json（SHA256 0a043c61d8ed219deea454d695e480f9daace1321e2da91a446f728ae1fc4765）。01–10 为初次流程候选；11–14 对应 browser-wasm-surface-validation.json；15 为最终导出版本的实际运行截图。各阶段身份分别保留，不混称同一构建。

真实接口结果见 real-api.json：epoch=0 的七个非太阳可用对象返回 200；Mars/Venus 返回源时间逆序错误。太阳为日心坐标原点定义。真实表面资源为固定清单的 60 个立方体面及 2 张土星环径向纹理，不是演示占位球体。

## 已观察的完整操作

1. 进入后显示太阳系总览、真实轨迹及标签，状态为 8/10 数据可用、8 个显示资源就绪（01）。
2. 选择地球，显示实际表面、来源和覆盖；缩放后重新聚焦恢复取景（02）。
3. 通过关联入口选择月球，显示月面、父体关联和实际分段覆盖；预设视角及跟随复位生效（03）。
4. 切换土星，显示上下环纹理；俯视可见径向环带。关闭标签和轨迹后，两者从画面消失（04、05）。
5. 3,600 倍速播放推进统一核心时间，暂停后停止；跳转 TDB=0 显示 2000-01-01T11:58:55.816Z。输入 UTC 2026-10-29T00:00 后显示同一 UTC 和对应 TDB=846504069.182 秒。
6. 跳转 TDB=10000000000 无数据，保持 TDB=0 的旧场景并暂停，状态明确说明回滚（06）。
7. 退出后画布隐藏、控件停用，不再保留活动工作区（07）。这不证明 GPU 显存字节数即时回收。

截图为实际运行页面的完整截图，日期和视角可见；没有用合成数值冒充 NASA 数据。不是与 NASA 同时刻同视角的成对效果比较。

## 浏览器控制限制

本轮自动化的鼠标点击 CDP 确认出现超时，原生窗口截图也不可用；因此采用真实键盘 Enter/Space、日期输入及选择控件完成上述交互。滚轮缩放有实际画面变化。鼠标点击/拖动的完整自动验收不报告通过。浏览器日志捕获结果为 browser-logs.json，空列表不等于所有网络或驱动诊断均不存在。

曾并行进行大型 WASM 导出和浏览器启动，造成资源争用与长时间无响应；已停止导出并释放活动渲染页，后续重型导出与浏览器启动分开执行。当前是 176656654 字节的调试 WASM，首载及性能尚未达到产品验收结论。

## 集中检查

本轮 96 项不同自动测试通过：Rust 28、TS 平台/验证 44、网页逻辑 14、基础 WASM 4、整体工作区真实 WASM 4、真实 DYN 样本 2。重复执行不重复计数。另通过 fmt、严格类型检查、拒绝警告的 Clippy、WASM 编译/绑定、Next.js 生产构建、7 类真实样本契约、62 张固定表面/环资源和 11 个 Juno 文件检查。

- `validation/results/core-0.0.7-verified.log`：完整脚本含 `-Renderer -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，退出 0；包含全部 12 个原生渲染逻辑测试。
- `validation/results/core-0.0.7-final-pass.log`：最后 Rust 代码的 `-Renderer -Workspace -Samples validation/.cache -JunoAssets -SolarAssets`，退出 0；重新构建导出最终 Web WASM。
- `validation/results/web-final-complete.log`：最后 TS 事务回滚修改后的全部 62 个 JS/TS/WASM 流程测试、平台和网页类型检查、Next.js 生产构建，退出 0。

上述日志为本地生成验证输出，不提交原始缓存。真实 WASM 流程测试仅替换 GPU 启停，不能替代实际画面验证。浏览器已观察地球/月球/土星及环、时间、图层、失败返回总览、加载取消、退出重入；390 像素窄屏实际布局见 narrow-layout.json 和 13，页面未被目录撑宽。

仍未验收：完整 NASA Eyes 材质/太阳照明/交互一致性、所有对象和格式、地标与极向接缝逐项校准、全历元科学误差、性能及显存预算、WebGPU。Nyx/STK、完整市场和 AI 自动化仍为后续架构范围。
