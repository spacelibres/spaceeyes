---
name: spaceeyes-platform-sdk
description: Use when authoring or reviewing SPACEEYES TypeScript plugins using controlled data, time, camera and visual asset APIs, including capability approval and lifecycle cleanup.
---

# 太空之眼平台 SDK 技能书（基础实现草案）

依据项目根目录的 `docs/太空之眼平台架构书.md`；实际接口为 `platform/plugin-host.ts`，内部核心适配边界为 `platform/core-port.ts`。本书随接口更新，不是最终协议或沙箱验收声明。

## 当前能做什么

插件提供清单与激活函数，由宿主调用 `PluginHost.register`。清单含 `id`、`apiVersion: 1` 和 `capabilities`。标识采用 `vendor.plugin` 形式，每段以小写字母开头，后续为小写字母、数字或连字符。当前识别 `camera.control`、`data.publish`、`time.control`、`scene.visual`。

插件在激活时得到 `PluginContext`：

- `pluginId`：宿主提供的插件身份。
- `signal`：本次会话的 AbortSignal，传给支持取消的异步操作。
- `onDispose(callback)`：登记释放订阅、请求和其他资源的回调。
- `camera.focus(targetId)`：请求聚焦一个对象，需清单声明且宿主批准 `camera.control`。目标标识为 1～256 个 ASCII 字符，首字符为字母或数字，其余允许字母、数字、冒号、点、下划线、斜杠及连字符；该标识不是文件路径或 URL。核心负责核验目标存在性及实际相机执行。
- `requireCapability(name)`：检查当前会话及能力，不能用它推断尚未实现的 API 可用。
- `data.publish(targetId, state)`、`data.remove(targetId)`：需 `data.publish`。状态包含 positionKm 三元数组、正数 radiusKm、epochTdbSeconds、coverageTdbSeconds 二元数组、frame 固定 ICRF、非空 source。时间为 J2000 起算 TDB 秒，数值必须有限，采样时刻在覆盖内。发布时复制并冻结数据；Rust 再校验权限与归属。当前不提交姿态或轨迹。
- `time.seek(epochTdbSeconds)`、`time.setPlayback(playing, rate)`：需 `time.control`，时间与倍率必须有限，支持负倍率反向播放。不得自行用 UTC Date 数值冒充 TDB。没有当前时刻样本时显示端须报告缺失，不擅自外推。控制时间的会话停用后暂停播放。
- `visual.set(targetId, spec)`、`visual.clear(targetId)`、`visual.status(targetId)`：需 `scene.visual`，只能操作或读取本会话所属对象。`data.publish` 不包含此权限。资源只能引用宿主已登记的 assetId，不能把 URL 或文件路径传给插件接口。
- `visual.starfield(layerId, spec|null)`：需 `scene.visual`，发布或清除本会话的独立背景点层，不创建科学对象，不占用轨迹点预算。layerId 使用 assetId 的 ASCII 语法；同名层在不同会话隔离。spec 仅接受 frame 固定 ICRF、非空 source（最多 1024 字符）、平铺 positionsKm/colorsRgb、magnitudes/absoluteMagnitudes。N 个点分别要求 3N/3N/N/N 个有限数值，1≤N≤50000；RGB 在 [0,1] 且每点非全黑，位置非零且每分量绝对值≤1e30 km。每会话最多八层、合计五万点，替换原子校验；传 null 清除，停用释放全部层。SDK 复制并冻结数组，Rust 再验证；不能借此操作相机、材质或任意 shader。

视觉参数严格采用以下两种结构，不接受额外字段：

```ts
sdk.visual.set('object:spacecraft', {
  kind: 'model', assetId: 'model:juno', scene: 0, scaleKmPerUnit: 0.001,
});
sdk.visual.set('object:body', { kind: 'sphere', textureAsset: 'texture:surface' });
```

assetId 为 1～256 个 ASCII 字符，首位字母或数字，其余允许字母、数字、冒号、点、下划线和连字符。scene 是 0～1023 的整数，实际存在性由加载器检查；scaleKmPerUnit 是有限正数，表示模型单位到千米的比例，不是科学对象半径。球体贴图作为基色图使用，不能借此传任意材质或 shader。未提供 textureAsset 时使用中性球体。

