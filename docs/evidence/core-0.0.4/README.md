# Bevy 核心浏览器验证

日期：2026-10-28。环境：Windows，Codex 内置 Chromium 浏览器，Bevy 0.19.1，Rust 1.96.0，wasm-bindgen 0.2.129。后端日志记录 WebGL 2.0 / ANGLE / Intel Arc B390 集成 GPU。

使用 `core/tests/browser/index.html`，对象是位于 ICRF x=10¹² 千米、半径 1000 千米的合成球体。该页面是技术测试夹具，不是产品界面，也不是 NASA Eyes 效果或真实天体数据验收。

| 操作 | 实际观察 | 证据 |
| --- | --- | --- |
| 启动渲染并聚焦 | 画布出现受光球体 | 01-rendered.png |
| 在画布向下滚动 | 球体缩小 | 02-zoomed.png |
| 在画布拖动 | 球体受光方向随观察方向改变 | 03-orbited.png |
| 释放对象会话 | 球体从画布消失 | 04-released.png |
| 播放并持续提交同一时刻的合成样本 | 核心时钟前进，球体持续显示 | 05-playing.png |
| 暂停 | 核心时刻停在 13.309 秒，后续缩放/拖动时仍保持该时刻 | 06-paused.png、02-zoomed.png、03-orbited.png |
| 请求停止 | 页面接收停止请求，无捕获的 JS 错误 | 本项未量化 GPU 内存释放或单页重新初始化 |

原始后端日志见 browser-logs.json。Bevy 将警告也输出为 console.log：当前 WebGL2 后端不支持部分高级功能，包括 OIT、背景运动矢量、SSAO 和计算着色器大气等；部分处理回退 CPU。这些功能未通过验收，不能把当前球体渲染等同于 NASA Eyes 全部效果已实现。WebGPU 尚未验证。

重载已运行过的测试页时曾出现一次 WASM fetch 失败；随后服务完整下载检查为 HTTP 200、136747913 字节，独立页面完成上述最终版本流程且无捕获的 JS error。失败根因尚未确认，不能据此宣布重载稳定性或单页重建通过。

复现：先安装锁定依赖和工具，执行 `pwsh -File tools/check-core.ps1 -Renderer -Samples validation/.cache`，再运行 `node tools/serve-core-fixture.ts`，打开 http://127.0.0.1:4173/ 并依表操作。服务只监听回环地址，仅读取夹具与生成的 JS/WASM，不暴露整个仓库。
