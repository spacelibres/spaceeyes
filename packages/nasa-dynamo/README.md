# @spaceeyes/nasa-dynamo

版本：0.0.1｜状态：解析、求值、分段加载与有界缓存已实现；宿主代理与真实科学样本未接入

NASA Eyes `.dyn` 星历的独立 TypeScript 数据源插件核心。按架构书 §15，DYN 解析不进入 Rust Core；本包只做字节解析、窗口求值与声明式权限，不直接联网、不持有场景或时钟权威。

## 构建与测试

需要 Node >= 22（工作区要求）：

```bash
npm run build --workspace @spaceeyes/nasa-dynamo
npm test --workspace @spaceeyes/nasa-dynamo
```

测试只使用代码内生成的合成 `.dyn` 字节，不包含 NASA 数据或模型。真实 NASA 夹具的再分发条件尚未确认，禁止入库。

## 范围

- 版本 1/2 文件头、五类点（`orb`/`pos`/`lin`/`ori`/`quat`）、内联点、索引与分段文件；
- 小端 f64 记录、W 在前四元数、严格字节数与时间递增校验；
- `pos` 三次 Hermite、`lin` 线性、`quat`/`ori` SLERP、`orb` 二体投影与重心质量比；
- 宿主注入式分段加载、覆盖段选择、有界 LRU 与取消；
- 明确不可用原因：越界、非法样本、非支持轨道。

不包含：直接网络实现、持久缓存、NASA 数据再分发、参考系/时间尺度换算、轨道线渲染、任务调度或插件宿主隔离。

## 使用

```ts
import { NasaDynamoPlugin } from "@spaceeyes/nasa-dynamo";

const plugin = new NasaDynamoPlugin();
const file = plugin.loadFile(bytesFromHostProxy, {
  path: "earth/sun/orb/def.dyn",
  segment: null,
});
const state = plugin.evaluate(file, timeEt, { body: 1 });
```

`bytesFromHostProxy` 必须由宿主权限代理取得；本包没有网络实现。`timeEt` 的单位、历元和参考系由宿主显式提供，本包不猜测 TT/TDB/UTC 或参考系名称。

## 分段加载与缓存

```ts
import { DynamoSegmentLoader } from "@spaceeyes/nasa-dynamo";

const loader = new DynamoSegmentLoader({
  fetchBytes: (path, signal) => hostProxy.fetch(path, signal),
});
const window = await loader.load("ganymede/jupiter/orb/def.dyn", timeEt);
```

索引文件只取覆盖请求时刻的分段（数字位数来自文件头），不批量下载全部段。索引与窗口使用有界 LRU；`AbortSignal` 在每次宿主读取前后检查。`DynamoLoadError` 区分 `fetch-failed`、`invalid-data`、`no-data` 与 `aborted`。缓存为进程内内存，不持久化；权限与网络限额仍由宿主代理负责。

## 来源与许可

实现参考 `spacelibres/solarsystem` 固定提交 `4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db` 的自研 TypeScript 行为，按该仓库 `package.json` 的 MIT 声明使用并保留署名。该仓库没有根 `LICENSE` 文件，此缺失记录为风险；`eyes/` 恢复源码与 NASA 夹具不在复用范围。详见 [NOTICE.md](NOTICE.md) 与 [P04 规范](../../docs/P04参考DYN来源核验与黄金样本规范.md)。