`clear` 清除资源表示并恢复默认验证几何体，不删除科学对象；删除对象使用 `data.remove`。设置资源表示不是逐帧发布数据的步骤，只在表示变化时调用；重复设置会创建新修订并重新绑定资源。

`status` 返回只读 `{ revision, phase, detail }` 或 null。revision 为不透明十进制字符串；phase 是 pending/loading/ready/failed/suspended。ready 表示图像或模型实例及依赖已加载，不是 GPU 像素、科学姿态或 NASA 效果认证。failed 时对象隐藏，不用默认球体冒充已加载模型；suspended 表示没有当前时刻有效显示状态。清除或替换后，旧修订的完成结果不再生效。

```ts
host.register({
  id: 'example.observer', apiVersion: 1, capabilities: ['camera.control'],
}, sdk => {
  // 仅在宿主已提供可用核心、且目标由对象目录确认存在时调用。
  sdk.camera.focus('body:mars');
});
// enable 及批准列表由宿主控制，不由插件自行授予。
```

## 边界与失败处理

### 场景点选属于宿主输入

宿主内部 `WasmCore.pick_object(u,v)` 查询最近一次实际相机投影的候选对象，参数是画布内归一化坐标，必须有限且在 [0,1] 内；没有命中返回 undefined，不修改科学状态、时间或相机。候选会核对当前对象有效性与显示失败状态，停止渲染后不接受旧帧。球体按投影圆盘、远景标记及避让后标签判断，深度优先，不是模型三角形或环拾取。

网页点选命中后沿用已有选择流程，按需获取数据/表面，再通过现有 SDK 相机意图聚焦；空白、拖动、取消或多指手势不触发选择。此方法不在 PluginContext 中，插件不能借此获取 Bevy World、相机投影缓存、宿主输入或新权限；插件继续使用已批准的公开 SDK。

### 资源和会话

宿主可使用内部 `platform/resource-client.ts` 管理已审查的同源目录：只按资源标识读取，拒绝未知标识、越界路径和重定向；单文件最多 16 MiB，目录最多 4096 项，缓存默认 16 MiB 并受总预算约束。返回字节为副本；`clear()` 使在途旧结果失效，取消信号后返回的结果不入缓存。调用方必须将会话 signal 传入并在清理时清空其独立客户端。缓存目录视为不可变，来源更新由宿主重新建目录/清空，尚未提供 TTL、散列校验或跨调用请求合并；该工具不是新授予插件任意网络权限，也不是同进程 JS 沙箱。

插件只能表达公开 SDK 意图，不获得 CorePort、sessionId、Bevy World、相机内部对象或服务器模块。不得访问冻结分支作为默认实现来源；不得把自建 TS 场景状态当作 Rust 核心权威状态。不得从本接口推导 Nyx、市场或任意命令执行能力已可用。WasmCorePort 已连接实际 Rust WASM；browser-render 提供 Bevy 显示与受控模型/贴图入口，未注入对应适配方法时调用明确失败。

资源登记是宿主职责，不向插件开放。宿主必须审查资源包及 glTF 外部依赖，固定来源、长度和散列，登记相对资产根目录的路径。当前目录接受 glTF/GLB 模型与 PNG/JPEG/WebP 贴图，最多 4096 项，实例内不可覆盖同名资源。NASA Eyes 受控资源服务已通过成熟库在服务器解码 Draco、Basis/KTX2、WebP，保留 glTF 纹理变换；这不是浏览器原生支持所有扩展或 NASA 材质一致性认证。

### NASA Eyes 全量目录与按需资源

独立数据插件维护固定快照的 451 个天然卫星和 171 个航天器；含基线对象的用户目录为 631 项。源定义缺失的三个条目明确不可用，不能推测 URL、位置或替代模型。目录元数据登记不触发全量数据或模型请求；选择对象才获取其数据、当前父体依赖和详细模型，返回总览保留十对象基线。

父体按核心统一 TDB 时刻和任务阶段确定，位置统一为 ICRF/km；非当前任务时间须切到已核验的有效观测时间后重新求值，不扩大覆盖、不外推。源静态表达式只接受已实现的受控类型，未知源函数保持不可执行。`platform/eyes-observation-times.json` 是时间入口提示，不是烘焙星历。

