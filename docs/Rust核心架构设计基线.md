# SPACEEYES Rust核心架构设计基线

版本：0.0.0｜状态：整体架构基线已批准｜日期：2026-10-27
阶段：纯Markdown架构规划；本文件是导航与决策索引，不取代专项规范，不表示已进入代码开发。

## 1. 产品与技术定位
首期优先复现NASA Eyes类太阳系三维探索体验；最终目标是大模型依据版本化SKILL.md与公开SDK自主开发受控插件。Rust为唯一核心源码，WASM和Native为不同编译目标；Web界面采用Next.js/React/TypeScript，可通过服务器浏览器或本地访问。NASA Dynamo解析属于未来独立插件，不嵌入Rust核心；外部DYN可直接解析，公开结构化数据交换统一使用Protobuf。

## 2. 已批准设计约束
ADR-001：Engine统一提交者与FrameSnapshot一致发布。
ADR-002：Engine唯一公开命令入口，Scene负责事务。
ADR-003：TimeGeneration与目标时刻、数据覆盖联合校验。
ADR-004：Simulation任务预算与Resources资源所有权分离。
ADR-005：公开ID与内部代次句柄分离；场景父子关系不同于参考系。
ADR-006：时间尺度、历元与单位必须显式；具体TT/TDB/J2000解释仍未冻结。
ADR-007：相机持久逻辑状态通过Scene受控命令，Renderer仅派生视图。
ADR-008：WASM/Native共享Rust核心与Proto语义。
ADR-009：模块依赖单向、无环、职责可追溯。
批准依据：docs/ADR-APPROVAL.md；详细决策：docs/Rust核心跨模块ADR整改方案.md。

## 3. 设计文档导航
| 类别 | 文件 | 状态 |
|---|---|---|
| 总体 | 太空之眼平台架构书.md | 规划基线 |
| 总体 | Rust核心引擎设计规范.md | 设计草案 |
| 核心01 | Scene场景系统与对象模型设计规范.md | 设计草案 |
| 核心02 | Spatial空间与参考系系统设计规范.md | 设计草案 |
| 核心03 | Time仿真时间系统设计规范.md | 设计草案 |
| 核心04 | Simulation仿真任务调度系统设计规范.md | 设计草案 |
| 核心05 | Rendering三维渲染系统设计规范.md | 设计草案 |
| 核心06 | Resources统一资源管理系统设计规范.md | 设计草案 |
| 核心07 | Core-Protocol统一核心协议设计规范.md | 设计草案 |
| 深化08 | Rust核心对象模型与接口详细设计规范.md | 设计草案 |
| 深化09 | Proto数据结构与消息字段设计规范.md | 设计草案 |
| 深化10 | 命令查询事件与错误处理设计规范.md | 设计草案 |
| 深化11 | Rust工程目录与模块依赖设计规范.md | 设计草案 |
| 深化12 | 核心生命周期与状态快照设计规范.md | 设计草案 |
| 决策 | Rust核心跨模块ADR整改方案.md、ADR-APPROVAL.md | ADR已批准 |
| 治理 | 项目文档与版本规范.md、CHANGELOG.md | 规划规则 |
| 后续 | NASA-Dynamo-插件设计规范.md | 未来插件设计，不实施 |

全部路径除CHANGELOG.md外均相对于docs/目录。当前不新增独立验证报告或工程测试文件。

## 4. 核心职责基线
Engine：会话、命令协调与FrameSnapshot发布。
Scene：对象身份、组织、场景权威状态和事务。
Spatial：FrameId、参考系图和变换组合。
Time：唯一SimulationClock、播放状态、时间代次。
Simulation：任务调度与异步结果校验，不直接写Scene。
Rendering：只读一致FrameSnapshot、相机派生视图与GPU绘制。
Resources：资源ID、租约、配额、释放与恢复的唯一权威。
ProtocolAdapter：Proto校验、领域映射，不持有第二套状态。

## 5. 三类快照
SceneSnapshot是Scene局部只读视图；FrameSnapshot由Engine原子发布供Rendering使用；ProjectSnapshot用于持久化和项目恢复，不保存GPU指针、内部句柄或执行栈。Paused是Time播放模式，不是Engine生命周期。资源缺失与引擎故障状态必须区分。

## 6. 协议与模块依赖
公开Command、Query、Response、Event、Resource、Snapshot使用单一Proto契约；Rust内部领域对象不等于Proto生成对象。foundation为底层值类型；time/spatial/scene/resources在其上；simulation协调公开接口；rendering依赖只读快照与资源接口；engine组装；protocol-adapter及wasm/native为外层适配。禁止反向依赖与第二套权威状态。

## 7. 仍属于设计候选的事项
- 核心科学时间尺度、历元零点与NASA DYN时间对应关系。
- Proto正式字段编号、兼容细节与Schema冻结。
- GPU后端、跨尺度深度方案与性能策略。
- 多视口相机归属与跟随策略。
- ProjectSnapshot增量保存、恢复降级与资源来源策略。
- 具体Cargo包名、feature组合、快照共享布局。
这些尚未批准，不因本基线整理而自动冻结；不在文档阶段执行编译、运行或数据验证。

## 8. 文档优先级与变更纪律
已批准ADR高于冲突的旧草案文字；专项规范负责各领域细节；本文件只做导航与状态汇总，不创设新的技术规则。发现矛盾直接修订原专项文档，并更新CHANGELOG.md。全部受控版本保持0.0.0；正式版本按最小位递增、100进1。

## 9. 阶段结论
第01至12阶段专项草案已编制，第13阶段完成一轮直接文档整改，第14阶段完成设计基线索引整理。九项ADR已批准，但整体核心架构设计基线已于2026-10-27获项目负责人批准。批准仅确立设计依据，不自动启动代码开发或改变版本号。没有创建Rust工程、.proto文件或运行测试。


## 10. 正式批准记录
批准日期：2026-10-27。项目负责人明确批准SPACEEYES整体核心架构设计基线。已批准的ADR-001至ADR-009继续有效；未冻结的具体技术选型仍按本文件第7节管理。批准不等于代码实现、测试通过或正式软件发布。本次批准保留统一版本0.0.0；首次代码开发版本0.0.1须在正式启动时统一升级所有受控成果，并同步CHANGELOG.md。
