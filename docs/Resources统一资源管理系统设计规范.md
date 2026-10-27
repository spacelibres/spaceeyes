# Resources统一资源管理系统设计规范

版本：0.0.1｜状态：待审定设计草案｜日期：2026-10-27
设计阶段：06｜归属：SpaceEyes Rust Core｜仅设计，不编写实现代码
依据：Rust核心、Scene、Spatial、Time、Simulation、Rendering专项规范。

## 1. 目标与边界
Resources提供唯一权威资源登记、所有权、代次句柄、配额、共享、异步加载、取消、淘汰、释放及恢复语义。覆盖CPU内存对象、纹理/网格/缓冲等GPU资源及受控外部数据句柄。它不解析NASA DYN、不决定天体业务数据、不执行GPU绘制、不授予插件权限，也不实现网络认证。宿主负责网络和插件权限，Rendering负责具体GPU设备适配。

## 2. 强制原则
- 统一ResourceManager，不允许Scene、Simulation、Rendering各自维护冲突的资源所有权。
- Rust以struct/impl/trait与组合进行模块化、面向对象封装。
- ResourceId是公开逻辑标识；ResourceHandle含槽位与代次，防止释放后旧引用命中新资源。
- 资源必须有明确所有者、使用者、生命周期和释放路径；共享不等于多重最终所有权。
- 对外资源命令/元数据采用版本化Proto；内部大块CPU/GPU缓冲通过受控句柄传递。
- WASM与Native共享资源语义，但实际GPU、文件和线程适配可不同。
- 资源失败不允许静默伪造已加载状态。

## 3. 核心对象模型（候选）
| 对象 | 职责 |
|---|---|
| ResourceManager | 生命周期总入口、所有权与配额协调 |
| ResourceRegistry | ID/句柄/代次/状态登记 |
| ResourceDescriptor | 类型、大小、来源、重建信息、校验摘要 |
| ResourceOwner | 明确逻辑所有者及释放责任 |
| ResourceLease | 临时使用权，释放后不可继续访问 |
| ResourceBudget | CPU/GPU/任务/缓存额度与背压 |
| ResourceLoader | 受控异步加载、取消、超时 |
| ResourceCache | 共享内容寻址缓存、LRU等候选淘汰策略 |
| ResourceRecovery | 设备代次变化、可恢复资源重建 |
| ResourceSnapshot | 只读占用、状态和统计 |

以上为逻辑职责，不要求每项独立crate。

## 4. 生命周期与状态
候选状态：Declared → Loading → Ready → Evictable → Released。
异常状态：Failed、Cancelled、Invalidated、Recovering。
注册资源不代表已加载；异步加载成功前不得发布Ready。资源取消尽力而为，迟到结果必须检查加载代次和所有者有效性。释放要求幂等；同一资源共享使用时，最后使用者释放租约不自动等于删除持久化缓存内容，淘汰策略另行决定。

## 5. 句柄、所有权与引用
- ResourceId用于公开引用和持久化，ResourceHandle用于内部快速访问；禁止持久化裸内存地址或GPU指针。
- 每次槽位复用递增代次；过期句柄返回InvalidHandle。
- 所有权与租约分开：资源拥有者负责最终生命周期，消费者只能借用受控句柄。
- Scene对象删除后，必须释放其资源租约，但共享资源是否保留由ResourceManager决定。
- 插件停用时宿主撤销能力并释放其所有租约，不能直接销毁其他所有者共享资源。

## 6. 加载、缓存与背压
异步加载需声明请求ID、来源、资源类别、预估字节数、优先级、取消句柄与超时。CPU与GPU预算分别记录，队列有界；超额请求返回BudgetExceeded或按策略延迟。缓存键应包含内容摘要或来源版本、格式与解码参数；不以不稳定URL作为唯一长期身份。淘汰不得影响仍被租用的资源；预取可被取消，不得阻塞当前交互。

## 7. GPU设备丢失与恢复
Resources维护逻辑资源描述及GPU设备代次；Rendering的GPU适配器负责具体分配。设备丢失后旧GPU句柄全部失效；可重建资源按描述、CPU副本或授权来源重新创建；不可恢复资源显式Failed。恢复不能修改Scene科学状态。GPU资源恢复优先级、内存预算和设备兼容性由实测决定。