模型、依赖和表面在服务器按 URL 白名单及 SHA256 固定；局部源变换和单位由资源转换器标准化为 km，已转换模型使用 `scaleKmPerUnit: 1`。不得再次按 0.001 缩放，不得将用于相机取景的模型 extents 标为物理半径。源提供的通用小卫星模型是示意几何。

插件只引用宿主登记的 assetId；服务器 `/assets/eyes/` 路径、转换库、缓存和源 URL 不构成新 SDK 权限。数据读取最多四并发，模型转换最多二并发，磁盘缓存预算 3 GiB；切换、取消、退出后的旧结果不得重新发布。模型 ready、科学状态 ready 与 GPU 检查分别记录。不能将本批资源接入宣称为任务部件动画、所有姿态或完整 NASA Eyes 视觉验收。

### NASA Eyes 背景星空

独立 `spaceeyes.background-stars` 数据插件只申请 scene.visual。按固定白名单、字节和 SHA256 读取七份星表，TS 解码 23 字节记录并按 wxyz 四元数转换至赤道 J2000，核心只做统一显示基转换。进入工作区即触发需求，先亮星层再两并发补齐；不阻塞太阳系初始化。关闭取消未完成工作并清除表示，已验证的解析数据在五万点缓存预算内复用；退出清空缓存。

背景表没有名称、唯一星表 ID、自行或速度，不用于生成可选择天体或动态科学状态。保留源绝对星等与位置，543 条源距离/星等不一致不擅改。Bevy 按层合批，不逐星创建实体；源亮度、像素尺寸和径向衰减是显示参数，逐点数值接收不等同 GPU 或外部天文精度认证。原始二进制和星点 WGSL 均由服务器提供，不放入 WASM。

模型加载禁用 glTF 内置摄像机与灯光导入，scene.visual 不授予相机或照明控制权。当前资源是同源受控根目录下的已审查文件；不能将测试资源服务当作市场沙箱或通用任意 URL 代理。

缺少声明或批准时拒绝调用；停用后调用旧 SDK 会得到 inactive 错误；目标语法不合法会被拒绝；未连接核心得到 unavailable 错误，不能以静默成功或自建替代渲染冒充执行成功。核心适配器的失败继续抛给调用者。本批错误仍为 Error，不依赖其文字作为稳定机器协议。

每次重新启用得到新会话，不能复用上次 SDK。停用先撤销会话、发出取消信号，再逆序尝试全部清理；清理失败会聚合上报，不能据此声称资源已全部释放。同进程宿主不能强制终止不合作插件；不可信代码隔离尚未实现。

宿主销毁时调用 `await host.shutdown()`，它会先撤销全部会话并等待在途启停，再尝试所有插件清理。清理回调负责取消/释放外部资源，不应再用已失效 SDK 修改场景；核心会话释放由宿主负责。关闭错误仍需上报，但应在 finally 中继续请求渲染器停止并 free 核心。停止和原始 WasmCore 只归宿主，不向插件开放。

## 验证

运行 `node --test platform/tests/*.test.ts` 检查 SDK 逻辑；完整集中验证执行 `pwsh -File tools/check-core.ps1`，会重新生成 WASM 并执行 `platform/integration/wasm.test.ts`。测试包括无权限、核心缺失、无效目标、旧会话、重启隔离、释放和真实 Rust 再验证。真实 WASM 集成不代表 Bevy 聚焦、GPU 画面或不可信插件隔离通过。技能书行为测试尚未单独验收。

## 第一版整体显示控制扩展

