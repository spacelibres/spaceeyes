# NASA Dynamo 官方插件 001 · 接口与验收定义

版本：0.0.1｜状态：设计草案｜日期：2026-10-27  
插件ID：`spaceeyes.nasa.dynamo`  
依据：`docs/NASA-Dynamo-插件设计规范.md` 与 `spacelibres/solarsystem` 现有 Dynamo/ephemeris/runtime 代码。

## 1. 职责与边界

这是SPACEEYES首个官方数据源插件，首期TypeScript实现。负责按需获取、解析、分段管理、缓存和求值NASA Eyes Dynamo v1/v2文件。通过宿主授权SDK返回规范化星历状态，不直接修改Rust Core、场景对象、时钟或渲染器。NASA在线数据不可用时必须报告错误，不伪造有效状态。

## 2. 模块与对象

| 对象 | 职责 | 关键接口（设计名称，尚未冻结） |
|---|---|---|
| `DynamoPlugin` | 生命周期与能力注册 | `activate/deactivate` |
| `NasaDynamoProvider` | 受控网络获取 | `fetchController/fetchSegment` |
| `DynamoParser` | 纯二进制解析 | `parseIndexOrInline/parseSegment` |
| `DynamoSegmentManager` | 有效时间窗、分段选择 | `resolveWindow` |
| `EphemerisEvaluator` | 五类点时间求值 | `evaluate` |
| `DynamoCache` | 缓存、取消、失效 | `get/evict/dispose` |
| `DynamoDataAdapter` | 领域状态到Proto | `toProtoState` |

## 3. DYN数据契约

- 小端二进制；版本1/2；类型 `orb` 72B、`pos` 56B、`lin` 32B、`ori` 64B、`quat` 40B。
- 头部包含版本、NUL终止类型、v2分段数字宽度；orb还包含两个引力参数。
- 内联点与分段索引均支持；分段文件不重复主文件头。
- 四元数磁盘顺序为w,x,y,z；解析后必须按命名分量使用。
- 不能无条件排序、合并或跨冲突时间点插值；须保留源记录序号及原始选择语义。
- 原始数据时间单位/零点、参考系和父级关系须通过来源元数据明确标注，不得猜测或静默默认。

## 4. 公开能力（候选）

`ephemeris.getState`：输入对象ID、仿真时间、参考系标识及可选数据来源；输出带状态的规范化位置/速度或姿态/角速度、来源、有效区间与错误码。

`dynamo.getCoverage`：查询实际有效时间范围和缺口。

`dynamo.getSourceInfo`：查询原始路径、格式版本、来源、校验摘要及许可状态。

公开请求/响应采用版本化Protobuf消息，具体字段与时间零点需在Proto规范审定后冻结；内部直接使用DYN，不强制离线转换成Proto文件。

## 5. 权限与运行环境

默认只允许访问经宿主授权的NASA Eyes数据域名；使用宿主网络代理，明确超时、并发、缓存上限和取消。插件停用时取消任务、注销能力、释放缓存资源。插件版本和宿主/SDK/Proto兼容范围分别声明。未知许可的数据不得打包再分发。

## 6. 测试与验收（待实施）

1. 使用现有真实DYN黄金样本验证五类记录及v1/v2/分段结构；缺少样本的类别标记待验证。
2. 与`solarsystem/src/solar/domain/ephemeris.ts`同输入同时间对照，覆盖端点、重复时间、跨段、缺失数据、姿态和轨道。
3. Rust/TS Proto生成类型往返一致；对象ID、时间尺度、参考系、单位与来源不丢失。
4. 网络失败、404、超时、截断、非法长度、异常数据不产生ready状态。
5. 停用、取消和缓存释放有自动测试；插件不调用Rust私有API。
6. 通过SDK查询地球/月球/木星适用数据，并记录参考样本和误差容限。

## 7. AI开发技能书

发布本插件前必须提供`SKILL.md`，描述能力发现、API调用、输入输出单位与参考系、授权、错误处理、示例、反例和验收。AI未来开发木星卫星等插件时调用公开星历能力，不自行解析DYN，也不能绕过权限。

## 8. 当前状态

这是第一个官方插件的**定义文档**，尚未实现插件包、冻结Proto Schema或通过运行测试。本段原为0.0.0规划阶段记录；当前项目受控版本为0.0.1，插件仍未实现。


> 版本同步记录（2026-10-27）：受控文档版本升级至0.0.1，原批准事实与规划历史保持不变；NASA插件仍未进入实现。
