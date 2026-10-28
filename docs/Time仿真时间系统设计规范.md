# Time仿真时间系统设计规范

版本：0.0.1｜状态：待审定设计草案｜日期：2026-10-27  
设计阶段：03｜归属：Rust Core｜不包含实现代码  
上位规范：`docs/Rust核心引擎设计规范.md`  
依赖规范：`docs/Spatial空间与参考系系统设计规范.md`

## 1. 设计目标与非目标

Time模块管理唯一权威仿真时刻、播放状态、跳转、固定逻辑步长、代次与不可变时间快照。它不读取NASA DYN、不做轨道求值、不直接控制渲染帧率、不调用浏览器系统时间，也不承担天文领域的全部时间尺度转换算法。具体TT/TDB/UTC换算的科学规则与历表由受控领域能力提供，核心定义明确的契约和转换边界。

## 2. 时间概念与不变量

- `SimulationInstant`：仿真时刻，必须包含时间尺度和明确历元；表示方式待审定，禁止无单位裸数。
- `ElapsedRealTime`：宿主提供的单调真实经过时间，不等于墙上时钟日期。
- `SimulationDuration`：仿真持续时间，可正可负；单位明确。
- `PlaybackRate`：仿真秒/真实秒，可为负、零、正；必须有限且在策略范围内。
- `TimeGeneration`：跳转、实时模式切换及时间源重置时递增的任务代次，旧结果不得覆盖新代次。
- `TimeSnapshot`：不可变的时刻、模式、速率、步进设置、修订号与代次。
- **唯一权威**：每个仿真会话仅有一个SimulationClock，Scene/Spatial/Simulation/Rendering都消费其快照。

## 3. 面向对象模型（候选）

| 对象 | 职责 | 公开行为候选 |
|---|---|---|
| `SimulationClock` | 时间权威状态与生命周期 | `snapshot`, `apply_command`, `advance` |
| `TimeController` | 解释播放/暂停/跳转/实时命令 | `play`, `pause`, `seek`, `set_rate`, `live` |
| `TimeStepper` | 将真实经过时间转换为逻辑步进 | `accumulate`, `steps` |
| `TimeGeneration` | 防止旧异步结果生效 | `current`, `invalidate` |
| `TimeSnapshot` | 向其他模块提供只读一致时间 | `instant`, `mode`, `revision` |

这些是职责划分，不要求全部实现为独立持有状态的对象；唯一可变权威状态属于SimulationClock。

## 4. 时间尺度与表示

推荐核心时间表示为明确的整数刻度加时间尺度标识（如`seconds + subsecond`或整数纳秒/微秒），避免依赖JS Date和浮点大数在长时间范围上的精度损失；**整数范围、历元零点及最终采用TT或TDB作为核心规范时间尚待审定**。现有solarsystem/DYN代码的J2000秒约定必须经实测确认，不能直接当作核心默认时间。UTC输入涉及闰秒，不能只按固定偏移换算；科学精度与有效日期范围由时间转换能力声明。

## 5. 时钟状态机

候选模式：`Paused`、`Playing`、`Live`。Playing可使用正负速率；速率0可规范化为Paused，但是否保留上次速率需审定。Live表示由宿主提供的时间源校准，不允许核心自行访问系统时钟；离线或时间源不可用时必须显式降级/暂停。

命令：`Play(rate)`、`Pause`、`Seek(instant)`、`SetRate(rate)`、`SetLive(enabled)`、`Step(duration)`、`Reset(instant)`。所有命令经统一校验、顺序提交、结构化错误返回；命令重试使用请求ID确保幂等。

## 6. 固定步进与渲染分离

宿主传入单调的`elapsed_real`；TimeStepper按播放速率累计仿真时长，产出零个或多个逻辑步进；Rendering可按独立帧率读取最新有效快照。固定步长、每帧最大补步数、积压时间处理策略、超大倍速时的跳跃/重采样模式均需在性能原型后审定。不得通过无上限循环追赶时间，也不得让网络星历请求阻塞渲染。

