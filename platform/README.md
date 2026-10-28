# 平台基础运行层

按[平台基础功能实施](../docs/平台基础功能实施.md)逐项实现，架构依据为[太空之眼平台架构书](../docs/太空之眼平台架构书.md)。原创代码 MIT，版本 0.0.1。

当前提供可信进程内 TS 插件的清单注册、能力声明审批和生命周期管理。Node.js 24.15.0 以上，无运行时外部依赖：

```powershell
node --test platform/tests/*.test.ts
```

`PluginHost.register(manifest, activate)` 注册，不自动启动；`enable(id, approved)` 由宿主提供批准能力；`disable(id)` 中止本次会话并清理；`status(id)` 读取生命周期状态。插件通过 `onDispose` 登记请求、订阅等资源的清理回调，并将 `signal` 传给支持取消的操作。

并发启停返回 busy 错误，调用方应等待当前操作完成；重复启用已运行实例和重复停用无会话实例不重复执行回调。清理失败聚合报告，其他清理仍会执行；这不保证失败资源已释放，调用方必须处理错误。宿主不能强行终止不合作的同进程插件。

已提供首个受控 SDK 意图 `context.camera.focus(targetId)`，宿主校验授权、会话和目标格式后转发给注入的 `CorePort`。插件不获得核心适配器或会话标识。停用时调用适配器释放本次会话。详见 [SDK 技能书](../.agents/skills/spaceeyes-platform-sdk/SKILL.md)。

当前仅测试调用边界，尚无真实 Bevy 适配器、数据发布 API、Next.js 页面、市场或不可信代码隔离；不能据此宣称画面已可控制。`CorePort` 为内部接口，不决定最终 Proto 或其他传输协议。
