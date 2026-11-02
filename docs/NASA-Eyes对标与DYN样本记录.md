# NASA Eyes 对标与 DYN 样本记录

采集日期：2026-10-28。属于第一版计划 A 的证据记录，不是第一版实现或完整数据格式验收。

## 采集方式与证据边界

官方入口 https://eyes.nasa.gov/apps/solar-system/ 返回 HTTP 200，HTML 标题为 Eyes on the Solar System - NASA/JPL。已在现有应用内浏览器 #/home 采集首页截图、时间栏折叠截图及 DOM 控件记录。工具连接间歇超时；此前“未取得截图”的状态已由本次采集更新。此次仅完成首页和时间栏折叠的局部实测，没有完成目标聚焦或完整时间操作验收。

下列 HTTP 资源通过正常公开请求检查，没有执行下载的 JS，没有从旧实现推定格式。原始第三方样本只保存在本机临时目录，不纳入仓库分发。

本机样本目录：`%TEMP%/spaceeyes-nasa-eyes-samples-20261028`。该目录可能被系统清理，复验时从下列端点重新获取；若散列变化，应记录新样本而非默认为相同数据。

## 官方页面与加载入口

- 页面：https://eyes.nasa.gov/apps/solar-system/
- 配置：https://eyes.nasa.gov/apps/solar-system/config.js
- 应用：https://eyes.nasa.gov/apps/solar-system/app.js
- 官方介绍：https://science.nasa.gov/eyes/

页面列出 config.js、commons.js、preload.js、vendors.js 和 app.js。此次 config.js 明确设置静态资源根 https://eyes.nasa.gov/assets/static 与动态资源根 https://eyes.nasa.gov/assets/dynamic 。

公开 app.js 中可观察到 DynamoController、baseUrl/def.dyn 加载逻辑、分段名称追加 .dyn 的逻辑，以及 earth/sun/orb、earth/ori、jupiter/sun/orb 等控制器路径。它包含版本 1/2 检查及 pos、lin、ori、quat、orb 类型分支。这是该次发布资源的观察，不是官方稳定 API 承诺，不代表我们已实现或验证所有类型。

## 实际获取的样本

公共前缀：https://eyes.nasa.gov/assets/dynamic/dynamo/

| 相对路径 | HTTP | 字节数 | 前缀观察 | SHA-256 |
|---|---|---|---|---|
| earth/sun/orb/def.dyn | 200 | 30916 | 02 00 6F 72 62 00 | 5C31B43BCD091F63C314DA053595F67EA4277F9A71584E2A901983CF8041A580 |
| earth/ori/def.dyn | 200 | 204 | 02 00 6F 72 69 00 | BB6B0384B9B0C17F2ED49B1B458758DBD731E1B3E27477AFDC6A11FE9D0BD877 |
| jupiter/sun/orb/def.dyn | 200 | 2548 | 02 00 6F 72 62 00 | 9E69166CF390E6713D6B345A9941D0F7EFB7C2A42517B826005EE71574D38F43 |

前缀与版本 2、orb/ori 类型一致，但这里只检查原始字节，没有完成头部、时间范围、单位、参考系、分段索引或插值求值验证。

请求附带 Origin: http://localhost:3000，三个响应均观察到：
- Content-Type: application/octet-stream。
- Access-Control-Allow-Origin: *。
- Cache-Control: must-revalidate, max-age=3600。

缓存头不证明数据每小时更新。允许跨域的响应头也不替代真实浏览器请求测试，不构成资源再分发许可。配置和路径可能变化，需要适配失败反馈。

## 代表性对标场景与操作脚本

以下是下一轮需要实际操作和记录的候选，不是已经观察到的 UI 行为，也不预设对象的全部数据可用。

| 候选场景 | 固定条件 | 需要记录的操作与证据 |
|---|---|---|
| 地球近景 | 对象地球；记录实际页面时间、时区、视角与画面尺寸 | 选择/聚焦、拖动、缩放、光照与标签；截图及操作录像 |
| 地球与关联对象 | 先核对对象列表与数据可用性；固定同一时间 | 目标切换、跟随、近远尺度过渡与轨迹连续性 |
| 木星系统 | 固定木星及实际可用关联对象、同一时间 | 行星与关联对象切换、远近视角、标签和轨迹 |
| 时间控制 | 对象不变，记录开始与结束时间 | 暂停、继续、倍速、跳转、返回当前时间；记录真实控件名称和行为 |