- `camera.view('overview' | 'top' | 'front' | 'side' | 'orbit')` 需要 `camera.control`。overview 使用当前有效对象的科学位置与半径包围范围计算总览；`camera.focus(id)` 随仿真状态持续跟随。显示原点和缩放不修改科学状态。
- `ObjectState.orientationWxyz?: [w,x,y,z]` 是单位四元数，body-local 到 ICRF；平方模误差不得超过 `1e-6`。省略时视为无额外旋转。Bevy 显示使用既有 `(x,z,-y)` 基变换。
- `visual.trajectory(targetId, points)` 接收 ICRF km 三元组数组；每会话最多 4096 点、有限数值，空数组清除。Bevy 内置 Gizmos 绘制。
- `visual.label(targetId, text)` 最多 256 Unicode 字符，不接受控制字符，空串清除；Bevy 原生 UI Text 经 Camera world_to_viewport 投影显示。
- 字符校验不代表字形覆盖。当前外置标签字库未配置中文字形，内置标签使用 ASCII 对象标识；完整多语言标签不属于本版已验收能力。
- `visual.layers({ labels, trajectories })` 仅控制调用会话自有对象对应显示层。以上均需 `scene.visual`，Rust 再次验证权限与对象归属；移除对象/释放会话清理附属状态。
- sphere `VisualSpec` 可选 `colorRgba`、`emissiveRgba`，均为 `[r,g,b,a]`，各通道有限且 `[0,1]`。由 Bevy `StandardMaterial` 执行；纹理仍通过宿主资源目录 `textureAsset`，不得虚构 NASA 资源。
- 宿主 `WasmCore.utc_to_tdb(unixSeconds)` 使用独立 Hifitime 4.3.1 转换 UTC Unix 秒为 J2000 TDB 秒，不改变 clock；不链接 Nyx。闰秒依据库内表，未来闰秒需随资料维护。

- sphere `faceAssets?: [string,string,string,string,string,string]` 与 `textureAsset` 互斥，六个资源均须在Rust目录登记为texture。按恢复CubeMap原面号 +X,+Y,-X,-Y,+Z,-Z，以及其U/V面基重采样；输出2048x1024，64组有界缓存。使用Bevy原生Image、UV Sphere和StandardMaterial，不替换PBR渲染器。载入/解码失败报告failed，不呈现未完成纹理。GPU地标、极向和接缝验收独立于编译通过。
- 宿主 `WasmCore.tdb_to_utc(tdbSeconds)` 是同一Hifitime的反向换算纯函数，返回Unix秒。

- sphere环：`ringAssets: [topId,bottomId]`，同时必填`ringInnerRadiusRatio`、`ringOuterRadiusRatio`，满足1<=inner<outer<=10。NASA原环图是径向条带，按恢复RingsComponent的u=(r-inner)/(outer-inner)展开1024二维透明纹理；两片Bevy Plane3d各背面剔除，跟随父对象姿态。相机按outer展示范围取景，不改变科学radiusKm。

## 外置资源与触发加载

### 带时间的轨迹

`visual.trajectory(targetId, points, epochsTdbSeconds?, style?)` 仍需 `scene.visual` 且只可修改本会话对象。可选第三参数为每个顶点对应的 J2000 TDB 秒，长度必须与 points 相同、数值有限且严格递增；空数组用于清空，单点带时间轨迹拒绝。TS 复制输入，Rust 再验证；全部对象仍共享每会话最多 4096 个轨迹顶点的预算。

带时间轨迹可指定 `style: {originId?, colorRgba?}`。originId 必须是本会话另一个有效对象，points 此时是相对于该对象的 ICRF 方向千米向量，显示时使用父体当前核心位置平移，不是把各历史时刻的父体运动叠加到卫星环线。colorRgba 为有限 [0,1] 四元组，作为轨迹颜色，不能传 shader 或任意材质字段。当前宿主月球轨迹使用 earth 作为原点，所有轨迹使用对象目录的颜色。近距离观察时轨迹随相机距离淡出，拉远恢复，图层开关仍生效。

带时间轨迹在当前时刻落入已提供的相邻顶点区间时，Bevy 使用核心同一时刻的对象位置分割该线段，保证与显示天体一致；不是以最近空间点猜测时间。历史路径必须来自覆盖内有效数据，不能用跨缺段直线补齐。瞬时椭圆可以由有效 DYN 当前相对位置、端点传播后混合的速度和引力参数推导：整周模型采样时刻只是该瞬时二体轨道的参数，不扩展 `data.publish` 的科学覆盖，不是整周实测或未来预测。宿主须明确标注含义，非椭圆/退化状态不可强制闭合。当前太阳系宿主采用瞬时椭圆；历史采样接口继续保留真实断口。未提供时间的旧调用仍是静态折线，不承诺随天体运动自动连接。清空、移除或停用对象会清理时间元数据。核心不自动首尾闭合；闭合必须由来源明确的同一轨道模型提供相同端点。

### 资源触发

