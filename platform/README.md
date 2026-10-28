# 平台基础运行层

按[平台基础功能实施](../docs/平台基础功能实施.md)逐项实现，架构依据为[太空之眼平台架构书](../docs/太空之眼平台架构书.md)。原创代码 MIT，版本以 package.json 为准。

当前提供可信进程内 TS 插件的清单注册、能力声明审批和生命周期管理。Node.js 24.15.0 以上，无运行时外部依赖：

```powershell
node --test platform/tests/*.test.ts
```

`PluginHost.register(manifest, activate)` 注册，不自动启动；`enable(id, approved)` 由宿主提供批准能力；`disable(id)` 中止本次会话并清理；`status(id)` 读取生命周期状态。插件通过 `onDispose` 登记请求、订阅等资源的清理回调，并将 `signal` 传给支持取消的操作。

并发启停返回 busy 错误，调用方应等待当前操作完成；重复启用已运行实例和重复停用无会话实例不重复执行回调。清理失败聚合报告，其他清理仍会执行；这不保证失败资源已释放，调用方必须处理错误。宿主不能强行终止不合作的同进程插件。

已提供首个受控 SDK 意图 `context.camera.focus(targetId)`，宿主校验授权、会话和目标格式后转发给注入的 `CorePort`。插件不获得核心适配器或会话标识。停用时调用适配器释放本次会话。详见 [SDK 技能书](../.agents/skills/spaceeyes-platform-sdk/SKILL.md)。

已提供 `data.publish/remove` 和 `time.seek/setPlayback`。`WasmCorePort` 将调用转发到实际 Rust WASM；核心再次验证权限和归属。运行集中验证见 `core/README.md`，跨语言测试位于 `integration/wasm.test.ts`。

已接入基础 Bevy 显示与浏览器验证，见 `core/README.md`。`host.shutdown()` 先撤销并中止全部会话、等待在途启停，再尝试清理所有插件；失败聚合上报，重复关闭不会重复清理。关闭后禁止注册和启用。忽略取消信号、永不结束的同进程激活仍可能阻塞关闭，不应将其当作沙箱终止能力。

Next.js 页面、真实 NASA 资源效果、市场和不可信代码隔离仍未实现。`CorePort` 为内部接口，不决定最终 Proto 或其他传输协议。
