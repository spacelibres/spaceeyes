# Rendering三维渲染系统设计规范

版本：0.0.1｜状态：待审定草案｜日期：2026-10-27
设计阶段：05｜归属：Rust Core｜仅设计，不写实现代码

## 1. 目标与边界
Rendering只读取Engine原子发布的FrameSnapshot（包含一致的Scene、Spatial与Time只读状态），生成GPU绘制指令。负责相机、可见性、几何、材质、基础光照、拾取、绘制调度与GPU资源适配。不解析NASA DYN、不计算轨道、不推进仿真时钟、不修改权威Scene状态。首期对标NASA Eyes太阳系探索，但核心不固定任何天体类型。

## 2. 设计约束
- Rust统一源码，WASM和Native仅为不同编译目标。
- 模块化与面向对象封装，使用struct、impl、trait与组合。
- 科学坐标保持双精度和明确参考系；GPU局部坐标为派生值。
- 公开结构化交换使用Proto，内部GPU缓冲不逐帧序列化。
- 插件使用受控渲染能力，不直接访问GPU设备或修改核心shader。
- GPU资源所有权遵守统一Resources模块，不建立第二套资源系统。

## 3. 对象职责
| 对象 | 职责 |
|---|---|
| Renderer | 初始化、帧提交、错误及生命周期 |
| RenderScene | 从SceneSnapshot生成绘制视图 |
| CameraSystem | 视图、投影、自由导航、聚焦、跟随 |
| VisibilitySystem | 裁剪、层级可见性与LOD |
| GeometrySystem | 网格、线、点、实例数据 |
| MaterialSystem | 材质、纹理、光照与着色参数 |
| RenderGraph | 绘制Pass依赖及顺序 |
| PickingSystem | 命中检测与ObjectId映射 |
| GpuResourceAdapter | GPU设备、缓冲、纹理与恢复适配 |

以上是职责划分，实际crate结构待审定。

## 4. 帧流程
Engine FrameSnapshot
→ 时间及修订一致性校验
→ 相机和局部原点
→ 可见性与LOD
→ 几何/材质准备
→ 绘制Pass
→ GPU提交
→ 帧呈现。

渲染只消费最近完整有效快照；数据缺失时显式标注新鲜度，不把旧数据伪装为当前科学状态。渲染帧率与逻辑仿真步进独立。

## 5. 跨尺度精度
持久化空间状态采用双精度和分层FrameId。GPU使用相机相对坐标及局部原点，必要时评估高低位拆分、动态裁剪面、反向Z或多层深度方案。具体组合须经原型测试，不能全部预先定为必选。测试包括太阳系总览、地月近景、木星卫星和极远极近相机切换。

## 6. 相机与拾取
支持旋转、平移、缩放、对象聚焦、跟随和视角恢复。相机跟随目标必须通过明确参考系和时刻查询，不以场景ParentId推导物理位置。拾取返回ObjectId、命中信息与场景修订；结果提交前检查对象仍有效。UI标签与面板属于Web宿主，核心提供投影锚点与命中接口。

## 7. 基础图元与显示能力
核心提供球体/网格、点、线、轨道线绘制原语、纹理、基础光照、透明、标签锚点和实例化。行星环、大气、彗尾、复杂航天器模型与地形属于可组合显示能力，首期范围依据NASA Eyes对标矩阵审定。轨道线绘制不等于核心计算轨道。

## 8. 绘制Pass与后端
建议首期采用最小可验证绘制Pass：不透明、透明、线条与叠加，按需增加深度预处理和后处理。透明排序、行星环遮挡、星空深度须专项验证。Rust图形抽象与WebGPU作为候选；wgpu可以进入技术原型比较，但尚未冻结。Native目标复用渲染语义，不另建一套引擎。

## 9. GPU资源与设备故障
Resources模块是统一资源所有权来源，Rendering只做GPU分配适配。设备丢失时停止提交，标记旧句柄失效，依据资源描述重建可恢复内容；不可恢复内容显式报错。资源释放和代次校验须覆盖场景切换、对象删除与关闭。