NASA DYN 服务对固定 SHA256 的金星重复记录、火星历史回退文件可选择已审查的无歧义有序窗口；原始记录不排序、不改值，默认解码仍严格递增。响应携带原始哈希、记录范围和覆盖，数据源 provenance 与核心 source 保留它们。此内部适配不授予插件修复任意 DYN、扩大科学覆盖或屏蔽错误的能力。火星歧义历史查询仍失败，网页当前时间恢复不代表完整历史已修复。

当前日心宿主总览围绕科学原点，以 1 AU=149597870.7 km 统一换算，行星分布变化不移动观察中心；局部观察仍先在 f64 中减去科学原点以保留精度。用户拉远超过局部场景阈值时，核心进入总览，宿主同步清除局部选择；这不是向插件开放任意相机内部控制。

当前宿主的环正反面共用同一张上表面颜色/透明纹理。Bevy ExtendedMaterial 仅对环启用光线—视线半向量的粒子受光近似，颜色、方向光、透明混合和调色仍由 Bevy PBR 执行，不使用 emissive/unlit。它不是已标定的散射模型或 NASA 完整阴影复刻。着色器程序是项目受控服务器文件，不允许插件指定任意 shader。

模型、纹理、字体、音频、星历及场景数据不得用 include_bytes/include_str 或嵌入资产宏编译进核心 WASM。资源登记只登记受控路径，不触发下载。首页总览需要科学位置与轨迹，因此只触发所需 DYN 轨道数据获取；姿态在选择该天体后才请求；总览基础几何不请求高清表面。选择天体才绑定该对象的六面纹理及其环，已访问表示在本会话中复用；不能为了相邻对象或未来操作提前加载整目录。

当前标签字库是服务器 `/assets/fonts/FiraMono-subset.ttf`，首次有实际标签显示时由 Bevy AssetServer 加载，不使用编译内嵌 default_font。字体不包含完整中文字形。插件不能借此指定任意字体 URL 或绕过受控目录。

Bevy 着色器、运行时生成的基础网格及程序常量属于核心程序；WASM data section 不等于业务资产包，不能通过清空所有 data section 实现资源分离。


## 深空环境与恒星显示（SDK 0.0.19）

- `visual.environment({assetId, frame: 'ICRF', intensity})` 或 `null` 需要 `scene.visual`；assetId 必须是宿主登记的 texture，intensity 为有限 [0,4]。只允许一个活动会话拥有环境；其他会话不能覆盖或清除，释放会话自动清理。环境是方向背景，不生成科学天体或轨道，不授予灯光、相机或任意 URL 权限。
- sphere 可选 `stellar: {coronaIntensity, flowSpeed}`，分别为有限 [0,4]、[0,2]；SDK 复制并冻结，Rust 再验证。它只描述通用自发光天体的视觉效果，不改变科学尺寸、时间或状态，不能用于推断太阳观测数据。
- 银河固定源、原始字节及 SHA256 见 validation/galaxy-assets.json。服务器成熟 EXR 解码后做线性曝光/Reinhard/sRGB 转换并翻转底向上行序；派生图单独通过服务器加载，不进入 WASM。浏览器仍只有 Bevy 渲染器。
- 银河加载状态由宿主查询核心 pending/ready/failed/disabled；ready 表示纹理加载，不代表着色器或 GPU 验收。必须检查包括 Bevy 转发为 log 级别的 ERROR 信息。关闭/退出取消订阅，不能复活旧层；失败可重试。
- 标签显隐、遮挡、文字测量、碰撞及鼠标轻惯性由核心执行；插件不能直接改 Bevy 实体。未来头显姿态不得套用鼠标惯性滤波；未提供 WebXR 或头显验收。

银河宿主可在已登记预览与高清assetId之间渐进替换；核心在新纹理就绪前保留旧层，关闭清理两者。当前仅两级全景，不代表视野瓦片调度。stellar日珥是核心通用视觉模拟，不改变科学半径，不能作为磁场或真实喷发数据。


## Parker数值基线（SDK 0.0.20）

`platform/solar-wind.ts` 是独立纯TS模型，参数为SI，输出速度m/s、电子密度m^-3、质量密度kg/m³和温度K。仅支持纯电离氢同温等温球对称跨声速解，临界点需位于基部与参考半径之间；无效/超域输入拒绝。来源与示例边界见validation/solar-wind-model.json；温度和1AU密度假设不能标为实时观测。

