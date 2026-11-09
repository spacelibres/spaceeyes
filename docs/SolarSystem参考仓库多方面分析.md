# SolarSystem 参考仓库多方面分析

日期：2026-10-28。研究提交：`4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db`。

## 目的与证据范围

分析 https://github.com/spacelibres/solarsystem ，为太空之眼第一版 NASA Eyes 效果与交互对标提取机制、数据语义和验收要求，不继承该项目架构，不复制恢复代码到 Bevy。

本轮只读检查当前入口、配置、DYN、相机、时间、资源、部分渲染模块及代表性测试。没有声称通读全部文件；没有安装依赖、执行恢复/构建脚本或重跑测试，没有验证所有 GPU 和浏览器分支。

实际执行的证据检查：固定远端 SHA，建立仓库外临时只读参考检出；将三个官方 DYN 实测样本与仓库 tests/fixtures 做 SHA-256 比对，三者完全一致。浏览器多星球截图见 [采集记录](NASA-Eyes对标与DYN样本记录.md)。源码存在、测试存在、实测通过分别记录，不互相替代。

## 1. 先分清三类材料

| 材料 | 当前事实 | 用法 |
|---|---|---|
| 恢复的 Eyes 应用 | 首页重定向到 /eyes/index.html；恢复后的 Pioneer/Three.js 应用由现有构建编译 | 研究原应用机制与对照表现，不作为 Bevy 运行时 |
| 独立 /explorer | 单独的 Next 页面进入 src/solar 的运行时、领域和渲染实现 | 参考独立模块的输入输出与测试，不将其行为自动归为官方行为 |
| 较早 src/lib/dynamo 等实现 | 仍有旧解码器/加载器，被部分测试和模块引用；与现行 repository 的处理并不完全一致 | 每条结论追踪实际调用路径，不能按名字任选文件照搬 |