## 10. 性能与验收
记录帧时间P50/P95、CPU/GPU耗时、可见对象、draw calls、纹理与缓冲占用、首屏时间、LOD切换和长时间资源曲线。验证太阳系总览、地月跟随、木星卫星、土星环、时间跳转、远近裁剪、拾取、设备丢失、资源释放和跨编译目标语义。设备与阈值需原型实测后冻结，不预先承诺FPS。

## 11. 待审定事项
图形后端；多尺度深度方案；快照增量更新；相机控制边界；环/大气/标签首期范围；GPU资源恢复；透明与LOD预算；首期RenderGraph采用固定Pass还是通用图。当前没有实现代码或运行测试。

## 12. 交叉审查整改对齐（待审）
Renderer只读取Engine发布的一致FrameSnapshot，不自行拼接不同修订的数据。相机持久状态通过统一命令维护，Renderer负责视图投影和临时GPU数据。GPU资源所有权与字节配额归Resources，Rendering仅负责设备适配及实际占用上报。


## 13. 第13阶段相机与快照对齐
相机持久逻辑状态归Scene受控命令，Renderer仅派生视图/投影矩阵和临时GPU数据。FrameSnapshot与ProjectSnapshot不同：Renderer不负责持久化项目，也不得将GPU临时句柄写入ProjectSnapshot。GPU资源生命周期遵守Resources统一所有权。


> 版本同步记录（2026-10-27）：本受控文档随首次Rust核心开发启动统一升级至0.0.1；历史规划说明及原始批准日期保留为历史记录。实际实现范围以CHANGELOG.md为准。

## 0.0.1 wgpu技术原型（用户已选择）
用户选择wgpu进行技术原型，先验证Native离屏绘制与像素回读，不据此冻结产品GPU版本、深度方案或性能指标。Engine发布共享snapshot crate中的不可变FrameSnapshot，包含同一时刻的对象参考系原点变换、各模块修订和明确unresolved对象列表。无变换对象不被伪造为原点。Renderer先实现CPU相机投影、可见性、对象标记及带修订拾取，再由wgpu绘制标记三角形。此原型不等于球体/纹理/光照/Web宿主完成。持续相机状态仍属于Scene，临时View参数仅用于原型投影。GPU测试必须实际绘制与回读像素；无适配器时报告不可用，不跳过后冒充通过。

## 0.0.1受控相机视图
prepare_camera从同一FrameSnapshot读取相机组件和该对象的时刻相关Frame姿态，组合局部相机位置/旋转后再投影。先以f64减去相机原点，再旋转至相机空间，最后转换为GPU f32，支持任意姿态而非固定-Z世界视图。缺少相机组件/参考系姿态时明确报错，不回退到默认相机。组件相机对象不作为标记绘制。viewport aspect是临时显示参数，持久FOV/裁剪面归Scene。

## 0.0.1球体网格与深度遮挡迭代
新增Scene受控Sphere组件，保存正有限米制半径与不透明线性RGB基色；不承载天体分类或科学模型。渲染采用有界UV球体三角网格（默认32经向×16纬向）、透视齐次裁剪坐标及Depth32Float深度附件，逐片元深度写入/比较替代绘制顺序遮挡。球体中心先在f64相机空间计算，再生成GPU f32顶点；跨近/远裁剪面的球体交给GPU裁剪，不以球心在视锥外直接丢弃。基础相机空间方向光仅用于观察形状，不是太阳光照或完整材质系统。标记兼容保留，并改用相同透视深度规则。拾取使用同一三角网格求交，选择裁剪区间内最近命中，禁止仍以旧三角标记命中球体。颜色/深度/回读/顶点临时占用均纳入Resources预算，帧结束释放。验收覆盖网格外法线、可见球体、前后遮挡与顺序独立性、近面裁剪、拾取和预算回收。