对标时按同对象、同时间、可比视角比较，单次截图不能证明动画过渡或数值精度。具体基线时间在取得 UI 证据时记录，不用机器当前时间代替应用显示时间。

## 下一步与阶段结论

已证明：官方应用公开加载配置可访问；三个实际 DYN 样本可获取；该次 HTTP 响应的跨域与缓存声明已记录。

未完成：真实交互/截图、数据覆盖与完整语义、分段请求、科学结果参考对照、资源使用条件。阶段 A 尚未整体完成；阶段 B 尚未验收，不能据此直接宣称具备完整 DYN 支持。

下一步先恢复 UI 采集，同时核对样本头部和完整求值语义。NASA 数据展示仍与后续 Nyx 服务器任务独立。

## 首批实际画面与控件采集

证据目录：[2026-10-28 采集](evidence/nasa-eyes-2026-10-28/01-home.jpg)。保持原始 NASA 页面画面，作为对标证据，不当作平台品牌资产。

| 证据 | 实际观察 | 边界 |
|---|---|---|
| [01-home.jpg](evidence/nasa-eyes-2026-10-28/01-home.jpg) | 1051×854；太阳系总览、星空、细线彩色轨道与天体/航天器标签；左侧故事卡；右侧工具列；底部 LIVE、日期、real rate 和时间滑块 | 页面时间为 Oct 28, 2026、约 01:23 PM，时区未确认；不是固定历元的科学对照 |
| [02-time-panel.jpg](evidence/nasa-eyes-2026-10-28/02-time-panel.jpg) | 点击时间控件后，日期、速率与滑块隐藏，剩 TIME CONTROLS 入口及 LIVE | 实际是折叠态；文件名不代表完整展开面板 |
| [02-time-controls.txt](evidence/nasa-eyes-2026-10-28/02-time-controls.txt) | 折叠后的 DOM：Expand time controls 按钮与 live 状态仍在 | DOM 证据不能单独证明三维画面和动画质量 |

首页 DOM 观察到：Share、Menu、show info panel、toggle layers、zoom in、zoom out、toggle light modes、toggle fullscreen、show or hide settings。展开态还观察到 Drag time slider thumb（值 50）、real rate 与 Input custom time。只确认存在，尚未逐个执行这些按钮。

任务故事实际可见 Roman Space Telescope Launch、Psyche Mars Gravity Assist、Artemis II Launch 和 Voyager's Grand Tour；文案按采集时页面记录，不作为任务实际发射时间的独立事实依据。

已操作并观察到结果：时间控件从日期/速率/滑块可见态切换到折叠入口。再次展开的操作因工具超时没有完成结果核验，不标为通过。对象选择、聚焦、跟随、缩放、光照模式、暂停/倍速/时间跳转仍待后续实测。

设计提炼：场景占据主体，外围工具悬浮；轨道线与标签按对象区分；故事与时间控制分开。以上仅是本次画面的布局观察，不据此确定全部组件细节或交互参数。
## 多星球切换采集

日期：2026-10-28。使用同一官方页面，按实际可见对象/菜单操作，未修改应用代码。时间保持 LIVE，未固定历元；这些图片用于体验和外观研究，不是同一时刻的数值对照，也不是最终默认图层配置。

