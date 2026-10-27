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

## 0.0.1许可一致性
Resources属于SPACEEYES自有Rust核心，和Engine、Scene、Rendering等模块统一适用根MIT License及SPDX-License-Identifier: MIT，不存在独立闭源许可。本文“资源所有权”“租约”“最终释放”均指程序运行时生命周期，与开源版权许可不同；Engine继续统一管理资源，许可调整不改变ADR-004职责边界。

## 0.0.1通用三角网格资源
新增纯领域geometry crate：有限米制局部顶点、归一化法线、三角形索引，构造时校验数量、索引、退化面及本地坐标策略界限。Resources登记只读TriangleMesh并按顶点/索引逻辑字节量计费；Scene只存MeshInstance.geometry ResourceId和基色，不另存权威顶点。对象/任务租约沿用唯一ResourceManager。帧快照可共享不可变Arc网格以保持旧帧有效，这不构成第二套注册表；当前配额统计为登记及GPU临时占用，不声称涵盖用户长期保留的旧快照内存。内部ProjectState保留网格值，恢复时重新登记与校验大小，不持久化租约。

## 0.0.1纹理资源
TextureData为独立的已校验领域值：1–2048像素宽高、恰好width×height×4字节、全部alpha=255及显式Linear/SRGB。Resources唯一登记与租约控制，Typed纹理与字节/网格类型不得混用；项目恢复校验内容互斥与大小。FrameSnapshot共享只读纹理值，沿用已记录的旧快照保留配额限制；本轮不增加第二个缓存注册表。GPU只分配帧内纹理并上报逻辑占用。

## 图像文件导入增量（0.0.1）
外层image-import模块接受最多8MiB的PNG/JPEG字节，解码尺寸最多2048×2048，仅支持8位不透明图像。调用方显式选择Linear/SRGB，不做ICC色彩转换；JPEG采用严格解码并应用EXIF方向。解码失败不得登记Resources。Native宿主负责有界文件读取，成功后通过现有Engine接口登记TextureData，核心不依赖文件或编解码器。本轮先交付库与Native文件导入；Proto压缩图像命令后续扩展。输入不可信时解码库的内部内存限制不能等同于进程级隔离。

## M2-1 浏览器画布与宿主帧（0.0.1实施增量）
状态：本轮实施规范；保持已批准ADR和唯一Rust核心。Next.js/React宿主经既有SDK/Proto构造合成场景；共享wgpu几何/材质打包与绘制管线，新增浏览器Surface异步初始化、缩放与真实显示，不把Native回读图片贴到画布。
宿主DOM画布绑定为基础设施接口；结构化帧数据采用HostFrameEnvelope(context=1, frame=30)，CommandEnvelope保留30，QueryEnvelope保留30。HostFrame含reference/camera/width/height/elapsed_nanos；ResponseEnvelope追加presented=14，包含当前SessionStatus、尺寸和未解析对象数。Capabilities追加browser_surface=4，只代表该编译目标含Surface支持，不表示运行设备或授权有效。通用24项操作不因此变成插件绘制权限。
宿主帧入口只给受信宿主，身份由闭包注入。仅Running可呈现；要求当前time_generation，可选Scene修订，尺寸1..2048、经过时间0..250ms，引用/相机预检失败不得推进时间；校验后调用Engine.advance_nanos并发布同一时刻FrameSnapshot。绘制失败不撤回已经提交的时间，返回结构化错误并由宿主停循环/查询；不假装跨GPU与时间原子事务。不占命令历史，不写业务提交事件，不隐式重试。
一次只允许一个在途GPU帧，等待提交完成后回收帧顶点/纹理临时预算，浏览器禁止同步GPU等待。Surface绑定时通过唯一Resources保守预留2048×2048×12=48MiB附件容量（两份颜色与一份深度），记录为容量预留而非实际显存测量；持有租约，Stop/实例释放时随Engine清理。Surface只保存GPU对象，不建资源注册表。本轮检测设备丢失并显式停止/清理；自动恢复与重建设计仍属M5。
React每次挂载创建独立canvas与Engine，异步初始化/呈现期间的输入串行执行；卸载取消RAF并移除所属canvas、等待在途操作退出，再Stop/free；迟到初始化不能重新挂到已卸载DOM。帧时间来自单调RAF时间戳，暂停不推进时钟，过长间隔限250ms；不创建JS权威仿真时钟。合成场景使用根系与相机局部偏移，避免把单时刻子采样当作永久参考系。
首个可运行宿主提供开始/暂停时间、相机偏航、状态/错误与挂载开关。验证实际Chromium WebGPU绘制像素、相机变化、暂停/播放、resize、卸载/重挂和不支持WebGPU路径；截图、生产构建、严格WASM feature编译和浏览器自动测试纳入检查。目标为M2首个增量，不声称NASA真实场景、拾取UI、完整控制台、设备恢复或硬件性能已完成。

M2-1补充：浏览器采用非映射流式顶点上传，并将顶点目标/上传暂存双份计费；Surface保留Instance，GPU完成后回收临时预算。WASM模块加载Promise共享而Engine实例独立，避免并发初始化替换运行时；设备丢失/验证/分配错误返回失败，初始化失败或卸载时显式destroy设备。

## M3-1a 分层资源预算契约（0.0.1开发增量）
ResourceManager为唯一总额及Cpu/Gpu/Staging类别额度权威，申请须同时满足类别与总额，计数和资源修订原子更新。Engine原型总256MiB、CPU128MiB、GPU128MiB、Staging32MiB；属于可配置原型限制，不是实测内存保证。纹理/网格/加载声明归Cpu，Surface附件容量归Gpu，帧GPU分配和CPU打包/上传/回读暂存分别归Gpu与Staging；成对预留失败不留下部分占用，完成或错误时释放。GPU/临时资源不得成为Scene资产引用，ProjectState只导出显式Cpu记录，恢复拒绝Gpu/Staging并采用目标宿主额度。query.resource_stats只读返回分项/总占用、上限与资源修订；不推进时钟、不占幂等历史，Stop后占用0。统计不覆盖全部旧快照、驱动内部开销或宿主长期输出副本；消息仍限1MiB，尚不宣称分块上传完成。SDK不能借统计查询提高权限或直接申请内部GPU/临时资源。