### 资源所有权提交前核查
Native绘制改为Engine::render_rgba8协调，由Engine内部唯一ResourceManager登记和回收离屏颜色/深度/回读/顶点占用。Renderer只接收核心内部借用，宿主没有可变资源注册表入口；Native不创建第二套资源权威。Engine正常依赖Rendering，Rendering及其测试不反向依赖Engine；可选gpu feature控制设备适配，默认核心/WASM字节桥不要求GPU。新增集成测试确认绘制仅在Running允许、长期资源在帧结束后仍保留、临时占用回收并更新帧修订。

## 0.0.1通用不透明三角网格
读取FrameSnapshot的只读MeshAsset与对象参考系姿态，先f64相机相对刚体变换，再生成现有透视裁剪顶点。法线只施加旋转，不加平移；本轮不支持缩放/骨骼。网格、球体及标记共用同一不透明深度管线与临时GPU预算；拾取使用同一顶点/索引及变换，比较所有图元最近有效深度。新增Mesh资源Proto入口，不在Scene或Renderer建立第二套资产注册表；纹理、透明、复杂材质和模型文件导入仍不属于本轮。

## 0.0.1纹理与基础材质
本轮支持Resources拥有的只读不透明RGBA8纹理，明确Linear/SRGB色彩空间；UV原点为图像左上，行按自上而下存储。基础材质为线性基色×纹理，支持Lit/Unlit、Nearest/Linear、ClampToEdge/Repeat；未绑定纹理使用白色。网格UV随顶点保存，老构造器默认(0,0)，球体生成经纬UV。GPU使用真实纹理/采样器与透视正确UV插值，不用CPU涂色替代；SRGB纹理由GPU解码，离屏RGBA8回读目标仍为线性值，不声称完成显示色调映射。纹理上传及GPU纹理/顶点/帧缓冲均计入Engine唯一Resources临时预算，帧后回收。暂不支持PNG/JPEG导入、透明、mipmap或PBR。测试应覆盖UV方向、nearest/linear、clamp/repeat、sRGB、透视插值及错误引用回滚。

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

## M2-2 同帧拾取契约（0.0.1开发增量）
公开query.pick_presented使用最近成功呈现帧的frame_sequence和有限NDC坐标（x右正、y上正，范围[-1,1]）。Rust保留单个只读拾取视图与对象摘要；查询不创建新帧、不推进时钟、不消耗命令历史。摘要与几何来自同一帧；空白返回成功且无对象。帧不匹配、核心状态已变化或没有成功呈现帧时返回SNAPSHOT_EXPIRED；停机返回ENGINE_UNAVAILABLE；非法坐标返回INVALID_ARGUMENT。浏览器宿主自行将CSS点击坐标转换为NDC，不执行几何拾取。缓存仅在成功呈现后更新，Stop释放；旧视图不得冒充当前结果。宿主选择只作临时UI状态，摘要不包含未开放的科学属性。

## M2-3 相机聚焦与跟随契约（0.0.1开发增量）
Engine接受camera.focus（相机/目标ObjectId、正有限米制距离、follow），要求expectedSceneRevision及当前TimeGeneration；在当前时刻解析Spatial并经唯一Scene事务提交。聚焦沿目标参考系+Z放置、沿-Z观察；球体/标记取参考系原点，网格取引用顶点AABB中心。距离必须在当前相机near/far内，不自动修改投影。跟随保存在CameraState.tracking(targetId,distanceM)，每帧从同一FrameSnapshot求值目标位置及旋转，不累计运动、不写Scene。基础CameraState.position/orientation属于拥有相机的FrameId；tracking生效时派生视图使用目标参考系，基础位姿作为显式逻辑状态保留，不冒充当前世界位置。禁止自引用、相机目标与跟随链；被跟随对象删除/改成相机时事务拒绝，可先清除跟随再删除。参考系/时间覆盖缺失明确失败；Renderer不回退到原点。query.camera_state只读逻辑状态；旧SetCamera未提供tracking即清除跟随，旧wire字段编号不变。宿主不持有第二套权威相机，不基于Scene ParentId算坐标。
