---
name: spaceeyes-platform-sdk
description: Use when authoring or reviewing SPACEEYES TypeScript plugins against the current plugin host and camera SDK, including capability approval and lifecycle cleanup.
---

# 太空之眼平台 SDK 技能书（基础实现草案）

依据项目根目录的 `docs/太空之眼平台架构书.md`；实际接口为 `platform/plugin-host.ts`，内部核心适配边界为 `platform/core-port.ts`。本书随接口更新，不是最终协议或沙箱验收声明。

## 当前能做什么

插件提供清单与激活函数，由宿主调用 `PluginHost.register`。清单含 `id`、`apiVersion: 1` 和 `capabilities`。标识采用 `vendor.plugin` 形式，每段以小写字母开头，后续为小写字母、数字或连字符。当前识别 `camera.control`、`data.publish`、`time.control`。

插件在激活时得到 `PluginContext`：

- `pluginId`：宿主提供的插件身份。
- `signal`：本次会话的 AbortSignal，传给支持取消的异步操作。
- `onDispose(callback)`：登记释放订阅、请求和其他资源的回调。
- `camera.focus(targetId)`：请求聚焦一个对象，需清单声明且宿主批准 `camera.control`。目标标识为 1～256 个 ASCII 字符，首字符为字母或数字，其余允许字母、数字、冒号、点、下划线、斜杠及连字符；该标识不是文件路径或 URL。核心负责核验目标存在性及实际相机执行。
- `requireCapability(name)`：检查当前会话及能力，不能用它推断尚未实现的 API 可用。
- `data.publish(targetId, state)`、`data.remove(targetId)`：需 `data.publish`。状态包含 positionKm 三元数组、正数 radiusKm、epochTdbSeconds、coverageTdbSeconds 二元数组、frame 固定 ICRF、非空 source。时间为 J2000 起算 TDB 秒，数值必须有限，采样时刻在覆盖内。发布时复制并冻结数据；Rust 再校验权限与归属。当前不提交姿态或轨迹。
- `time.seek(epochTdbSeconds)`、`time.setPlayback(playing, rate)`：需 `time.control`，时间与倍率必须有限，支持负倍率反向播放。不得自行用 UTC Date 数值冒充 TDB。没有当前时刻样本时显示端须报告缺失，不擅自外推。控制时间的会话停用后暂停播放。

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

插件只能表达公开 SDK 意图，不获得 CorePort、sessionId、Bevy World、相机内部对象或服务器模块。不得访问冻结分支作为默认实现来源；不得把自建 TS 场景状态当作 Rust 核心权威状态。不得从本接口推导 Nyx、市场或任意命令执行能力已可用。WasmCorePort 已连接实际 Rust WASM，但未注入对应适配方法时调用仍明确失败；实际 Bevy 显示尚未接入。

缺少声明或批准时拒绝调用；停用后调用旧 SDK 会得到 inactive 错误；目标语法不合法会被拒绝；未连接核心得到 unavailable 错误，不能以静默成功或自建替代渲染冒充执行成功。核心适配器的失败继续抛给调用者。本批错误仍为 Error，不依赖其文字作为稳定机器协议。

每次重新启用得到新会话，不能复用上次 SDK。停用先撤销会话、发出取消信号，再逆序尝试全部清理；清理失败会聚合上报，不能据此声称资源已全部释放。同进程宿主不能强制终止不合作插件；不可信代码隔离尚未实现。

## 验证

运行 `node --test platform/tests/*.test.ts` 检查 SDK 逻辑；完整集中验证执行 `pwsh -File tools/check-core.ps1`，会重新生成 WASM 并执行 `platform/integration/wasm.test.ts`。测试包括无权限、核心缺失、无效目标、旧会话、重启隔离、释放和真实 Rust 再验证。真实 WASM 集成不代表 Bevy 聚焦、GPU 画面或不可信插件隔离通过。技能书行为测试尚未单独验收。
