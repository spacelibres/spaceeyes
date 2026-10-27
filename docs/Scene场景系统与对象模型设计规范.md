# Scene场景系统与SceneObject对象模型设计规范

版本：0.0.1｜状态：待审定设计草案｜日期：2026-10-27  
归属：SpaceEyes Rust Core｜设计阶段：01｜不包含实现代码  
上位规范：`docs/Rust核心引擎设计规范.md`

## 1. 目标与范围

定义所有三维对象共用的身份、注册、组织、状态、生命周期和只读快照语义。核心不得假设对象一定是地球、行星、卫星或航天器；业务分类、NASA星历及物理计算属于后续插件。

## 2. 关键概念

- **ObjectId**：公开的稳定对象标识，跨会话持久化；不依赖内存地址。具体编码待Proto规范审定。
- **ObjectHandle**：内部访问句柄，含索引和代次，防止对象删除后旧引用误指向新对象。
- **Scene**：对象集合、注册表、关系与状态写入的唯一权威。
- **SceneObject**：封装通用属性与资源引用；不允许外部直接修改内部字段。
- **ParentId**：场景组织关系，主要用于树形管理、选择和生命周期策略；**不自动代表物理参考系或空间变换继承**。
- **FrameId**：独立的空间参考系标识，实际变换由Spatial模块负责。
- **SceneSnapshot**：Scene生成的不可变场景局部视图；Renderer只消费Engine发布的一致FrameSnapshot；持久恢复使用独立ProjectSnapshot。

## 3. 对象模型（候选）

| 对象 | 核心职责 | 公开行为候选 |
|---|---|---|
| `Scene` | 创建、查找、变更、删除、快照 | `create_object`, `get_object`, `apply_command`, `snapshot` |
| `SceneObject` | 身份、组织关系、可见性、变换引用、资源句柄 | 仅受控方法，不能任意字段写入 |
| `SceneRegistry` | ObjectId到内部句柄的索引 | 查找与代次验证 |
| `SceneHierarchy` | ParentId树关系与无环检查 | 挂载、重设父级、分离 |
| `SceneCommand` | 状态修改意图 | 创建、删除、设置父级、设置可见性、设置变换 |
| `SceneSnapshot` | 只读状态传递 | 按版本读取对象与关系 |

上述是**职责划分**，不要求每个对象都独立成为crate或单独持有全部状态。

## 4. 强制不变量

1. 同一场景中ObjectId唯一；ObjectHandle代次校验，失效后不得继续使用。
2. 场景组织父子关系无环；父级对象必须存在。
3. 对象状态只有Scene授权的命令路径可修改；查询不得泄露可变内部引用。
4. ParentId与FrameId分别保存，不得隐式互相推导。
5. 对象删除/分离后，资源归属与订阅释放规则必须明确。
6. 所有公开命令有请求ID、结果或结构化错误；异步接受不等于完成。
7. 核心不储存NASA DYN路径、星历样本或特定天体业务字段。

## 5. 对象生命周期（候选）

```text
Created → Attached → Active
                 ↘ Detached → Disposed
Active → Detached → Attached（如允许重新挂载）
```

创建、挂载、激活和删除操作的实际原子性由SceneCommand定义。重新挂载是否保留原ObjectId、删除父对象时子对象是级联删除还是拒绝删除，均列为待审定事项，不能提前假定。

## 6. 变换与参考系

`SceneObject`引用`FrameId`和时间相关的状态句柄；Spatial负责参考系图、变换组合与精度策略。场景父子关系不隐式改变坐标。位置、姿态必须具备时间尺度、参考系、单位和有效范围。渲染只读取对应仿真时间的快照。

## 7. 状态更新与快照

命令先校验目标ID、状态和不变量，成功后以单一权威顺序应用；失败不得造成隐式部分写入。批量Scene事务首期按已批准ADR-002采用全有或全无；逐项best-effort如未来需要须定义独立命令。SceneSnapshot应包含场景修订号、仿真时间引用、对象通用状态、组织关系与资源句柄引用；快照是只读数据，不允许渲染器反向修改权威Scene。

## 8. Proto公开边界

跨宿主/SDK/核心的结构化命令、查询、事件和快照以版本化Protobuf定义。Rust内部领域对象不直接等同Proto消息；协议适配层负责映射与校验。ObjectId、FrameId、生命周期事件、错误码和状态修订号需要在正式Schema中冻结。

