# @spaceeyes/plugin-host

版本：0.0.1｜状态：最小可信宿主切片；不是 Worker/iframe 沙箱

按架构书 §6/§15 提供进程内插件清单校验、能力/网络授权、启停、取消与网络代理。插件不能直接调用 `fetch`，只能通过宿主 context 请求清单声明的 https 来源；越权、停用、撤权、超限和路径穿越均拒绝。

## 范围

- 清单：id/version/kind/capabilities/permissions.network.hosts/limits.maxFetchBytes，严格校验并归一化 https origin；
- 授权：请求能力与主机必须是宿主策略子集，有效上限取清单与策略较小值；
- 生命周期：install → enable → disable/revoke；启停幂等，启动失败回滚，停用中止在途请求；
- 网络：来源精确匹配、相对路径校验、响应字节上限、组合调用方取消信号；
- DYN 适配：`createDynamoPlugin` 把 NASA 来源与分段加载器接入宿主。

不包含：Worker/sandbox 隔离、跨来源消息校验、插件制品签名/版本锁、贡献点、对象/资源所有权、权限扩大重授、市场安装。这些仍属 P07–P09/P08；当前可信宿主与插件同进程，不能抵抗恶意进程内代码。

## 使用

```ts
import { PluginHost, createDynamoPlugin } from "@spaceeyes/plugin-host";

const plugin = createDynamoPlugin();
const host = new PluginHost(
  {
    allowedCapabilities: [...plugin.manifest.capabilities],
    allowedNetworkHosts: ["https://eyes.nasa.gov"],
    maxFetchBytes: 16 * 1024 * 1024,
  },
  {
    request: async (_origin, path, signal) => {
      const response = await fetch(`/api/dynamo/${path}`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      return new Uint8Array(await response.arrayBuffer());
    },
  },
);
host.install(plugin.manifest, plugin.factory);
await host.enable(plugin.manifest.id);
const loader = plugin.loader();
// ... use loader ...
await host.disable(plugin.manifest.id);
```

## 验证

`npm test --workspace @spaceeyes/plugin-host` 覆盖清单/策略拒绝、未授权主机、路径穿越、字节上限、启停、撤权、在途中止、启动失败回滚与 DYN 合成字节加载。真实插件制品、Worker 隔离与浏览器权限 UI 尚未实现。