来源：[首页](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/src/app/page.tsx#L4)、[/explorer](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/src/app/explorer/page.tsx#L10)。docs 中的历史审计对应不同提交，不直接视为本快照现状。

## 2. DYN 格式、分段与求值

| 核对项 | 源码事实 | 太空之眼应学习的要求 |
|---|---|---|
| 记录类型 | orb/pos/lin/ori/quat，记录长度分别72/56/32/64/40字节；版本1/2有不同索引规则 | 解码与求值分开验收，不能凭能读取头部宣称完整支持 |
| 四元数 | 当前实际读取为 w,x,y,z；旧 parse.ts 头部注释却写 qx,qy,qz,qw | 以字节与实际实现为依据，记录磁盘顺序与平台顺序的转换 |
| v2 索引 | 恢复源码删除最后一个终止边界；现行 repository 也删除末项 | N个边界不等于N个可下载子文件，避免无效末段请求 |
| 嵌套分段 | 文件名有数字补零及父段名下划线组合；现行 repository 按真实窗口选择并检查深度 | 不能只支持平级数字文件，缓存键要与实际资源和窗口对应 |
| 采样选择 | 存在提示索引、二分查找以及对回退/等时刻的专门处理 | 不未经分析就排序或去重；共享边界、跳变与重复时间需要测试 |
| 求值 | pos采用含速度的插值；lin推导割线速度；ori与orb存在两端投影后混合的语义 | 分类型建立小样本，比较位置、速度、姿态及边界，不能统一成线性插值 |
| 暂缺数据 | 恢复应用在特定缺块路径继续使用上次采样 | 显示连续性不等于有效科学状态，平台须明确缺数据和有效范围 |

证据：
- [恢复 DYN 记录与求值](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/controllers/DynamoController.js#L29)；[v2末项处理](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/controllers/DynamoController.js#L322)。
- [旧注释](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/src/lib/dynamo/parse.ts#L21)与[实际四元数读取](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/src/lib/dynamo/parse.ts#L215)。
- [旧索引返回逻辑](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/src/lib/dynamo/parse.ts#L161)与[现行 repository 索引处理](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/src/solar/runtime/ephemeris-repository.ts#L110)。差异只针对这些路径，不泛化为现行浏览器必然请求错误末段。

## 3. 时间、单位与参考系

独立实现声明位置km、速度km/s等语义，但声明或合理性测试不等于独立精度验证。尤其不能仅凭“J2000秒”就确定完整时间尺度转换，不能从资源路径直接推断通用父参考系。

恢复的时间控件支持正播、倒播、暂停、实倍率与事件重播。real rate 表示倍率1，不代表跳到当前时刻；setToNow 是独立操作。独立 SimulationClock 也区分 paused/playback/live。

对太空之眼：以显式时间尺度的统一显示时间采样数据；暂停、倍率、当前时间跟随与事件边界分别定义。日期UI、数据采样与未来Nyx积分时间不能混作一个变量。输出契约要包含来源、有效区间、单位和参考系。

来源：[时间控制器](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/controllers/TimeController.js#L68)、[时间控件](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/ui/components/TimeControls.js#L208)、[setToNow](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/managers/TimeManager-728.js#L74)、[独立时钟](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/src/solar/domain/time.ts#L67)。

## 4. 相机与多尺度取景

- focus/lookAt 主要改变朝向，goTo 还处理位置、距离、父参考实体和过渡；两者不等价。
- 整体入框计算考虑水平/垂直FOV、外接球和星环外半径；不能对全部对象使用同一固定相机距离。
- 缩放采用距离倍率并受范围约束，适合跨度很大的空间浏览。
- Follow 会求目标与被跟随对象覆盖交集、等待实体、协调时间与构图，退出时恢复标签/遮挡/交互状态；并非复制目标平移。
- UI按对象提供不同相机模式，包括Nearby、System、Follow及其他任务视图；本轮实测地球只确认前三项入口，不把所有模式自动加进第一版范围。
- 原引擎使用自定义投影、深度参数与+Y前/+Z上约定。Bevy必须显式转换，不把 mid 参数解释为标准 far plane。

来源：[focus/goTo](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/core/Cameras.js#L12)、[入框](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/core/Cameras.js#L122)、[倍率缩放](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/managers/CameraManager.js#L355)、[Follow](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/managers/CameraFollowManager.js#L90)、[投影](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/components/CameraComponent.js#L262)。

边界复测清单：ET=0、覆盖无交集、过渡中换对象、原先暂停时进入/退出Follow、异常取消、极端FOV、带环对象与窗口比例变化。恢复源码中的端点truthy判定和成功后play行为是待复测风险，不是本轮已复现的故障。

## 5. 视觉效果不能只归结为模型贴图

| 效果 | 已查到的机制 | 对标要求 |
|---|---|---|
| 星体表面 | 多通道、多面TextureLOD，法线相关处理 | 同对象近远尺度、贴图过渡与加载状态对比 |
| 星环 | 上下表面纹理、遮影实体与渲染前更新 | 观察正反面及行星对环的阴影，不继承固定七槽位限制 |
| 恒星背景 | 受视口/DPR、星等、距离与视觉映射影响的粒子shader | 区分科学数据、屏幕可读性和显示映射，不误称严格光度模型 |
| 轨道线 | 根据当时位置/速度和引力参数构造瞬时轨道，应用相机相对位置 | 明确瞬时轨道、DYN轨迹与历史尾迹的区别 |

来源：[表面LOD](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/components/SpheroidLODComponent.js#L33)、[星环](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/components/RingsComponent.js#L23)、[星场](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/components/StarfieldComponent.js#L37)、[轨道线](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/components/OrbitLineComponent.js#L43)。

Bevy优先复用现成渲染能力，再针对实际差异设计扩展；不迁移Three的uniform、材质管理、坐标及投影代码作为平台公共接口。大气、HDR、色彩管理和模型动画的完整链路尚未在本轮逐条核验。

## 6. 资源、网络与生命周期

恢复 ResourceManager 按类型与URL共享请求，通过owner引用管理资源；最后引用释放后，已完成资源延迟回收，在途资源走取消/删除路径。RingsComponent 对异步完成后的已销毁组件进行检查，避免迟到结果复活旧对象。

独立 resource-pool 提供并发、字节预算、调用者租约及取消；资源超过预算时只淘汰无owner项，因此它不是任何时刻都不超过maxBytes的硬内存上限。不能把二进制缓存预算当作CPU/GPU总预算。

当前资源获取机制需按源码更新认识：build.mjs启用localAssetsPlugin，local-assets.mjs将NASA动态资源改写为/nasa/live/dynamic等同源地址。Next路由读取本地mirror，NASA_MIRROR_FILL=1时可刷新动态文件或补齐缺失文件，并区分静态与动态缓存头。README的“从NASA运行时加载”描述不充分表达当前这层同源处理。资源源与传输路径要分开记录。

来源：[恢复资源管理](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/managers/ResourceManager.js#L9)、[迟到纹理处理](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/engine/components/RingsComponent.js#L97)、[租约与预算](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/src/solar/runtime/resource-pool.ts#L120)、[构建](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/scripts/build.mjs#L41)、[URL改写](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/scripts/local-assets.mjs#L4)、[资源路由](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/src/app/nasa/%5B...path%5D/route.ts#L44)。

太空之眼可以学习去重、owner、取消、失败可重试、版本代次与延迟结果丢弃；浏览器直取或平台转发仍按自己的方案决定，不预先要求镜像全部NASA资源。Bevy GPU资源由显示核心管理，不由TS插件直接dispose。

## 7. UI、对象目录与平台边界

恢复应用分别配置组件、视图和图层分组；对象选择驱动视图与面板，图层独立控制。当前实测的Info/Toolbox/View Options和相关对象列表支持这一研究方向。

来源：[组件配置](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/app/config/components.js#L6)、[视图注册](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/src/app/config/views.js#L3)。

借鉴对象目录、关联对象、统一选择状态、面板状态与显示图层分离。不把Pioneer BaseComponent、Bevy ECS Component、Bevy原生Plugin与平台TS插件混为一谈。Story、事件教程、Compare、Telescope等虽在仓库存在，不因此全部纳入第一版。

## 8. 测试、样本和来源

- tests/dynamo.test.ts包含真实夹具的记录数、长度、四元数与轨道合理性等检查。
- tests/solar-ephemeris.test.ts包含合成插值与投影测试，适合提炼精确的小算例，但不是外部科学对照。
- tests/solar-time.test.ts实际执行恢复TimeUtils作为对照，证明目标是源兼容；不能直接当独立时间标准认证。
- eyes/scripts/audit.mjs检查来源清单、路径冲突、导入解析和残留webpack绑定，是结构核验，不是画面或GPU验收。
- package.json的test前置eyes构建，并有额外Node检查；不能在未运行全部流程时报告测试通过。

来源：[DYN夹具测试](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/tests/dynamo.test.ts#L33)、[合成求值](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/tests/solar-ephemeris.test.ts#L73)、[时间对照来源](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/tests/solar-time.test.ts#L7)、[结构核验脚本](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes/scripts/audit.mjs#L6)、[测试入口](https://github.com/spacelibres/solarsystem/blob/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/package.json#L15)。

实测样本比对：earth-sun-orb.dyn、earth-ori.dyn、jupiter-sun-orb.dyn与本轮从NASA获取的对应文件散列一致。完整散列见采集记录。它验证样本身份，不验证解析与科学数值。

项目package.json声明MIT；恢复源码、第三方库、原始NASA数据和资源仍需按各自来源判断。不能把GitHub整体license字段为空说成仓库不存在MIT声明，也不能用package级MIT覆盖全部恢复内容。

## 9. 对第一版的具体影响

| 优先级 | 下一项产物 | 必须解决的事实问题 |
|---|---|---|
| 先做 | DYN最小解码与求值设计 | 磁盘顺序、v1/v2索引、实际窗口、嵌套、类型语义、缺数据与覆盖范围 |
| 同步 | 对象与显示状态契约 | 单位、时间尺度、参考系、父体关系、来源、有效区间；Proto仍是候选，不在本报告决定 |
| 随后 | 相机和时间详细设计 | 聚焦/goTo/Follow分离、FOV与环入框、real rate与LIVE分离、转场取消 |
| 随后 | Bevy视觉差异清单 | 多尺度表面、星环/阴影、轨迹与尾迹、标签与星场；优先复用库，不照搬Three |
| 贯通时 | 资源与插件验收 | owner归属、预算、缓存、快速切目标、卸载、取消、重试与迟到结果 |

本报告不增加Nyx、STK、完整市场或大模型自动化的第一版实现范围；不把参考仓库当作新项目开发约束。下一步先根据这些已定位的源码事实形成DYN详细设计与小样本验证方案，再进入实现。
