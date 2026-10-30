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

宿主可使用内部 `platform/resource-client.ts` 管理已审查的同源目录：只按资源标识读取，拒绝未知标识、越界路径和重定向；单文件最多 16 MiB，目录最多 4096 项，缓存默认 16 MiB 并受总预算约束。返回字节为副本；`clear()` 使在途旧结果失效，取消信号后返回的结果不入缓存。调用方必须将会话 signal 传入并在清理时清空其独立客户端。缓存目录视为不可变，来源更新由宿主重新建目录/清空，尚未提供 TTL、散列校验或跨调用请求合并；该工具不是新授予插件任意网络权限，也不是同进程 JS 沙箱。

插件只能表达公开 SDK 意图，不获得 CorePort、sessionId、Bevy World、相机内部对象或服务器模块。不得访问冻结分支作为默认实现来源；不得把自建 TS 场景状态当作 Rust 核心权威状态。不得从本接口推导 Nyx、市场或任意命令执行能力已可用。WasmCorePort 已连接实际 Rust WASM；browser-render 提供 Bevy 显示与受控模型/贴图入口，未注入对应适配方法时调用明确失败。

资源登记是宿主职责，不向插件开放。宿主必须审查资源包及 glTF 外部依赖，固定来源、长度和散列，登记相对资产根目录的路径。当前目录接受 glTF/GLB 模型与 PNG/JPEG/WebP 贴图，最多 4096 项，实例内不可覆盖同名资源。KTX2 转码、完整 glTF 扩展、各贴图 UV 变换及 NASA 材质一致性尚未验收，不自行宣称支持。

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

模型、纹理、字体、音频、星历及场景数据不得用 include_bytes/include_str 或嵌入资产宏编译进核心 WASM。资源登记只登记受控路径，不触发下载。首页总览需要科学位置与轨迹，因此只触发所需 DYN 轨道数据获取；姿态在选择该天体后才请求；总览基础几何不请求高清表面。选择天体才绑定该对象的六面纹理及其环，已访问表示在本会话中复用；不能为了相邻对象或未来操作提前加载整目录。

当前标签字库是服务器 `/assets/fonts/FiraMono-subset.ttf`，首次有实际标签显示时由 Bevy AssetServer 加载，不使用编译内嵌 default_font。字体不包含完整中文字形。插件不能借此指定任意字体 URL 或绕过受控目录。

Bevy 着色器、运行时生成的基础网格及程序常量属于核心程序；WASM data section 不等于业务资产包，不能通过清空所有 data section 实现资源分离。
