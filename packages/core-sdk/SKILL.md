# SPACEEYES Core SDK 使用技能书

版本：0.0.1｜状态：M2-3聚焦/跟随及逻辑相机查询；不代表完整插件运行时

项目自有SDK与文档使用根MIT许可证。依据：唯一proto目录、批准ADR、全局开发路线。生成文件禁止手改；运行`bash tools/generate-ts.sh`后用`--check`验证。锁文件安装：`bash tools/setup-sdk.sh`；完整互通验证：`bash tools/check-sdk.sh`。

宿主负责创建WASM实例及显式会话、时间尺度/历元，认证并授权调用者，然后通过`wasmTransport(engine, principal)`闭包注入身份。插件不自报principal、不持有核心内存或私有Engine接口。此transport不构成完整插件权限沙箱，当前尚无正式插件运行时。

创建`CoreClient(transport, sessionId)`，先`await client.connect(requiredOperations)`，再发送生成类型约束的`command(payload, options)`与`query(payload, options)`。支持列表是实现能力，不是授权或当前状态承诺；缺失能力应停止并报告，不能绕过SDK访问私有核心。Live、画布、动态提供者、事件、项目文件等尚未开放。

每个写请求由调用者提供唯一requestId；重试必须保持同一ID、载荷和前置条件。SDK不自动重试，也不维护第二套场景/时钟状态。修订、代次、秒、纳秒步进等64位字段使用bigint；不要转为number或JSON数字。对象坐标以米、四元数wxyz、时间尺度及历元显式提供；不做科学时间或参考系猜测。子参考系采样仅在该时刻有效。

读取当前会话状态获取修订与代次，然后提交带expectedSceneRevision/timeGeneration的命令；Spatial写入还需expectedRevision。SceneTransaction只负责Scene原子批次，不把多条跨模块命令当成同一事务。资源先登记再引用，受消息/几何/纹理配额约束；失败时通过结构化CoreRemoteError识别冲突、过时代次、覆盖缺失等，不伪造成功。

查询ID可以重复以读取最新状态，查询不消耗命令幂等历史。历史容量/剩余值是发现时的快照，不能视为永久预留。结构化错误保持code/requestId；传输失败、消息过大、响应关联错误和不支持的能力在客户端直接失败，不隐式重试。

Stop终止会话并清理登记资源，不能Start重启；旧写回执是历史结果，不证明当前仍存在资源或Running。宿主应先Stop并处理结果，再在finally中调用WASM实例free；CoreClient不拥有实例，不擅自释放共享宿主。卸载、取消、权限撤销和GPU恢复的完整平台流程仍待后续里程碑。

验收须以真实Native与WASM运行：新会话→能力发现→参考系/资源→相机/场景→时间/查询→错误/幂等→Stop/释放。测试使用合成几何和图片字节，不引入未经许可的NASA资产。Node中的WASM通过不代表浏览器、WebGPU或科学对照通过。

## M2-2 同帧拾取契约（0.0.1开发增量）
公开query.pick_presented使用最近成功呈现帧的frame_sequence和有限NDC坐标（x右正、y上正，范围[-1,1]）。Rust保留单个只读拾取视图与对象摘要；查询不创建新帧、不推进时钟、不消耗命令历史。摘要与几何来自同一帧；空白返回成功且无对象。帧不匹配、核心状态已变化或没有成功呈现帧时返回SNAPSHOT_EXPIRED；停机返回ENGINE_UNAVAILABLE；非法坐标返回INVALID_ARGUMENT。浏览器宿主自行将CSS点击坐标转换为NDC，不执行几何拾取。缓存仅在成功呈现后更新，Stop释放；旧视图不得冒充当前结果。宿主选择只作临时UI状态，摘要不包含未开放的科学属性。

使用前先协商`query.pick_presented`，帧序号只能来自受信任宿主完成的呈现回执，不能使用JS帧计数或猜测`SessionStatus.frameSequence`就是可拾取画面。当前非浏览器适配没有呈现视图，查询返回SNAPSHOT_EXPIRED。发现操作受支持不表示存在有效帧。

允许：读取同帧对象ID、参考系及已有组件，显示明确的选中帧来源。禁止：自行重建JS几何与核心争夺权威、把过期结果用于写命令、直接调用宿主私有present或修改WASM内存。后续写命令必须重新读取当前修订并走正常校验。

调用示例（宿主已经创建并连接client，传入其最近成功呈现的序号和归一化坐标）：

```typescript
import { CoreClient } from "@spaceeyes/core-sdk";

export async function pickDisplayed(
  client: CoreClient,
  frameSequence: bigint,
  x: number,
  y: number,
) {
  return client.query(
    { case: "pickPresented", value: { frameSequence, x, y } },
    { requestId: "selection:read" },
  );
}
```

空白成功时`selection.object`缺省；不得将其解释为失败。捕获CoreRemoteError的SNAPSHOT_EXPIRED后提示重选，禁止无界自动重试或伪造命中。验收覆盖真实浏览器命中/空白、缩放/卸载、非法坐标、帧变化与对象删除后拒绝，以及Native/WASM查询无副作用。

## M2-3 相机聚焦与跟随契约（0.0.1开发增量）
Engine接受camera.focus（相机/目标ObjectId、正有限米制距离、follow），要求expectedSceneRevision及当前TimeGeneration；在当前时刻解析Spatial并经唯一Scene事务提交。聚焦沿目标参考系+Z放置、沿-Z观察；球体/标记取参考系原点，网格取引用顶点AABB中心。距离必须在当前相机near/far内，不自动修改投影。跟随保存在CameraState.tracking(targetId,distanceM)，每帧从同一FrameSnapshot求值目标位置及旋转，不累计运动、不写Scene。基础CameraState.position/orientation属于拥有相机的FrameId；tracking生效时派生视图使用目标参考系，基础位姿作为显式逻辑状态保留，不冒充当前世界位置。禁止自引用、相机目标与跟随链；被跟随对象删除/改成相机时事务拒绝，可先清除跟随再删除。参考系/时间覆盖缺失明确失败；Renderer不回退到原点。query.camera_state只读逻辑状态；旧SetCamera未提供tracking即清除跟随，旧wire字段编号不变。宿主不持有第二套权威相机，不基于Scene ParentId算坐标。

使用camera.focus前须协商camera.focus和query.camera_state；命令必须携带expectedSceneRevision及timeGeneration。目标须是当前存在且具有参考系的非相机对象，不能把旧拾取摘要直接当成当前对象状态。距离须有限且处于已有相机near/far内。跟随是目标参考系相对视角，不是惯性稳定、物理航行或相机平滑动画。

允许通过query.camera_state读取逻辑相机与tracking；禁止把其基础position当成跟随后的实时世界位置，禁止在TS逐帧积分目标运动。SetCamera不提供tracking会清除跟随；可在同一Scene事务中清除跟随后删除目标。被跟随目标直接删除、同ID替换或变为相机时整批拒绝。遇到TIME_NOT_COVERED、缺失资源等应展示明确错误，不伪造中心或绕过Engine写入。