## 7. 跳转、反向与异步结果

Seek/Reset/Live源切换增加`TimeGeneration`，清理或标记旧任务失效。异步结果需带`generation`、`requested_instant`、数据有效区间与来源版本；宿主/调度器只接受符合当前代次及时间策略的结果。反向播放不自动反向积分不可逆模型；领域插件必须声明是否支持反向采样、逆积分或仅查询历史星历。数据超出覆盖范围返回`out-of-range`，禁止外推冒充有效结果。

## 8. 与其他核心模块的关系

- Scene：状态快照关联TimeSnapshot的修订号，不能维护第二个时钟。
- Spatial：所有时间相关变换必须明确输入SimulationInstant，不读取隐式当前时刻。
- Simulation：在Time提供的逻辑步长和代次下调度，不自行决定权威时间。
- Rendering：消费最新完整有效状态，不驱动时间推进。
- Proto Adapter：将外部时间命令与内部领域对象映射，校验时间尺度、历元、单位和版本。
- 插件宿主：负责提供单调elapsed及必要的墙上时钟校准来源；插件不能直接篡改时钟。

## 9. 错误和审计

至少区分：非法时间尺度、历元不支持、时间超范围、非有限倍速、超出倍速限制、时间源不可用、命令重复、过时代次、步进预算耗尽、数据缺口。事件记录命令ID、前后时刻、代次、模式与修订号，便于复现与调试。

## 10. 最小验收矩阵

| 测试 | 预期 |
|---|---|
| 暂停后advance | 仿真时刻不变，渲染仍可运行 |
| 正向/反向速率 | 相同输入产生可重复时刻序列 |
| Seek后旧任务返回 | 旧generation不能覆盖新状态 |
| 时间源切换 | 代次递增，旧请求失效 |
| 超大真实经过时间 | 有界步进或显式跳跃，不无限循环 |
| 非有限速率/非法时刻 | 拒绝且不改变状态 |
| 跨JS/Proto/Rust往返 | 时间尺度、历元和精度不丢失 |
| NASA Eyes时间轴 | 日期跳转、暂停、倍速、反向与星历有效区间正确联动 |

目前没有Rust实现或测试通过记录。

## 11. 待审定决策

1. 内部规范时间尺度：TT、TDB还是其它带转换边界的统一表示。
2. 内部时间整数精度与零点、表示范围。
3. Live模式校准策略及时间源失效行为。
4. 负速率与暂停的状态机细节。
5. 固定步长、积压预算和超大倍速策略。
6. 时间代次失效的准确触发条件及与Scene修订号的关系。
7. 外部UTC、J2000与DYN时间约定的验证方法。

**状态：设计草案；没有编写引擎代码。**


## 12. 交叉审查整改对齐（待审）
TimeGeneration在Seek、Reset、Live源切换和语义重置时递增，连续播放不逐帧递增。异步结果除generation外还必须核对目标时刻和coverage。TimeSnapshot参与Engine一致FrameSnapshot。TT/TDB及J2000零点仍需科学验证，不得默认。


> 版本同步记录（2026-10-27）：本受控文档随首次Rust核心开发启动统一升级至0.0.1；历史规划说明及原始批准日期保留为历史记录。实际实现范围以CHANGELOG.md为准。

## 13. 0.0.1基础播放推进迭代

本轮在已批准的唯一时钟与显式单位边界内增加 `SimulationClock::advance_nanos(elapsed_nanos: u64)`，由宿主传入非负单调经过时间，核心不读取系统时钟。当前只支持1倍速连续推进；Paused模式及零经过时间不改变时刻、修订号或代次，Playing模式按整数纳秒推进一次。溢出拒绝且保留原状态。该接口不取代可正可负、与播放状态无关的 `step_nanos`。

