# 背景星空接入验收

2026-10-30。核心 0.0.16、SDK 0.0.18、网页 0.0.20。按用户确认的《NASA-Eyes背景星空接入设计》完成七层点表接入。

## 数据与边界

42667 个恒星点、1211 个星系点，合计 43878 点、1009222 原始字节。七个文件均实际下载、严格解析并核对固定 SHA256；布局、字段样本、范围及原始 hex 见 `../eyes-stars-analysis/source-audit.json`，版本化入口见 validation/eyes-stars.json。

`data-wasm-audit.json` 记录七份真实数据经 TS 插件 SDK 提交至真实 Rust WASM 后的 43878 点，以及停用后的 0 点。星表数据和星点 WGSL 独立由服务器获取，未嵌入 WASM；本批没有更换 Bevy 或引入另一个三维引擎。

解析明确小端、23 字节记录、RGB 最大通道归一化、Pioneer wxyz 四元数及赤道 J2000/显示基变换。43335 条距离模数交叉检查相符，543 条保留源距离/星等不一致；不擅改源数据，不将此点表宣称为带星名、自行或独立精度认证的科学目录。

## 集中验证

完整运行 `pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`。日志见 checks.log，覆盖 Rust、TS、真实 WASM、Next 生产构建、现有模型/表面及原生相机回归。

178 项不同自动测试通过：Rust 44（基础29、原生27扣除共享12）+ TS平台/验证80 + WASM6 +真实样本2 +网页34 +工作区集成12；重复运行不重复计数。

新增测试覆盖解码错误、坐标/颜色、SDK 参数和预算、会话权限/原子替换/停用、数据加载两并发及缓存、关闭迟到结果、哈希失败重试、服务器共享订阅取消/并发/缓存及立即重试。原生 Bevy 测试确认十点仅生成一个层实体、一个 Mesh/Material，退出后资产清除；不是一星一个实体。

真实七文件复核命令：

```powershell
node tools/audit-eyes-stars.ts --samples .cache/eyes-stars-analysis --output validation/results/eyes-stars-audit.json
```

样本目录须放入用户指定七个原始文件；普通单元测试不依赖本地忽略缓存或远程下载，CI 可从干净检出运行。

## 真实 GPU

在 Windows 真实浏览器运行 Next 生产服务 http://127.0.0.1:3006/。已实际操作并检查：

- `seven-layers-gpu.png`：七层、43878 点计数；数据已完整提交，不只显示最亮一层。
- `disabled-gpu.png`：关闭后背景星点移除；重新开启恢复七层，复用已验证缓存。
- `earth-occlusion-gpu.png`：地球近景正确遮挡背景星点，保留真实颜色和亮暗层次。
- `saturn-rings-gpu.png`：最终构建中土星、环和背景同时显示；星空在透明物体前先绘制，避免星点绕过环透明度直接叠加。最终浏览器 error 日志为空，见 browser-errors.json。
- 环绕和缩放过程中背景随相机投影，极近距离行星填满视口时背景被遮住；`orbit-zoom-gpu.png` 记录该遮挡状态。
- `reentry-gpu.png`：退出释放渲染器，再进入后恢复七层/43878 点；没有按重入次数累加点数。

实际 GPU 发现并修复了 Bevy 加法混合采用预乘管线而参考实现采用 SrcAlpha 导致的方形星点问题。最终输出按径向 PSF 预乘 RGB、零 alpha 保留目标颜色。着色器还处理零相对方向、远距平方和光通量溢出；测试通过不代替实际 GPU 检查。

失败/重试及快速取消由确定性测试覆盖；未伪称已经在浏览器人为断网或逐点手工认证。星空数据 ready、核心点数、实际 GPU 画面分别验收。

## 限制与后续

本批仅七份原始背景点表，不含星座连线、星名、银河体积、科学自行传播或星际导航。星系按源点式显示，不冒充星系照片。场景原有品牌保持原 SVG；NASA 数据与第三方依赖保留来源，不因本项目 MIT 改变资源版权或代表 NASA 背书。

发布 WASM 原始大小 29232964 字节，相比上版增加 133522 字节核心代码；源点表独立 1009222 字节。逐一检查七个原始文件和完整 WGSL 均未嵌入 WASM，见 runtime-resources.json。其 gzip9 大小是本地测量，不冒充浏览器实际传输统计。

上版提交 6a50d5d2d 的 GitHub Actions 41038352313 已由 gh 确认 success。本版提交后按完整 SHA 查询 CI，未完成的远端任务不报告通过。
