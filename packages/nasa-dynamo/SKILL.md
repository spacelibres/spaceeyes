# SPACEEYES NASA Dynamo 插件技能书

版本：0.0.1｜状态：纯数据源核心；宿主代理与权限执行未接入

本技能书面向使用或生成 `spaceeyes.nasa.dynamo` 插件的开发者与 AI。插件按架构书 §15 作为独立 TypeScript 数据源存在，不得把 DYN 解析写入 Rust Core，也不得自称已通过真实星历科学验收。

## 能力

- `ephemeris.window`：解析内联 `.dyn` 或索引文件，返回头、点、分段与覆盖区间；
- `ephemeris.evaluate`：在显式 ET 时刻求值，返回位置/速度或姿态/角速度，或明确不可用；
- `DynamoSegmentLoader`：宿主注入 transport，只取覆盖段，有界 LRU 与取消；
- 五类点：`orb`、`pos`、`lin`、`ori`、`quat`；
- 索引与分段：版本 1 显式终点；版本 2 由下一段起点闭合，末段开放；
- 重心选择：省略 `body` 为相对父级，`body=1`/`2` 使用头部 GM 的质量比。

## 单位与时间

- 时间：秒；历元与时间尺度由宿主显式提供。不得把字符串标签当作 TT/TDB/UTC 换算已完成。
- 位置：km；速度：km/s；角速度：rad/s；角度：rad；GM：与 km³/s² 一致的输入，插件不换算。
- 四元数：文件中 W 在前（`w, x, y, z`），API 使用具名分量。

## API

```ts
import {
  NasaDynamoPlugin,
  evaluateEphemeris,
  windowFromFile,
  type EphemerisSource,
} from "@spaceeyes/nasa-dynamo";

const plugin = new NasaDynamoPlugin();
const manifest = plugin.manifest; // 声明式能力、权限与上限
const file = plugin.loadFile(bytes, source); // 失败抛 RangeError/DynParseError
const state = plugin.evaluate(file, timeEt, { body: 1 });
```

直接使用函数：

```ts
const window = windowFromFile(file.header, file.points, file.interval, source);
if (window !== null) {
  const state = evaluateEphemeris(window, timeEt);
}
```

索引文件没有内联点，必须由宿主按 `file.segments` 获取对应分段并使用 `parseDynSegment`/`plugin.loadSegment`。也可直接使用 `DynamoSegmentLoader`：

```ts
const loader = new DynamoSegmentLoader(
  { fetchBytes: (path, signal) => hostProxy.fetch(path, signal) },
  { maxCacheEntries: 64, maxSegments: 4096 },
);
const loaded = await loader.load(path, timeEt, signal);
```

## 错误与不可用

- 解析：`DynParseError`（版本、类型、计数、字节数、分段表）或 `RangeError`（截断、名称非 ASCII、超限）。
- 求值：`{ status: "unavailable", reason }`
  - `out-of-range`：超出窗口或样本覆盖；不推断。
  - `invalid-samples`：少于两点、重复/乱序时间、非有限值、零四元数、非法质量比。
  - `unsupported-orbit`：抛物线、非正半长轴、非收敛等。
- 加载：`DynamoLoadError.code` 为 `fetch-failed`、`invalid-data`、`no-data` 或 `aborted`；不隐式重试。
- 查询端点允许；末样本选择最后区间；内部样本选择其后区间。

## 权限与限制

- 网络：仅声明 `https://eyes.nasa.gov`，必须经宿主权限代理，本包不发起请求。
- 单文件/分段上限 16 MiB；源路径 1–512 字符；分段标签最多 128 字符。
- 不得读取核心私有状态、不得把插件结果当作场景/时钟权威、不得绕过宿主授权。
- NASA 数据与恢复源码不随本包分发；真实夹具只允许贡献者本地差分。

## 验收

1. `npm test --workspace @spaceeyes/nasa-dynamo` 通过合成样本；
2. 解析 v1/v2、五类点、索引/分段、重复/乱序/截断/零四元数拒绝；
3. 求值覆盖 Hermite、线性、SLERP、ori 投影、orb 椭圆/双曲线与重心因子；
4. 接入宿主后补权限负向、停用清理、网络失败与真实样本差分，未执行不得声称通过。