## 8. 与核心模块的关系
- Scene只存受控ResourceHandle/ResourceId，不直接拥有GPU分配器。
- Simulation只请求/释放资源并接收完成事件，任务结果需验证代次。
- Rendering使用GPU适配器和ResourceManager授予的租约，不自行建立第二套权威注册表。
- Time跳转可使时间相关资源失效，但不会无条件删除仍共享的静态资源。
- Spatial的科学参考系状态不应依赖GPU资源是否可用。
- Host负责网络、插件权限、文件访问和缓存许可审查。

## 9. Proto与错误
公开候选消息：ResourceRequest、ResourceDescriptor、ResourceHandleRef、ResourceStatus、ResourceRelease、ResourceError、ResourceStats。字段和Schema尚未冻结。错误至少包含InvalidHandle、OwnerNotFound、BudgetExceeded、LoadFailed、Cancelled、DeviceLost、NotRecoverable、UnsupportedFormat、PermissionDenied。资源状态事件应携带请求ID、资源ID、代次、所有者和错误原因。

## 10. 验收矩阵
| 场景 | 预期 |
|---|---|
| 释放后复用槽位 | 旧句柄失效 |
| 两对象共享纹理 | 一个对象删除不破坏另一个租约 |
| 插件停用 | 其租约与任务清理，不销毁他人共享资源 |
| 加载取消后迟到完成 | 不发布Ready，不泄漏 |
| 缓存超预算 | 淘汰未租用项或拒绝，不无限增长 |
| GPU设备丢失 | 旧设备句柄失效，可恢复资源重建 |
| 不可恢复资源 | 明确错误，不伪装成功 |
| Scene快照与资源 | 失效资源被安全处理 |
| WASM与Native | 所有权、代次和错误语义一致 |
| Proto跨语言往返 | ID、状态、来源与错误不丢失 |

## 11. 待审定事项
1. ResourceId编码、ResourceHandle位宽与代次溢出策略。
2. 租约/引用计数和异步加载的具体并发模型。
3. CPU与GPU预算层级及默认阈值。
4. 缓存淘汰、内容寻址和磁盘持久化边界。
5. GPU恢复资源描述与CPU副本策略。
6. 场景删除、插件停用和引擎关闭时的释放顺序。
7. 资源批量申请/释放的原子性。
8. ResourceManager与Rendering GPU适配器的依赖接口。

当前仅为设计规范，尚未实现Rust代码或运行测试。

## 12. 交叉审查整改对齐（待审）
Resources是ResourceId、租约、CPU/GPU字节配额和最终释放的唯一权威。Simulation仅管理任务队列与调度预算；Rendering负责GPU设备分配适配和占用上报。内部代次句柄不可跨进程持久化；插件权限由宿主鉴权。


> 版本同步记录（2026-10-27）：随首次Rust核心开发启动，本受控文档升级至0.0.1。历史规划记录不改写。


## 0.0.1实现进展（2026-10-27）
已实现基础ResourceManager，统一ResourceId登记、逻辑字节预算、共享租约计数、受保护释放与资源修订号；Engine通过受控入口访问Resources，并将资源修订纳入EngineSnapshot。当前为CPU逻辑资源登记模型，不包含GPU设备分配、实际资源加载、租约持有者身份、插件权限或代次句柄。以上属于阶段性代码进展，不代表完整资源生命周期实现。


## 0.0.1任务租约生命周期对齐
Engine为Simulation任务持有逻辑资源租约，在取消、过期、失败、提交成功与关闭时清理；ResourceManager仍控制资源注册和最终释放。当前租约基于计数，不是不可伪造的独立LeaseId；未来需进一步强化身份与代次，禁止将其当成最终安全模型。


## 0.0.1租约身份强化
ResourceManager新增不透明LeaseId，包含内部资源代次与唯一租约序列。每次注册同一ResourceId时递增代次，重复释放、旧租约释放及共享租约误释放均拒绝。Engine持有任务对应LeaseId而非裸ResourceId，保持Resources唯一所有权。租约目前仅进程内有效，不属于公开Proto凭证。

## 0.0.1受控CPU加载与对象租约
新增Declared/Loading/Ready/Failed/Cancelled状态及不透明LoadToken。声明时预留字节预算；宿主负责读取字节，完成时校验资源代次、加载序列及实际字节数，失败/取消后的迟到结果不得发布Ready。仅Registered（兼容逻辑登记）和Ready允许租约。CPU字节由Resources保存，消费者通过租约读取不可变数据。Scene对象删除/变更引用由Engine释放对应租约，共享资源不被自动注销。GPU、磁盘缓存、网络加载由后续适配实现，不把逻辑登记视为完成加载。
