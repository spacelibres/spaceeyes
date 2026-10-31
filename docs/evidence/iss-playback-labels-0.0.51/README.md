# 0.0.51 ISS 播放与标签核验

2026-10-31，核心 0.0.43、SDK 0.0.35、网页 0.0.51。原始复现：sc_iss，TDB 846686627.4034829、rate=480、play=1、Nearby、自然光、FOV=45，全部对象与轨道图层开启。

## 最终集中检查

最终源代码执行 `pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`，退出 0。日志 validation/results/iss-playback-labels-0.0.51-final-checks.log。

142 平台/验证、16 真实 WASM、2 DYN 样本、50 网页库、50 宿主集成、96 原生渲染测试通过；Rust 基础、Clippy、TS、发布 WASM、生产构建及离线资产检查通过。原标签移位测试按用户最新要求替换为固定锚点遮挡测试，不以测试条数代表功能数量。

回归包括：单帧过期轨迹维护从可重现的 9 条批量改为最多 1 条；ISS 480 倍连续推进且选中轨迹最多 256 点；无关对象过期和请求失败不暂停时间；失败请求冷却；选中与跟随参考跨段优先恢复；后台对象恢复模型、标签和轨迹；位置求值只在单次精确时刻发布中复用；类别/距离/名称优先级、固定锚点、视口拒绝与像素滞回。独立只读审查发现的跟随参考优先级问题已修复并复审。

## 实际浏览器与真实边界

生产服务重启后使用原始用户链接。初始 ISS 源覆盖为 846645705.8661791—846701435.627555；界面随后显示新覆盖 846701435.627555—846757171.9420085，仍为 ready、Nearby、480 倍播放，10 个对日关节保持启用。原始链接到新覆盖证明已跨过真正的数据段边界，不只使用无限覆盖测试夹具。

final-clock-observations.json 记录两次 UI 读取：墙钟相隔 76.553 秒，科学时间推进 36754.080 秒，观测均值约 480.113 倍。UI 读取有帧采样误差，浏览器处于后台验证环境；这证明该观察窗内时间推进，没有证明固定 FPS 或所有设备的 GPU 帧时。baseline-observations.json 保留旧版 UI 基线，其中出现全场景加载等待；两种观察长度不同，不据此推导通用加速比例。

iss-nearby-running.png 与 iss-after-boundary.png 记录 ISS 运行和跨段后的模型。退出前 console error、Rust ERROR 查询均为空，退出显示工作区已释放。

## 标签画面

地球 System 仍保持 82/86 对象当前可用，天然卫星、航天器、对象标签、轨道和拖尾图层全部开启。earth-system-labels-a.png、earth-system-labels-b.png 不再把不可辨识的航天器名称搬到满屏；可见月球的名称固定附着其位置。月球锚点区域 (495,235)—(580,275) 两次截图像素差为零。overview-labels.png 显示太阳系稠密区域按优先级隐藏重叠名称，没有把名称移去其他位置。

航天器可辨识阈值采用平台明确的 1.2/0.8 像素滞回，不声称该数字来自 NASA；对象、标记、标签与点击区域共用判断。NASA 对照依据是本地 LabelManager-563.js / LabelQuadtree.js 的固定对象锚点及类别、距离和名称遮挡优先级。

## 有界 CPU 抽检

solar-publication-benchmark.json 为真实 DYN 的七次请求录制后重放，8 个对象全部 ready，预热 20 帧后比较七组各 100 次发布，每帧精确推进 8 科学秒（480×、60 次调用/秒的输入节奏）。仅 TS 发布路径的中位耗时从 15.565 降至 13.642 毫秒/100 次，约减少 12.4%。这不含真实 GPU、SDK/WASM 全链路或 86 个对象的完整场景，不能外推为帧率提升。
