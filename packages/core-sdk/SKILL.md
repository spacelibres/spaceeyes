# SPACEEYES Core SDK 使用技能书

版本：0.0.1｜状态：M2基本交互公开契约；不代表完整插件运行时

项目自有SDK与文档使用根MIT许可证。依据：唯一proto目录、批准ADR、全局开发路线。生成文件禁止手改；运行`bash tools/generate-ts.sh`后用`--check`验证。锁文件安装：`bash tools/setup-sdk.sh`；完整互通验证：`bash tools/check-sdk.sh`。

宿主负责创建WASM实例及显式会话、时间尺度/历元，认证并授权调用者，然后通过`wasmTransport(engine, principal)`闭包注入身份。插件不自报principal、不持有核心内存或私有Engine接口。此transport不构成完整插件权限沙箱，当前尚无正式插件运行时。

创建`CoreClient(transport, sessionId)`，先`await client.connect(requiredOperations)`，再发送生成类型约束的`command(payload, options)`与`query(payload, options)`。支持列表是实现能力，不是授权或当前状态承诺；缺失能力应停止并报告，不能绕过SDK访问私有核心。可信宿主已有browserSurface画布与私有present路由，插件不得直接调用；Live、动态提供者注册、事件订阅和项目文件等公开能力仍未开放。

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

## M2-4 浏览器时间交互（0.0.1开发增量）

浏览器经既有time.set_rate/step/seek提交命令，不维护第二套时钟。倍速修改不自动播放；步进和跳转仅在暂停时启用，并在串行处理时重查Rust模式。十进制秒输入相对当前显式历元，最多64字符/9位小数，用BigInt无损映射sint64秒与[0,1e9)纳秒，拒绝科学计数法及溢出；沿用Rust当前timeScale/epochId，不做UTC猜测。显示负小数时按总纳秒符号格式化，不把floor秒直接拼接纳秒。操作完成须重新查询核心；非法输入或预期拒绝不得停止会话或伪造成功。步进/跳转清除旧选择；Seek代次变化由核心保持唯一权威。本增量不是科学时间轴或Live功能。

暂停前置条件是当前浏览器步进/跳转工作流的限制，不改变既有核心time.seek/step在其它宿主中的协议语义。输入控件的文本是未提交目标，不能作为权威时钟；以命令完成后的Rust查询为准。

## M3-1a 分层资源预算契约（0.0.1开发增量）

ResourceManager为唯一总额及Cpu/Gpu/Staging类别额度权威，申请须同时满足类别与总额，计数和资源修订原子更新。Engine原型总256MiB、CPU128MiB、GPU128MiB、Staging32MiB；属于可配置原型限制，不是实测内存保证。纹理/网格/加载声明归Cpu，Surface附件容量归Gpu，帧GPU分配和CPU打包/上传/回读暂存分别归Gpu与Staging；成对预留失败不留下部分占用，完成或错误时释放。GPU/临时资源不得成为Scene资产引用，ProjectState只导出显式Cpu记录，恢复拒绝Gpu/Staging并采用目标宿主额度。query.resource_stats只读返回分项/总占用、上限与资源修订；不推进时钟、不占幂等历史，Stop后占用0。统计不覆盖全部旧快照、驱动内部开销或宿主长期输出副本；消息仍限1MiB，尚不宣称分块上传完成。SDK不能借统计查询提高权限或直接申请内部GPU/临时资源。

调用前协商`query.resource_stats`，使用`client.query({ case: "resourceStats", value: {} }, { requestId: "resources:stats" })`读取；字节数和修订号为bigint，不能转换成可能失真的number。以核心响应为准，不在TS维护权威计数；能力发现不替代授权。CPU/GPU/Staging注册与帧租约仅限Rust内部，插件不得调用。

## M3-1b 有界资源上传（0.0.1开发增量）

公开操作resources.begin_upload/append_upload/finish_upload/cancel_upload及query.upload。单资源非空且最多16MiB，单块非空且最多256KiB，最多4个在途会话；还受宿主CPU/Staging及总额限制，消息上限仍1MiB。begin原子预留等长CPU目标和Staging，会话由Rust生成且绑定宿主注入principal，偏移必须等于已收字节，不接受重叠/跳块。申请源source_id最多256字节、source_version最多128字节，均非空；SHA-256必须32字节并对完整实际内容验证，标签/摘要不是科学认证。

格式仅Bytes（width/height/color_space均缺省）与RGBA8（显式宽高和Linear/SRGB，最多2048×2048，alpha=255）。finish缺块拒绝并保留可追加会话；完整内容摘要/类型失败自动取消并释放，成功变成Ready CPU资产且释放Staging；取消或Stop后迟到消息不能复活条目。源信息随完成资源记录保存，恢复重新验摘要；上传中记录和缓冲不导出。查询不返内容、不推进时间/命令历史。重试必须复用原请求ID及相同字节，不能换ID重复偏移；原ID重试得到历史回执，不意味着会话仍存活，应读query.upload。墙钟超时、网络/磁盘I/O、压缩解码、网格大包及插件整体所有权由M3后续实现。