Engine提供同名唯一协调入口；Ready状态允许初始化时间操作，Stopped拒绝，成功改变时钟修订时仅增加一次快照序列。连续推进不增加TimeGeneration；已有任务在接受结果和最终提交时仍须核对目标时刻。此迭代不冻结倍速、Live、固定补步、积压策略、科学尺度或历元零点，也不新增Proto命令。验收覆盖暂停、播放、零时长、累加一致性、溢出原子性、Engine关闭及过期任务提交。

## 0.0.1有理倍速与有界固定步进
基础倍速使用显式有理数PlaybackRate（有符号分子绝对值不超过1000000、正分母不超过1000000），避免浮点经过时间累计误差；零速率保持Playing但不推进，Pause另行控制。默认1/1，负速率支持反向采样，不承诺逆积分。改变倍速、Seek和显式Step清理不足一纳秒的余数，连续advance保留有符号余数，失败不改变任何状态。Proto double倍速入口仅接受能精确表示为百万分之一的值，否则拒绝，不静默近似科学时刻。Live尚需宿主时间源协议，不把空Live命令当作系统时钟授权。
独立FixedStepper使用显式正步长和每次最大步数，将宿主经过时间累加成有界步数；保留积压并报告，禁止无界追赶。其配置由调用者传入，不冻结全局性能阈值；不拥有或修改权威SimulationClock。

## M2-4 浏览器时间交互（0.0.1开发增量）
浏览器经既有time.set_rate/step/seek提交命令，不维护第二套时钟。倍速修改不自动播放；步进和跳转仅在暂停时启用，并在串行处理时重查Rust模式。十进制秒输入相对当前显式历元，最多64字符/9位小数，用BigInt无损映射sint64秒与[0,1e9)纳秒，拒绝科学计数法及溢出；沿用Rust当前timeScale/epochId，不做UTC猜测。显示负小数时按总纳秒符号格式化，不把floor秒直接拼接纳秒。操作完成须重新查询核心；非法输入或预期拒绝不得停止会话或伪造成功。步进/跳转清除旧选择；Seek代次变化由核心保持唯一权威。本增量不是科学时间轴或Live功能。

## M1a Rust科学时间实现（0.0.1，2026-10-28）

按《核心与宿主职责边界规范》，时间尺度换算属于Rust核心，宿主不得实现。全部实现位于`crates/time`的`science`子模块（2026-10-28由独立`astro` crate迁入，时间只保留在`time`）：

- **表示**：TAI/TT/TDB均以J2000事件为零点的`i128`纳秒保存，`TimeInstant`传输出口为`(scale, epoch="J2000", i64秒, u32纳秒)`；floor分解，负时刻不丢精度。TT与TAI同速率，32.184s常量由历元定义吸收，不能把两者的相对计数差当作TT−UTC。
- **UTC**：严格公历校验；闰秒表从1972-01-01（TAI−UTC=10s）到2017-01-01（37s），之后按预测处理并显式标记；支持23:59:60，普通日拒绝60秒；UTC范围1972-01-01..=2100-12-31，范围外`UtcOutOfRange`，不静默近似。
- **TT−UTC**：由`(TAI−UTC)+32.184s`给出，1972年为42.184s、2017年起为69.184s，作为UI/来源展示的显式值，不用于反向推导。
- **TDB**：两项周期近似（`0.001657 sin g + 0.00001385 sin 2g`，g按TT日数），仅作传输/显示模型，测试限定约±1.8ms；反向用不动点迭代到≤1ns。正式科学误差定标仍需完整模型与JPL/SPICE对照，不把近似当最终精度。
- **测试与边界**：8项单元（日历往返、闰秒表、预测标志、TDB幅度）+12项集成（J2000零点、2016闰秒逐秒、普通日86400s、往返、TT/TDB反演、TimeInstant、范围双向、非法字段、ISO8601、预测标志）。全部Rust测试，不含TS科学实现。

仍待M1b：Proto只读换算查询、能力发现/SDK、浏览器UTC日期轴与输入；仍待M4：真实来源/覆盖与误差对照。Live模式与固定步长接入宿主调度仍未实现，不以本增量宣称完整科学时间轴。