| 对象 | 证据 | 实际观察 |
|---|---|---|
| 火星 | [03-mars.jpg](evidence/nasa-eyes-2026-10-28/03-mars.jpg) | 选择后转入火星近景，面包屑变为 Mars，左侧 Info/Toolbox/View Options；可见地表纹理、昼夜明暗与着陆点/探测器标签 |
| 木星 | [04-jupiter.jpg](evidence/nasa-eyes-2026-10-28/04-jupiter.jpg)、[DOM](evidence/nasa-eyes-2026-10-28/04-jupiter.txt) | 面包屑与信息面板确认 Jupiter；近景有云带纹理；DOM 出现 Io、Europa、Ganymede、Callisto、Juno 等对象，不表示它们全部在截图内可见 |
| 土星 | [05-saturn.jpg](evidence/nasa-eyes-2026-10-28/05-saturn.jpg) | 面包屑与信息面板确认 Saturn；可见环结构、环的暗带/阴影及周围轨道线；画面尺度与火星、木星不同 |
| 地球 | [06-earth.jpg](evidence/nasa-eyes-2026-10-28/06-earth.jpg)、[DOM](evidence/nasa-eyes-2026-10-28/06-earth.txt) | 通过 Menu 中 Earth 入口切换，面包屑与信息面板确认；该次状态下轨道与星座线密集，地球在画面中较小，不视为理想默认近景 |
| 地球视角选项 | [07-earth-view-options.jpg](evidence/nasa-eyes-2026-10-28/07-earth-view-options.jpg)、[DOM](evidence/nasa-eyes-2026-10-28/07-earth-view-options.txt) | 打开 View Options，观察到 Nearby/System/Follow 相机选项、Default Map/昨日全球影像入口、Earth Orbiters/Major Moon 图层、High Definition 开关；尚未逐项切换验证 |

切换注意：初次点击三维 Saturn 标签后实际进入 Voyager 1。已通过面包屑识别偏差，再通过该面板 Related 中 Saturn 入口成功切换。中间状态保留为 [05-intermediate-voyager1.txt](evidence/nasa-eyes-2026-10-28/05-intermediate-voyager1.txt)，不能当作土星证据。后续选择优先使用 Menu 的明确对象入口，避免被重叠标签误导。

本轮完成四个行星状态采集与 View Options 入口采集；只观察到切换前后状态，没有录制过渡动画，不宣称已测量相机插值、跟随算法或转场时长。地球密集图层状态需要继续区分具体开关后再制定默认配置。

## 用户提供的恢复源码参考

参考目录：https://github.com/spacelibres/solarsystem/tree/main/eyes

此次固定 main 提交为 `4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db`。已读取 eyes/README.md、第三方许可通知和目录清单；未运行其构建/脚本，未复制恢复代码到太空之眼。

README 说明这是恢复后的可编辑项目，不是 NASA 未公开原始仓库；provenance.json 记录 1087 个原模块到源文件、源区间及 bundle 散列的映射。README 声明模型、纹理、Dynamo 数据等仍通过 NASA 原地址加载，不能把该目录理解为完整媒体资源镜像。

下一步优先研究的已确认路径：
- `eyes/src/engine/controllers/DynamoController.js`：DYN 加载、解码与求值。
- `eyes/src/engine/core/Reader.js`：二进制读取约定。
- `eyes/src/engine/core/Cameras.js`、`CameraScripts.js`：相机基础与操作。
- `eyes/src/engine/managers/CameraFollowManager.js`、`CameraManager.js`：跟随与相机管理。
- `eyes/src/ui/components/CameraViewBlock.js`、`eyes/src/ui/templates/CameraViewBlockTemplate.html`：视角选项和 UI 对照。
- `eyes/decoders/manifest.json`：Draco/Basis 解码器来源清单，不等同于 DYN 格式规范。
- `docs/eyes-analysis/README.md`：恢复源码分析索引。

许可 API 返回仓库整体 license 为 null；已读取的第三方通知列出部分 MIT 组件，不能据此推断所有恢复代码和 NASA 资产都可按 MIT 分发。这里先作为研究来源，具体复用逐文件核对，既不据此改变 Bevy 选型，也不继承该仓库架构。


## 源码分析更新

已完成第一轮[多方面源码分析](SolarSystem参考仓库多方面分析.md)。进一步检查当前构建发现 NASA URL 会改写至同源 /nasa/ 路由，由服务器缓存与可选补齐机制处理；前文关于直接加载的说法是 README 的描述，不能作为当前部署路径的完整结论。package.json 明确声明 MIT，但仍须区分恢复内容与第三方资源的来源。