宿主资源准备生成外置WGSL查表及JSON数值审计；这不是新的插件权限，不开放Bevy内部实体。当前stellar接口保持不变；flowSpeed仍是显示速度，不能伪装为科学积分步长。ne²相对发射包络、亮度增强与时间压缩必须分开声明，不得宣称完整MHD、实测磁场或全部无贴图太阳已完成。


### 三维外流标签（SDK 0.0.21）

`windMaterialPoint(positionR, flightSeconds, timeSeconds, periodSeconds)` 返回摄像机无关的三维物质坐标标签，仅用于显示输运一致性验证；positionR在1..12R范围内，周期边界淡入淡出。它不是粒子科学状态、磁场数据或新场景权限。宿主生成的外置体积查表覆盖1..12R，Parker科学表仍到1AU。消光、亮度和时间压缩是显示映射，不得把周期扰动宣称为完整守恒MHD。相机不作为密度场输入，未来每眼分别计算射线；未验收VR。


## 太阳特效实时调参（核心0.0.23 / SDK0.0.22）

`visual.stellar(targetId, tuning)`需要已批准的scene.visual及本会话已有的stellar球体对象。tuning只含settings和profile；settings严格包含platform/stellar-controls.json全部58个具名字段，不接受未知字段。使用`stellarDefaults()`、`snapshotSettings()`和`buildStellarTuning(settings)`构造；后者按温度和1AU参考电子密度重算64点Parker表，并缓存物理输入，普通视觉调整不重复求解。

profile含density/travel各64个有限值，density相对根部且>0、<=1.00001，首点1；travel首点0且严格递增，不超过1e12秒。范围固定1..12R对数半径；不能塞任意shader、URL或Core指针。TS冻结副本，Rust再次校验字段、数值范围、配对关系、顶点预算和归属。采样步数4..24，日珥顶点<=50000；fullDistance<=enterDistance<exitDistance，fadeStart<outerRadius，各阈值低<高。

更新不增加视觉资源修订，不重载贴图；普通字段进入现有uniform，日珥几何字段替换同一专用Mesh资产内容。源对象移除、清空表示或释放会话清除调参；旧会话不可再更新。宿主关闭面板保留本次配置，本机保存/恢复及JSON导入导出由宿主管理，导入仍必须走同样校验。Parker温度和密度为示例边界，不是实测日期；日珥网格/体积噪声不是离散粒子或完整MHD。


网页0.0.30 / SDK0.0.23的`applySolarReferencePalette(settings)`仅返回参考照片的光球亮度与五项颜色覆盖，仍通过snapshotSettings校验；不修改开关、形态、速度、Parker输入或采样预算。宿主随后沿用visual.stellar发布并可自行保存配置。默认光球#FF4400/1.05，外流#650400→#FF7A0A，日珥#930A00→#FFD05A。


## 观测约束太阳重建（核心0.0.25 / SDK0.0.24）

settings扩为74项，新增字段索引58..73固定。只接受完整74项，或严格旧58项快照；旧快照补默认且observationStyle=0，保持旧模式。未知/部分字段仍拒绝。JSON/localStorage读v1/v2、写v2，不覆盖用户配置。

`applySolarObservationPreset(settings)`明确切换新模式；程序化自发光表面与局部活动区、局部三维日珥、有限近表面日冕。日珥高度/丝径/长度为km，流速km/s；参数经科学半径换算，乘显式形态系数，输运另乘显示速度与时间压缩。颜色与常量源函数是显示映射，非NLTE解。旧Parker输入保留且只服务旧风模式。

Premultiplied透明层使用Iout=Iin*exp(-tau)+S*(1-exp(-tau))的常量源函数近似；不能宣称求解MHD、观测磁场、能量守恒或实测喷发。细节仅靠近创建，退出距离/关闭/源移除释放专用材质和几何；资源仍由服务器按需获取，着色器不内嵌WASM。完整依据见docs/太阳观测约束与三维重建设计.md。


网页0.0.32统一太阳入口：宿主初始化就发布已恢复参数，不等到选择或面板打开；旧SDK模式保持兼容，但工作区规范化为同一观测显示。太阳表面保留同一个轻量材质，远景通过shader平滑减细节并跳过噪声，不切回照片；近景日冕/日珥仍独立距离门控并回收。宿主不再给Sun绑定NASA六面图；其他天体按需资源规则不变。