使用前协商上述5项能力并读取maxUploadBytes/maxUploadChunkBytes/maxActiveUploads。totalBytes/offset/receivedBytes为bigint；每次从响应读取会话ID，禁止自行构造或跨实例复用。用client.command资源action beginUpload（resourceId,totalBytes,source,format,width,height,colorSpace）→appendUpload（uploadId,offset,data）→finishUpload（uploadId），响应分别为upload/upload/resource；query上传状态使用{case:"upload",value:{uploadId}}，取消用cancelUpload返回resource。请求上下文需requestId，principal仅由受信宿主注入。成功资产才能用于Scene，不能读取或渲染未完成内容。错误时读取状态或显式cancel，不做无界自动重试；不要把source标签当许可或科学来源证明。SDK不能直接访问Rust内存或绕过配额；本增量不是完整网络加载器或PNG/JPEG导入接口。

上传块幂等历史仅保留长度与SHA-256指纹，不长期保留块内容。正常命令历史耗尽后普通写入仍拒绝，核心保留至多4个会话取消及一次Stop的独立成功回执空间；无效取消不能消耗该空间。取消/Stop请使用新的requestId且不附过期timeGeneration；相同请求重试仍得到原回执。

## M4前置：提供者样本帧（0.0.1开发增量）

新增`spatial.register_provider_frame`与`spatial.update_provider_frame_sample`。前者在既有父参考系下建立由数据插件提供变换的帧，并记录provider_id/provider_version（非空，分别最多256/128字节）；后者为该帧提交一个显式时刻的刚体变换。核心不插值、不计算轨迹、不联网，只校验修订与时刻覆盖。

流程：先`spatial.register_root`，再`register_provider_frame`；首次`update_provider_sample`前解析该帧返回PROVIDER_UNAVAILABLE，恢复后缺失提供者占位也等待宿主重新提交。每次时钟变化后，宿主必须用同一当前TimeInstant重新提交样本，否则查询返回TIME_NOT_COVERED。只能更新提供者帧或恢复占位；对根/静态样本/动态提供者帧更新返回INVALID_ARGUMENT。所有写入须带expected frame_graph_revision；不匹配返回REVISION_CONFLICT。

provider_id/version是来源标签，不是科学认证或许可。宿主仍负责用已核验插件求值并遵守网络代理权限；不得把样本帧当作核心自算星历或跳过Time/Spatial修订。相机、场景对象与任务使用同一参考系图修订，样本更新会使依赖旧图修订的任务Stale。

## 项目保存与打开（0.0.1开发增量）

`query.project_export`只读返回结构化`ProjectSnapshot`（schema_version=1）：时钟/模式/倍速、Scene对象（含父级、FrameId、组件与资源引用）、参考系记录（含provider标签与单时刻样本）、资源记录（来源/摘要/字节/网格/纹理）。不保存GPU句柄、任务、上传会话、内部ObjectHandle或执行栈；保存会禁用或未实现的提供者仅保留标签，恢复为占位并等待重新采样。

导出示例：`const r = await client.query({case:'projectExport',value:{}},{requestId:'project:save'})`；确认`r.payload.case==='project'`后用生成的`ProjectSnapshotSchema`编码字节并保存。恢复不是会话命令：宿主用同一项目字节创建新引擎/新会话（WASM为`WasmEngine.from_project(session, bytes)`），再建新`CoreClient`并`start`；脚本/replay不能把旧句柄注入新会话。未知版本、非法标识、非32字节来源摘要或资源长度不符应拒绝，不静默丢弃字段；损坏项目不得污染现有会话。

导出受Stopped限制；`query.project_export`只读、不推进时钟、不消耗命令历史，也不代表资源可再分发。恢复后场景修订、帧序列和任务代次会重新建立，不能沿用旧回执。

## 对象分页查询（0.0.1开发增量）

`query.list_objects`按ObjectId字典序返回场景对象摘要，支持`page_size`（0表示默认256，最大256）与不透明`page_token`（上一页最后一个ObjectId）。响应包含`objects`、`next_page_token`与`scene_revision`；空token开始，空next表示结束。分页是实时读取：期间场景可变化，调用方需用scene_revision判断是否重读；已删除的token仍按字典序继续，不重放旧对象。非法页大小、超长token返回INVALID_ARGUMENT，Stopped返回ENGINE_UNAVAILABLE。查询不推进时钟、不写事件、不消耗命令历史，也不授予对象写权限。