## M1b 时间换算公开契约与浏览器UTC轴（0.0.1，2026-10-28）

`time.proto`新增`UtcDateTime`、`TimeConversionQuery`、`TimeConversion`，`QueryEnvelope.time_conversion=32`、`ResponseEnvelope.time_conversion=23`，能力`query.time_convert`（总数41）。输入可为UTC日历或TAI/TT/TDB显式`TimeInstant`（epoch必须J2000，裸UTC拒绝）；输出UTC日历、TAI/TT/TDB、TT−UTC与预测标志。全部换算在Rust `spaceeyes-time`；查询只读、不推进时钟/代次、不写事件、不消耗命令历史，错误`INVALID_ARGUMENT`且不改变状态。

浏览器把初始会话改为`TDB`+`J2000`（与DYN的ET约定对齐），会话状态刷新时调用换算查询显示UTC；用户输入ISO UTC文本时，TypeScript只解析为字段并交给Rust换算，再用返回的TDB `TimeInstant`执行`time.seek`。TS不做闰秒、历法或TDB计算。仍待：完整科学误差定标、来源/覆盖面板、Live与固定步长接宿主。

## UTC 连续化：2027-05-20 起取消闰秒（2026-10-28 增补）

国际计量大会（CGPM）第 28 届会议于 2026-10-15 通过 Resolution 5（DOI 10.59161/CGPM2026RES5E），决定实施**连续 UTC（continuous UTC）**：自 **2027-05-20（世界计量日）** 起不再插入闰秒；UTC 与 UT1 的最大允许偏差改为 **3600 秒（1 小时）**，未来以“闰时（leap hour）”而非闰秒调整。此前 2022 年第 27 届 CGPM 曾要求“不晚于 2035 年”取消闰秒，本次决议把生效日期提前到 2027 年。1972 年以来已实施的 27 次正闰秒保留在历史中，因此 2027-05-20 之后 `TAI − UTC` 固定为 37 秒，直到数千年尺度上可能出现的一次闰时。

核心实现（`crates/time`的`science`子模块）：

- `UtcRegime` 三态：`Observed`（表内已观测）、`Predicted`（2027-01-01 至 2027-05-19 的短预测窗）、`Continuous`（2027-05-20 起）。
- `UTC_CONTINUOUS_FROM_DAY`/`UTC_CONTINUOUS_FROM_YEAR|MONTH|DATE` 与 `LEAP_HOUR_SECONDS=3600` 为显式常量；连续 UTC 之后 `is_leap_day` 恒为 false，`delta_at_day` 保持 37。
- 闰秒表不再扩展；2027 年后日期不得再报“预测闰秒”，也不得把 3600 秒闰时当成已实现。闰时属于未来标准，本版本不建模。
- 旧闰秒历史（1972–2016 的 27 次）必须保留：`23:59:60` 只在这些历史闰日有效，不能因为新标准删除历史数据。
- 飞行/星历侧不受影响：DYN/TDB 使用 TDB+J2000 连续时标；UTC 只用于显示、输入与来源面板。TT−UTC 在 2027-05-20 后为 69.184 秒。

Proto 在 `TimeConversion` 增加 `UtcRegime utc_regime=7`（OBSERVED=1、PREDICTED=2、CONTINUOUS=3），浏览器据此显示“连续 UTC，2027-05-20 起无闰秒”；`predicted` 字段保留为兼容布尔值，只在短预测窗为 true。

参考：BIPM 第 28 届 CGPM 决议页 <https://www.bipm.org/en/cgpm-2026/resolution-5>；IANA tz 讨论确认生效日 2027-05-20 <https://lists.iana.org/hyperkitty/list/tz@iana.org/thread/FVMU4ZJROJCCJ7IWT6VNE2KEUIO7EPTB/>；中国科学报/中国科学院转载 <https://www.cas.cn/kj/202610/t20261019_5122458.shtml>。
