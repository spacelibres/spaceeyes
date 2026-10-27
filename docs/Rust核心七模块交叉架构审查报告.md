# Rust核心七模块交叉架构审查报告

版本：0.0.0｜状态：审查草案（待负责人批准）｜日期：2026-10-27
范围：Rust核心总规范及Scene、Spatial、Time、Simulation、Rendering、Resources、Core Protocol七份专项规范。
方法：GitHub规划分支文档静态交叉比对；未运行Rust、WASM、Proto编译或浏览器测试。

## 1. 总体结论
核心分层原则一致：Rust统一核心、单一Scene和SimulationClock、领域插件隔离、Proto公开交换、Rendering只读快照、Resources统一所有权。当前不能冻结：多个关键接口和事务语义仍未决，尚未形成可验证的依赖矩阵与Schema。

## 2. 审查发现与整改建议
| ID | 优先级 | 发现/依据 | 建议责任边界 | 状态 |
|---|---|---|---|---|
| CR-01 | P0 | SceneSnapshot、SimulationSnapshot、Spatial修订和TimeGeneration各自定义，缺统一帧提交语义 | Engine组装一致FrameSnapshot；Simulation验证后单点发布；Rendering只读 | 待审 |
| CR-02 | P0 | Scene.apply_command、Simulation ResultCommitter、Engine CommandDispatcher职责可能重叠 | Engine统一命令入口；Scene负责自身事务不变量；Simulation只提交经验证的Scene命令 | 待审 |
| CR-03 | P0 | Time跳转增加generation，但连续播放任务结果何时失效不明确 | Time负责权威代次；Simulation负责请求时间/覆盖/代次联合校验；缓存复用与状态提交分离 | 待审 |
| CR-04 | P0 | Simulation BudgetController与Resources ResourceBudget、Rendering GPU预算交叉 | Simulation控制任务调度配额；Resources控制资源所有权/字节预算；Rendering提供GPU实际消耗指标 | 待审 |
| CR-05 | P1 | Scene ParentId与Spatial FrameId已区分，但Frame撤销与对象关系待定 | Spatial发布Frame失效事件；Scene依命令处理关联对象，不隐式删除 | 待审 |
| CR-06 | P1 | CameraSystem既是渲染状态又可能受UI/场景控制 | 相机逻辑状态归属须确定；Renderer只生成视图矩阵；相机命令走统一入口 | 待审 |
| CR-07 | P1 | Proto模块已列出，但TimeInstant、ID、错误码、oneof字段未冻结 | 先审科学时间/身份语义，再编写Schema与双语言契约测试 | 待审 |
| CR-08 | P1 | WASM/Native接口形态仅概念化 | 平台适配只负责启动/设备/传输；Rust领域核心与协议语义完全共享 | 待审 |
| CR-09 | P1 | ResourceHandle公开引用与内部代次句柄语义易混 | 公开ResourceId与受控租约标识；内部句柄仅在Rust进程有效，跨运行环境不传裸槽位 | 待审 |
| CR-10 | P1 | 插件提供的Frame变换、星历结果的来源版本与授权界限未形成统一校验 | 宿主鉴权，协议适配校验，Simulation验证时间/来源，Scene最终执行不变量 | 待审 |
| CR-11 | P2 | 核心总规范中的箭头图是职责示意，不能当作crate依赖图 | 编制crate DAG，禁止渲染反向依赖Simulation、资源反向依赖Rendering | 待审 |
| CR-12 | P2 | 各专项验收列出案例但缺统一测试证据编号 | 建立C0设计审查矩阵及C1-C5测试追踪表 | 待审 |

## 3. 建议的无环依赖方向（待审定）
foundation → time/spatial/resources → scene → simulation → engine；rendering依赖foundation、只读快照类型和resources接口，不直接依赖simulation可变状态；protocol-adapter依赖公开engine facade与生成的Proto类型；wasm/native只依赖adapter/engine及设备适配。此处箭头表示基础模块被上层使用，具体crate拆分仍待批准。

重要：Spatial可能需要时间值类型，但不应反向拥有SimulationClock；Scene可以保存FrameId，不应反向依赖Spatial的可变图实现。可将跨模块只读值类型放在foundation，避免循环依赖。

## 4. 建议的统一提交链
Host授权命令 → ProtocolAdapter解码校验 → Engine CommandDispatcher → Time/Simulation计算与结果验证 → Scene受控事务提交 → Engine生成含Time、Scene、FrameGraph修订的一致FrameSnapshot → Rendering只读消费。资源句柄通过Resources校验；任务结果过期不得进入提交链。

此链为建议，尚未批准；批量原子性、事件顺序、相机状态归属和部分可用数据展示仍需ADR。

## 5. 必须形成的ADR
ADR-001 单权威提交者与FrameSnapshot一致性；
ADR-002 CommandDispatcher/Scene事务职责；
ADR-003 TimeGeneration与连续播放结果有效性；
ADR-004 Simulation/Resources/Rendering预算与所有权；
ADR-005 ObjectId、FrameId、ResourceId与句柄边界；
ADR-006 时间尺度、历元、单位；
ADR-007 相机状态与渲染职责；
ADR-008 WASM/Native适配及Proto边界。

## 6. 阶段门
C0-1：全部P0有明确ADR及批准状态。
C0-2：crate依赖图无环，模块公开接口职责唯一。
C0-3：Proto关键语义冻结并形成Rust/TS契约测试计划。
C0-4：NASA Eyes首期相机/时间/场景/星历接口可以通过模拟数据闭环设计验证。
C0-5：AI未来仅依赖SDK/技能书，不需直接修改Rust核心。

未满足以上条件前不得宣称设计冻结；本报告不代表代码实现或测试通过。

## 7. 当前结论
12项发现：P0四项、P1六项、P2两项。均为待审设计缺口或职责重叠风险，不是已证实的运行缺陷。项目统一版本继续保持0.0.0。