## 9. NASA Eyes首期验证用例

- 创建太阳、地球、月球、木星四个通用场景对象，核心不识别其业务类型。
- 场景组织中地球和月球可归属一个组，但位置参考系由Spatial独立定义。
- 时间跳转后旧快照不可覆盖新状态；重复命令处理可追踪。
- 删除/重建对象后旧Handle必须失效。
- 插件宿主可仅通过公开接口注册、更新、查询对象，不能访问核心内部字段。

## 10. 验收与未决问题

验收应包含ObjectId唯一性、组织关系无环、代次失效、只读快照、批量命令错误、资源回收和Proto跨语言往返。**目前没有Rust实现或测试通过记录。**

待审定：
1. ObjectId编码与持久化策略。
2. 删除父对象时的子对象处理策略。
3. Detached状态是否允许重新挂载。
4. 场景状态与时间相关状态如何存储。
5. SceneSnapshot复制/共享策略。
6. 批量命令是否支持原子提交。


## 11. 建议审定的对象身份与删除策略（尚未批准）

建议公开ObjectId稳定、内部ObjectHandle带代次；删除有子对象的父对象默认拒绝，级联删除必须显式命令；ParentId仅表示组织关系，不等于Spatial的FrameId。该提案等待项目负责人确认后再标记为已批准。具体编码和删除事务语义仍待详细设计。


## 12. 交叉审查整改对齐（待审）
Scene是唯一场景可变状态所有者；Engine为统一外部命令入口，Simulation仅提出经验证的SceneCommand。SceneSnapshot由Engine联合Time与Spatial修订形成一致FrameSnapshot。Frame撤销不隐式删除对象。单命令原子，批量默认全有或全无属于已批准ADR-002的设计约束。


## 13. 第13阶段生命周期对齐
Engine生命周期与SceneObject生命周期分别定义；Paused只属于Time。Frame失效时Scene对象保持存在并标记unresolved。对象删除释放资源租约，不直接删除共享GPU资源。ProjectSnapshot保存稳定ObjectId、ParentId、FrameId等持久状态，禁止保存内部ObjectHandle。恢复后需建立新的内部句柄。


> 版本同步记录（2026-10-27）：本受控文档随首次Rust核心开发启动统一升级至0.0.1；历史规划说明及原始批准日期保留为历史记录。实际实现范围以CHANGELOG.md为准。

## 0.0.1基础模块补齐
对象内部句柄绑定Scene注册表身份、ObjectId和创建代次；删除后重建同ID不复用旧句柄，句柄不持久化。新增SetResources声明逻辑资源引用；Engine在Scene事务副本验证后统一分配/释放对象租约，失败不改变Scene或Resources。绑定新的FrameId必须存在；移除后对象仍保留，帧发布标记unresolved。Scene组织父子关系不参与Spatial变换计算。

## 0.0.1相机基础迭代
相机作为SceneObject的可选CameraState组件，由SceneCommand::SetCamera经Engine事务修改或移除。组件保存相对该对象FrameId的米制位置、WXYZ单位四元数和透视投影参数；构造时拒绝非有限值、退化四元数及非法FOV/裁剪面，内部字段只读。场景父级不改变相机物理姿态。ProjectState与SceneSnapshot保留组件，内部句柄仍不持久化。本轮不实现跟随、聚焦、多视口或正交投影。

## 0.0.1球体显示组件
SceneObject可选Sphere组件通过SetSphere命令新增、更新或移除；参数构造时校验正有限半径及[0,1]有限线性RGB。组件保持只读，随SceneSnapshot与ProjectState保存。一个对象本轮不能同时作为相机和球体；事务最终校验，失败全量回滚。Engine要求新设球体引用显式FrameId，参考系撤销后仍按原规则unresolved。没有Sphere的普通对象保留原有标记显示。

## 0.0.1通用网格显示引用
MeshInstance是可选只读组件，保存geometry ResourceId与有限线性RGB基色，经SetMesh事务更新或移除。Mesh/Sphere/Camera本轮互斥；网格本地坐标经对象FrameId刚体变换，ParentId不参与物理变换。组件引用隐式参与对象资源租约并与显式资源引用去重；新引用必须是已登记的TriangleMesh，不接受裸字节或占位资源。缺少/错误引用使整批事务失败。MeshInstance随SceneSnapshot和内部ProjectState保留。
